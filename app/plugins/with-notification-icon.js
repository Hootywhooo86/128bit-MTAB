/**
 * The 128bit logo as the small icon of the app's notifications (audiobook lock screen and
 * media controls, torrent downloads): copies the white-on-clear logo into the Android
 * resources as `ic_stat_128bit`, which the native code looks up by name.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/drawable-xxxhdpi');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(
        path.join(cfg.modRequest.projectRoot, 'assets/images/android-icon-monochrome.png'),
        path.join(dir, 'ic_stat_128bit.png'),
      );
      return cfg;
    },
  ]);
