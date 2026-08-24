import { Platform } from 'react-native';
import type { TextProps } from 'react-native';

import i18next from '../i18n';

/**
 * Tells VoiceOver which language an element's label is written in.
 *
 * This app's language is a stored preference, deliberately independent of the
 * device's. iOS knows nothing about that, so with the app in 中文 on an
 * English phone VoiceOver hands Chinese labels to an English voice — silence
 * or mangled output, depending on which voices are installed. WCAG 3.1.1.
 *
 * It has to go on the element that carries the label, not on a screen root.
 * RN assigns the prop to that one view's own accessibility element
 * (`RCTViewComponentView.mm`, `self.accessibilityElement.accessibilityLanguage`)
 * and nothing propagates it to descendants.
 *
 * iOS only: the prop does nothing on Android, where TalkBack takes its language
 * from the system TTS engine and exposes no per-element equivalent.
 *
 * Read from the i18next singleton rather than a hook so this stays usable from
 * anywhere. Every caller already re-renders on a language change — react-i18next
 * drives that through the `t` they are also using — so the value is current.
 */
export function a11yLang(): { accessibilityLanguage?: string } {
  return Platform.OS === 'ios' ? { accessibilityLanguage: i18next.language } : {};
}

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
