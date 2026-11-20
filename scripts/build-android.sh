#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
project="$PWD"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk" ]]; then
  echo 'Set ANDROID_SDK_ROOT to an Android SDK with Platform 35 and Build Tools 35.0.0.' >&2
  exit 1
fi

tools="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
if [[ ! -x "$tools/aapt2" || ! -f "$platform" ]]; then
  echo 'Install Android SDK Platform 35 and Build Tools 35.0.0.' >&2
  exit 1
fi

key_dir="${VOID_ANDROID_SIGNING_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/void-studio/android-signing}"
keystore="$key_dir/release.p12"
password_file="$key_dir/password"
alias_name=void-studio
if [[ ! -f "$keystore" ]]; then
  (umask 077
   mkdir -p "$key_dir"
   if [[ ! -f "$password_file" ]]; then openssl rand -hex 32 > "$password_file"; fi
   keytool -genkeypair -alias "$alias_name" -keyalg RSA -keysize 3072 -validity 10000 \
     -keystore "$keystore" -storetype PKCS12 -dname "CN=VOID Studio" \
     "-storepass:file" "$password_file" "-keypass:file" "$password_file")
fi
if [[ ! -f "$password_file" ]]; then
  echo 'The signing password file is missing. Restore it beside the keystore.' >&2
  exit 1
fi

npm run build
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/assets/site" "$work/classes" "$work/dex"
cp -R dist/. "$work/assets/site/"
source_dir="$project/android/app/src/main"
"$tools/aapt2" compile --dir "$source_dir/res" -o "$work/resources.zip"

debug_flags=()
if [[ "${VOID_ANDROID_DEBUG:-0}" = 1 ]]; then debug_flags+=(--debug-mode); fi
"$tools/aapt2" link -o "$work/base.apk" -I "$platform" --manifest "$source_dir/AndroidManifest.xml" \
  --min-sdk-version 29 --target-sdk-version 35 --version-name 1.1.0 --version-code 2 \
  -A "$work/assets" "${debug_flags[@]}" "$work/resources.zip"

java_file="$source_dir/java/studio/voidcamera/app/MainActivity.java"
boot_classes="$platform:$tools/core-lambda-stubs.jar"
if command -v javac >/dev/null; then
  javac -source 8 -target 8 -encoding UTF-8 -bootclasspath "$boot_classes" -d "$work/classes" "$java_file"
elif [[ -n "${VOID_ECJ_JAR:-}" ]]; then
  java -jar "$VOID_ECJ_JAR" -1.8 -proc:none -encoding UTF-8 -bootclasspath "$boot_classes" -d "$work/classes" "$java_file"
else
  echo 'Use JDK 17 or later, or set VOID_ECJ_JAR to an Eclipse Java compiler JAR.' >&2
  exit 1
fi
(cd "$work/classes" && zip -qr "$work/classes.zip" .)
"$tools/d8" --min-api 29 --lib "$platform" --output "$work/dex" "$work/classes.zip"
(cd "$work/dex" && zip -q "$work/base.apk" classes.dex)
"$tools/zipalign" -f -p 4 "$work/base.apk" "$work/aligned.apk"

output="${1:-$project/android/out/void-studio.apk}"
mkdir -p "$(dirname "$output")"
"$tools/apksigner" sign --ks "$keystore" --ks-key-alias "$alias_name" \
  --ks-pass "file:$password_file" \
  --out "$output" "$work/aligned.apk"
"$tools/apksigner" verify --verbose "$output"
printf '\nAPK ready at %s\n' "$output"
