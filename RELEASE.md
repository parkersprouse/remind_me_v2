# Releasing a signed APK

This app is distributed as a **manually-installed signed APK** (no Play Store).
Android refuses to install an unsigned APK, and every update must be signed with
the **same** key as the version it replaces — so the release key is the single
most important artifact to create once and guard forever.

## One-time setup: create the release key

Generate an RSA keystore that lives **outside** the repo (so it can never be
committed). Pick a strong password and keep it with the keystore.

```sh
mkdir -p ~/.android-keystores
keytool -genkeypair -v \
  -keystore ~/.android-keystores/remind-me-release.jks \
  -alias remind-me \
  -keyalg RSA -keysize 2048 -validity 10000
# You'll be prompted for a store password, a key password (press Enter to reuse
# the store password), and a name/org. Validity 10000 days ≈ 27 years.
```

Then create `src-tauri/gen/android/keystore.properties` (gitignored) by copying
the template and filling in real values:

```sh
cp src-tauri/gen/android/keystore.properties.example \
   src-tauri/gen/android/keystore.properties
```

```properties
storeFile=/Users/<you>/.android-keystores/remind-me-release.jks
storePassword=<your store password>
keyAlias=remind-me
keyPassword=<your key password>
```

`storeFile` is an **absolute** path. `keystore.properties` and `*.jks` are both
gitignored — never commit either.

### ⚠️ Back up the keystore

If you lose `remind-me-release.jks` or its passwords, you can **never ship an
update to already-installed copies again** — users would have to uninstall and
reinstall (losing their local `reminders.db`). Copy the `.jks` and its passwords
to a password manager / offline backup now.

## Cut a release

1. **Bump the version.** `pnpm run release` (below) does this automatically
   before building — a `--minor` bump by default, or pass `--patch` / `--major`
   to pick the increment (`--skip-semver` to build without bumping). It updates
   the version in every file that hard-codes it (`package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`)
   via `scripts/bump-version.mjs`; run `pnpm run version:bump [--patch|--minor|--major]`
   to bump without building. `tauri.conf.json` is the canonical source, so Tauri
   propagates the new version to `versionName`/`versionCode` in
   `gen/android/app/tauri.properties` on the next build — no Android file is
   edited by hand. `versionCode` must strictly increase for every release (Tauri
   derives it from the semver, e.g. `1.0.0` → `1000000`, `1.0.1` → `1000100`).

2. **Build the signed release APK** (universal, or append `--target aarch64` for
   a single ABI — the output path is the same either way):

   ```sh
   pnpm release:build          # → tauri android build --apk
   ```

   Output:
   `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

   Gradle reads `keystore.properties` and signs automatically. If the file is
   absent the build still succeeds but the APK is **unsigned** (won't install) —
   that's the intended fail-safe, not a signing failure.

3. **Verify the signature** before distributing:

   ```sh
   pnpm release:verify
   ```

   This resolves `apksigner` from the Android SDK (`$ANDROID_HOME`,
   `$ANDROID_SDK_ROOT`, or `~/Library/Android/sdk`) and prints the signing
   certs. Expect `Verified using v2 scheme (APK Signature Scheme v2): true` and a
   certificate DN matching the name you entered into `keytool` — **not** the
   Android debug key. (v1 is off by design: it's only needed below API 24, and
   `minSdk` is 24.)

   `pnpm release` bumps the version (step 1), then runs the build and the verify
   back-to-back — pass the increment flag through to it, e.g. `pnpm release --patch`
   (default `--minor`, or `--skip-semver` to leave the version untouched).

4. **Distribute** the `.apk`. Users install via
   `adb install app-universal-release.apk`, or by opening the file on-device
   after enabling "install unknown apps" for their file manager/browser.

## Notes

- **Release builds are minified** (R8, `isMinifyEnabled = true`). The reflective
  Tauri plugin surface (notifications, the `@JavascriptInterface` bridge in
  `MainActivity.kt`) is kept by the Tauri AAR's consumer ProGuard rules plus
  R8's built-in `@JavascriptInterface` rule — verified by installing the signed
  release build and exercising the notification flow. If you ever add a new
  reflectively-invoked native method, confirm it survives R8 the same way (it
  will be listed in `build/outputs/mapping/universalRelease/seeds.txt`).
- The Rust `[profile.release]` in `src-tauri/Cargo.toml` strips symbols and
  optimizes for size; a release APK is ~10 MB vs. the ~30 MB debug APK.
- To sign an **AAB** instead (e.g. for future Play Store use) drop `--apk`; the
  same `signingConfig` applies.
