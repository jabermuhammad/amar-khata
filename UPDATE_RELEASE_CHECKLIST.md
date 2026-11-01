# Amar Khata Android release checklist

This is a local checklist only. It is not the live `update.json`; do not upload this document or `update.schema.json` to the update repository. The app must receive real release metadata. Do not fill release metadata before the APK asset exists.

## Current bootstrap configuration

- App version: `1.0.1`
- Android `versionCode`: `2` (the next release after this bootstrap must use a larger value, such as `3`)
- Android package: `com.jabermuhammad1.amarkhatamobile`
- Manifest endpoint configured by the Production EAS profile: `https://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/update.json`
- The endpoint currently returns 404 and the GitHub update repository has no Release. This is expected until the first release artifacts are published.

## After the first Production APK is built

1. Download the completed APK artifact from EAS. Do not rename, recompress, patch, or otherwise alter its bytes after collecting metadata.
2. Verify the APK package ID, app version, and Android version code from the artifact. Confirm they are `com.jabermuhammad1.amarkhatamobile`, `1.0.1`, and `2` respectively.
3. Confirm the APK signature matches the existing installed Amar Khata build. Continue using the same EAS-managed Android keystore; do not regenerate or replace it. Do not uninstall the installed app as part of the update test.
4. Create a GitHub Release in `jabermuhammad/amar-khata-updates` tagged `v1.0.1` and upload the exact APK artifact. Use the final published asset's HTTPS download URL as `apkUrl`.
5. From the exact APK file that was uploaded, collect its SHA-256 and byte length. On Windows PowerShell:

   ```powershell
   $apkPath = 'C:\path\to\the\downloaded\amar-khata-1.0.1.apk'
   Get-FileHash -LiteralPath $apkPath -Algorithm SHA256
   (Get-Item -LiteralPath $apkPath).Length
   ```

   Replace `$apkPath` with the actual downloaded APK path. These commands must be run against the final release asset (or byte-identical artifact); do not type or estimate either metadata value.
6. Create `update.json` in the update repository's `main` branch with exactly these fields, using only the real values collected above:

   - `packageId`: `com.jabermuhammad1.amarkhatamobile`
   - `version`: the APK's actual version name (`1.0.1` for the bootstrap artifact)
   - `versionCode`: the APK's actual Android version code (`2` for the bootstrap artifact)
   - `apkUrl`: the actual HTTPS GitHub Release asset URL
   - `sha256`: the actual 64-character SHA-256 digest
   - `sizeBytes`: the actual APK length in bytes
   - `changelog`: an array of release-note strings

   The Android app rejects an APK over 150 MiB, a non-positive or mismatched size, an invalid SHA-256, the wrong package ID, or malformed version fields. `update.schema.json` records the accepted data shape for local reference.
7. Publish/commit `update.json` only after the Release asset exists. Then open the configured raw manifest URL and confirm it returns valid JSON whose APK URL, digest, and size match the public Release asset exactly.
8. The bootstrap APK has version code `2`, so it will not offer itself as an update. For the next APK, increase `versionCode` above `2` and use the actual new APK metadata in the manifest. The app offers an update only when manifest `versionCode` is greater than the installed code.
9. On a phone, test the update notice, APK download and digest/size checks, Android's unknown-app installation prompt, and in-place installation. Android may require the user to allow installs from Amar Khata and to confirm the install.

## Manifest constraints implemented by the app

- Required fields: `packageId`, `version`, `versionCode`, `apkUrl`, `sha256`, `changelog`, `sizeBytes`.
- `version` must contain two to four numeric dot-separated parts.
- `versionCode` must be a positive safe integer.
- `apkUrl` must use HTTPS.
- `sha256` must contain 64 hexadecimal characters.
- `changelog` must be an array of strings.
- `sizeBytes` must be a positive safe integer no greater than 157,286,400 bytes.
- The update is shown only when `versionCode` is higher than the installed app's code. Dismissal is remembered for seven days for that version code.
