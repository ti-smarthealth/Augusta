import { Platform } from 'react-native';
import type { TextProps } from 'react-native';

/**
 * Marks a `Text` as a heading, so screen readers can navigate by it.
 *
 * Screen reader users move through a screen heading by heading — the VoiceOver
 * rotor's "Headings" mode, TalkBack's reading controls — rather than swiping
 * every element in order. A screen with no headings can only be read linearly,
 * which on a form like the medication reminder means swiping past two dozen
 * controls to reach the last section.
 *
 * Spread it onto the heading:
 *
 *     <Text style={styles.pageTitle} {...heading(1)}>{t('...')}</Text>
 *
 * `level` only reaches the web build. iOS and Android expose "is a heading" as
 * a boolean trait with no hierarchy, so there is nothing to map a level onto;
 * react-native-web does forward `aria-level` to the DOM, where it gives the
 * desktop layout a real heading outline. React Native's own types don't declare
 * `aria-level` (checked against 0.83.6), hence the assertion.
 *
 * Convention in this app:
 *   1 — the screen's own title
 *   2 — a section within a screen
 *
 * Paper's `Appbar.Content` already marks its title as a heading, so screens
 * with an Appbar do not need `heading()` on the title as well.
 */
export function heading(level: 1 | 2 | 3): TextProps {
  const role: TextProps = { accessibilityRole: 'header' };
  return Platform.OS === 'web' ? ({ ...role, 'aria-level': level } as TextProps) : role;
}
