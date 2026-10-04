/**
 * Android TV build (EXPO_TV=1): shows the app in the TV launcher with a banner, and
 * says touch and the leanback UI are optional so the same APK also installs on phones.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

function withTvManifest(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    for (const name of ['android.software.leanback', 'android.hardware.touchscreen']) {
      if (!features.some((f) => f.$['android:name'] === name)) {
        features.push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    }
    const app = manifest.application[0];
    app.$['android:banner'] = '@drawable/tv_banner';
    const main = app.activity.find((a) => a.$['android:name'] === '.MainActivity');
    const launcher = main['intent-filter'].find((f) =>
      f.action?.some((a) => a.$['android:name'] === 'android.intent.action.MAIN'),
    );
    if (!launcher.category.some((x) => x.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
      launcher.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
    }
    return c;
  });
}

function withTvBanner(config) {
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(c.modRequest.projectRoot, 'assets/images/tv-banner.png'), path.join(dir, 'tv_banner.png'));
      return c;
    },
  ]);
}

module.exports = (config) => withTvBanner(withTvManifest(config));
