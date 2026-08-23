import { Platform, useWindowDimensions } from 'react-native';
import { LAYOUT } from '../constants/theme';

/**
 * True when the app is running in a browser wide enough for the desktop
 * layout: sidebar navigation instead of the bottom tab bar, and content
 * clamped to a centered column.
 *
 * Web-only on purpose. A landscape tablet running the native app keeps the
 * phone layout — the desktop treatment exists for browser windows, and the
 * native experience is designed and tested around the bottom bar.
 */
export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= LAYOUT.desktopMinWidth;
}
