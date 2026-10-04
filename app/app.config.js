/**
 * app.json, plus the Android TV variant when built with EXPO_TV=1: its own name
 * ("128bitPlay TV") and package id, so it installs next to the phone app.
 */
module.exports = ({ config }) => {
  if (process.env.EXPO_TV !== '1') return config;
  return {
    ...config,
    name: '128bitPlay TV',
    android: { ...config.android, package: `${config.android.package}.tv` },
    plugins: [...config.plugins, './plugins/with-android-tv'],
  };
};
