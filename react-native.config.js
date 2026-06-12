/**
 * Mesh SDK is linked manually on Android (settings.gradle) and iOS would
 * use Podfile if needed. Disabling autolinking prevents duplicate Gradle
 * projects (:mesh-sdk vs :offline-protocol_mesh-sdk) on Gradle 8.14+.
 */
module.exports = {
  dependencies: {
    '@offline-protocol/mesh-sdk': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
