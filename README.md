# VOID Studio

VOID Studio is an installable camera PWA with an animated portal, four elemental effects, on-device hand and body tracking, and a local library of takes.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Demo opens without permissions. Tap the camera button to enable live tracking. Use the floating controls or point with one finger and pinch your thumb and index finger to select a control. Hold the pinch to confirm recording or camera switching. The Gestures panel explains the movements for each effect.

Use **Finished video** to record the camera with effects included. **Editable take** saves a 10–30 second clean clip with timed tracking and effect settings. In **Takes**, change the effect, palette, or intensity and export the result. The live subject mask is used for preview and finished recordings. Editable takes replay the captured landmarks without the mask. All processing and take storage stay in the browser.

```sh
npm run build
npm run preview
```

Serve the contents of `dist/` at the root of an HTTPS origin to use the camera on a phone. Use Chrome's install option on Android or Safari's **Share → Add to Home Screen** on iPhone. Browsers also allow camera access from their own localhost. Demo and previously loaded model assets are available offline in the production build. Install behavior, available lenses, hardware settings, and export codecs depend on the browser and device. Estimated depth uses a camera-based subject mask rather than LiDAR.

The first development start or build downloads the pinned model files and verifies their checksums. The built site serves the models and runtime from its own origin.

The vision tasks use Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) and [Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) models and run locally.

## Android apps

Open the [live studio](https://void-studio-liart.vercel.app) in Android Chrome and tap **Install**. The installed web app requests camera access on first launch. In a regular browser tab, tap **Use camera** when you're ready.

The signed [Android APK](https://github.com/jdmiami/Void-studio/releases/download/v1.1.0/void-studio.apk) runs on Android 10 and newer. Open the APK to install it, then grant camera access when Android asks. The APK includes the studio and vision models for offline use. It requests microphone access when recording with microphone audio enabled, and saves exports in **Downloads → VOID Studio**.

To build the Android package locally, install SDK Platform 35 and Android SDK Build Tools 35.0.0. Point `ANDROID_SDK_ROOT` at the SDK and run:

```sh
scripts/build-android.sh
```

The script signs the APK with the local key in `~/.local/share/void-studio/android-signing` unless `VOID_ANDROID_SIGNING_DIR` is set. Keep the key under your control and reuse it for Android app updates. The default output is `android/out/void-studio.apk`.
