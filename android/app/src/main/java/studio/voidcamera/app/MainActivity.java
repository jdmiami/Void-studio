package studio.voidcamera.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final int CAPTURE_PERMISSION_REQUEST = 20;
    private static final Map<String, String> CONTENT_TYPES = contentTypes();
    private static final String CONTENT_POLICY = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
        + "style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; "
        + "connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; "
        + "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

    private WebView web;
    private PermissionRequest pendingPermission;
    private final Downloads downloads = new Downloads();

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 35) {
            container.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets insets = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return windowInsets;
            });
        }

        web = new WebView(this);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(downloads, "VoidAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAppOrigin(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAppAsset(request);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleMediaPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (pendingPermission == request) pendingPermission = null;
                });
            }
        });

        container.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(container);
        web.loadUrl(ORIGIN + "/");
    }

    private static boolean isAppOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getEncodedAuthority());
    }

    private static Map<String, String> contentTypes() {
        Map<String, String> types = new HashMap<>();
        types.put("html", "text/html");
        types.put("js", "text/javascript");
        types.put("css", "text/css");
        types.put("png", "image/png");
        types.put("webp", "image/webp");
        types.put("woff2", "font/woff2");
        types.put("wasm", "application/wasm");
        types.put("svg", "image/svg+xml");
        types.put("webmanifest", "application/manifest+json");
        return Collections.unmodifiableMap(types);
    }

    private WebResourceResponse serveAppAsset(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!isAppOrigin(url) || !"GET".equals(request.getMethod())) return rejected(403, "Forbidden");
        String path = url.getPath();
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (!path.matches("/[a-zA-Z0-9_/.-]+") || path.contains("..")) return rejected(404, "Not Found");
        String name = path.substring(1);
        String extension = name.substring(name.lastIndexOf('.') + 1);
        String mime = CONTENT_TYPES.getOrDefault(extension, "application/octet-stream");
        boolean text = mime.startsWith("text/") || extension.equals("webmanifest");
        try {
            InputStream stream = getAssets().open("site/" + name);
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", CONTENT_POLICY);
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime, text ? "UTF-8" : null, 200, "OK", headers, stream);
        } catch (IOException missing) {
            return rejected(404, "Not Found");
        }
    }

    private static WebResourceResponse rejected(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0]));
    }

    private void handleMediaPermission(PermissionRequest request) {
        if (isFinishing() || isDestroyed() || !isAppOrigin(request.getOrigin()) || pendingPermission != null) {
            request.deny();
            return;
        }
        List<String> required = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = androidPermissionFor(resource);
            if (permission == null) {
                request.deny();
                return;
            }
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) required.add(permission);
        }
        if (required.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingPermission = request;
            requestPermissions(required.toArray(new String[0]), CAPTURE_PERMISSION_REQUEST);
        }
    }

    private static String androidPermissionFor(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != CAPTURE_PERMISSION_REQUEST || pendingPermission == null) return;
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        List<String> granted = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = androidPermissionFor(resource);
            if (permission != null && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
                granted.add(resource);
            }
        }
        if (granted.isEmpty() || isFinishing()) request.deny();
        else request.grant(granted.toArray(new String[0]));
    }

    @Override
    public void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    public void onDestroy() {
        if (pendingPermission != null) {
            pendingPermission.deny();
            pendingPermission = null;
        }
        if (web != null) {
            web.removeJavascriptInterface("VoidAndroid");
            if (web.getParent() instanceof FrameLayout) ((FrameLayout) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        downloads.abortAll();
        super.onDestroy();
    }

    private static final class Download {
        final Uri uri;
        final OutputStream stream;

        Download(Uri uri, OutputStream stream) {
            this.uri = uri;
            this.stream = stream;
        }
    }

    public final class Downloads {
        private final Map<String, Download> pending = new HashMap<>();

        @JavascriptInterface
        public synchronized String beginDownload(String name, String type) {
            if (pending.size() >= 4 || name == null || !name.matches("VOID-(export|original|take)\\.(mp4|webm)")) return "";
            if (!("video/mp4".equals(type) || "video/webm".equals(type))) return "";
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, type);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VOID Studio");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = null;
            try {
                uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return "";
                OutputStream stream = getContentResolver().openOutputStream(uri);
                if (stream == null) {
                    getContentResolver().delete(uri, null, null);
                    return "";
                }
                String key = UUID.randomUUID().toString();
                pending.put(key, new Download(uri, stream));
                return key;
            } catch (IOException | RuntimeException failure) {
                if (uri != null) removeIncomplete(uri);
                return "";
            }
        }

        @JavascriptInterface
        public synchronized boolean appendDownload(String key, String data) {
            Download download = pending.get(key);
            if (download == null || data == null || data.length() > 262_144) return false;
            try {
                download.stream.write(Base64.decode(data, Base64.DEFAULT));
                return true;
            } catch (IOException | IllegalArgumentException failure) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean finishDownload(String key, boolean complete) {
            Download download = pending.remove(key);
            if (download == null) return false;
            try {
                download.stream.close();
                if (complete) {
                    ContentValues published = new ContentValues();
                    published.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    if (getContentResolver().update(download.uri, published, null, null) == 1) return true;
                }
            } catch (IOException | RuntimeException failure) {
                // Remove unfinished files so they never appear as valid takes.
            }
            removeIncomplete(download.uri);
            return false;
        }

        private void removeIncomplete(Uri uri) {
            try {
                getContentResolver().delete(uri, null, null);
            } catch (RuntimeException ignored) { }
        }

        private synchronized void abortAll() {
            for (String key : new ArrayList<>(pending.keySet())) finishDownload(key, false);
        }
    }
}
