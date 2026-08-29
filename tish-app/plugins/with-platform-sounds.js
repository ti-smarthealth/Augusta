const { IOSConfig, withDangerousMod, withXcodeProject, assertValidAndroidAssetName } = require('expo/config-plugins');
const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { basename, parse, resolve } = require('path');

/**
 * Bundles the notification alert sounds, choosing a different encoding per
 * platform.
 *
 * **Why this exists rather than `sounds` on the `expo-notifications` plugin.**
 * That prop takes one flat array and copies every entry to *both* platforms —
 * it has no per-platform form. That is fine when one file plays everywhere, and
 * it is not, because the two platforms accept disjoint sets:
 *
 *  - **iOS refuses compressed audio for notification sounds.**
 *    `UNNotificationSound` accepts Linear PCM, IMA4/ADPCM, µLaw or aLaw in
 *    `.wav`/`.aiff`/`.caf` only, and *silently* substitutes the default chime
 *    for anything else — no error, no log. So iOS gets `.caf` carrying IMA4
 *    (Apple's own `afconvert -f caff -d ima4` recipe), which is ~4x smaller
 *    than the 16-bit PCM `.wav` this used to ship while staying inside the
 *    allowed set.
 *  - **Android plays whatever its media framework supports** and cannot open
 *    Core Audio Format at all, so it gets `.ogg` (Vorbis) — the encoding AOSP
 *    itself ships its stock notification sounds in, and ~12x smaller than the
 *    PCM `.wav`.
 *
 * Passing both extensions through the single `sounds` array is not merely
 * wasteful, it **fails the Android build**: `res/raw` derives a resource name
 * from the filename with the extension dropped, so `alarm_x.caf` and
 * `alarm_x.ogg` both resolve to `R.raw.alarm_x` and aapt2 rejects the duplicate.
 * Sharing one basename across the pair is what keeps `notificationSoundFile()`
 * in `constants/sounds.ts` able to derive both names from one key, so the split
 * has to happen here instead.
 *
 * Mirrors `setNotificationSounds` from `expo-notifications/plugin` on both
 * platforms — same destinations, same Xcode group — so swapping back to the
 * built-in prop stays a one-line change if it ever grows per-platform support.
 */
module.exports = function withPlatformSounds(config, { ios = [], android = [] } = {}) {
  // iOS: copy next to the app's sources and register as a bundle resource, or
  // the file ships nowhere and every alert falls back to the default chime.
  config = withXcodeProject(config, (config) => {
    const { projectRoot, projectName } = config.modRequest;
    if (!projectName) throw new Error('with-platform-sounds: unable to find the iOS project name.');

    const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);
    for (const relativePath of ios) {
      const fileName = basename(relativePath);
      copyFileSync(resolve(projectRoot, relativePath), resolve(sourceRoot, fileName));

      // Idempotent: prebuild re-runs against an existing project, and a second
      // PBXBuildFile for one path is a duplicate-output build error.
      if (!config.modResults.hasFile(`${projectName}/${fileName}`)) {
        IOSConfig.XcodeUtils.addResourceFileToGroup({
          filepath: `${projectName}/${fileName}`,
          groupName: projectName,
          isBuildFile: true,
          project: config.modResults,
        });
      }
    }
    return config;
  });

  // Android: res/raw, where the basename becomes a Java identifier.
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const rawPath = resolve(config.modRequest.projectRoot, 'android/app/src/main/res/raw');
      if (!existsSync(rawPath)) mkdirSync(rawPath, { recursive: true });

      for (const relativePath of android) {
        const fileName = basename(relativePath);
        // Throws on a name aapt2 would reject — a reserved word, a capital, a
        // leading digit — which is otherwise a confusing failure much later in
        // the Gradle build.
        assertValidAndroidAssetName(parse(fileName).name, 'with-platform-sounds');
        copyFileSync(resolve(config.modRequest.projectRoot, relativePath), resolve(rawPath, fileName));
      }
      return config;
    },
  ]);

  return config;
};
