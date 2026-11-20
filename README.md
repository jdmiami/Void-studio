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

Open the [live studio](https://v0d.vercel.app) in Android Chrome and tap **Install**. The installed web app requests camera access on first launch. In a regular browser tab, tap **Use camera** when you're ready.

The signed [Android APK](https://v0d.vercel.app/d/void-studio.apk) runs on Android 10 and newer. Open the APK to install it, then grant camera access when Android asks. The APK includes the studio and vision models for offline use. It requests microphone access when recording with microphone audio enabled, and saves exports in **Downloads → VOID Studio**.

To build the Android package locally, install SDK Platform 35 and Android SDK Build Tools 35.0.0. Point `ANDROID_SDK_ROOT` at the SDK and run:

```sh
scripts/build-android.sh
```

The script signs the APK with the local key in `~/.local/share/void-studio/android-signing` unless `VOID_ANDROID_SIGNING_DIR` is set. Keep the key under your control and reuse it for Android app updates. The default output is `android/out/void-studio.apk`.

## iPhone and iPad

[Download the unsigned device build](https://v0d.vercel.app/d/VoidStudio-iphoneos-unsigned.zip) or [the iOS Simulator build](https://v0d.vercel.app/d/VoidStudio-iphonesimulator.zip).

The Xcode app targets iOS and iPadOS 17 or newer. **Studio** opens the existing camera studio. **LiDAR** opens the native rear camera and uses ARKit's scene depth for a heat map, a distance reading where you tap, and a veil that darkens surfaces past the selected distance. The LiDAR mode can share JPEGs and silent MP4 clips. Studio offers the original gesture effects and microphone recording.

Rear LiDAR is available on the iPhone 14 Pro Max and both M2 iPad Pro sizes. The app checks ARKit support at runtime. The simulator and devices without a depth sensor can still open Studio. These distance readings are for creative framing and effects.

The [Apple build workflow](https://github.com/jdmiami/Void-studio/actions/workflows/apple.yml) compiles both device and simulator apps on a macOS runner. An unsigned device build cannot be installed on a phone or iPad. To run on hardware, open `ios/VoidStudio.xcodeproj` in Xcode, choose your Apple team under **Signing & Capabilities**, connect the device, and run the VoidStudio scheme. TestFlight distribution requires an Apple Developer account and a signed archive.

The public launcher and downloads are assembled with `npm run web:release`. This copies the web camera to `/cam/`, verifies the native release packages and adds the downloadable web and source archives.
