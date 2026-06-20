import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Requests necessary Bluetooth and location permissions for offline mesh messaging.
 * Permission requirements vary based on Android version.
 * @returns True if all required permissions are granted, false otherwise
 */
export async function requestOfflineMeshPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const androidVersion = Number(Platform.Version);

  try {
    if (androidVersion >= 31) {
      const requiredPermissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      if (androidVersion >= 33) {
        requiredPermissions.push(
          PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
        );
      }

      const result = await PermissionsAndroid.requestMultiple(requiredPermissions);

      const corePermissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      const bluetoothAndLocationGranted = corePermissions.every(
        permission => result[permission] === PermissionsAndroid.RESULTS.GRANTED,
      );

      if (androidVersion >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      }

      return bluetoothAndLocationGranted;
    }

    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);

    return Object.values(result).every(
      value => value === PermissionsAndroid.RESULTS.GRANTED,
    );
  } catch (error) {
    console.error('[OFFLINE PERMISSIONS FAILED]', error);
    return false;
  }
}