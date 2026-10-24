import { Platform } from 'react-native';
import Constants from 'expo-constants';

interface RouteMapExtra {
  androidGoogleMapsEnabled?: unknown;
}

/**
 * Whether cardio routes can be drawn over a real map. iOS always can, with
 * Apple Maps. Android can only when the build was given a Google Maps key
 * (see GOOGLE_MAPS_ANDROID_API_KEY in app.config.ts); a map without one
 * renders blank, so those builds keep the plain route line.
 */
export function canShowRouteMap(
  os: string = Platform.OS,
  extra: RouteMapExtra | undefined = Constants.expoConfig?.extra
): boolean {
  if (os === 'ios') return true;
  if (os === 'android') return extra?.androidGoogleMapsEnabled === true;
  return false;
}
