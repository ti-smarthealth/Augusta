import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { COLORS } from '../constants/theme';
import { changeLanguage, LANGUAGE_LABELS, SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n';
import { a11yLang } from '../utils/accessibility';

interface LanguageToggleProps {
  /**
   * Absolutely positions the pill in the screen's top-right corner, for the
   * auth screens that have no Appbar to sit in. The parent must be the screen
   * root (or at least fill it), since that is what the pill anchors to.
   */
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One-tap language switch for screens reachable before sign-in. Signed-in
 * users change language in Profile; until then nothing on screen offered it,
 * so a zh-Hant speaker on a shared/new device faced an English login.
 *
 * The button shows the language it switches TO, written in that language —
 * exactly the audience who needs the switch can read it.
 */
export default function LanguageToggle({ floating, style }: LanguageToggleProps) {
  const { t, i18n } = useTranslation();

  const idx = SUPPORTED_LANGUAGES.indexOf(i18n.language as SupportedLanguage);
  const current = idx >= 0 ? SUPPORTED_LANGUAGES[idx] : 'en';
  const next = SUPPORTED_LANGUAGES[(SUPPORTED_LANGUAGES.indexOf(current) + 1) % SUPPORTED_LANGUAGES.length];

  return (
    <Pressable
      testID="language-toggle"
      onPress={() => changeLanguage(next)}
      accessibilityRole="button"
      accessibilityLabel={t('a11y.common.switchLanguage', { language: LANGUAGE_LABELS[next] })} {...a11yLang()}
      style={({ pressed, hovered }: any) => [
        styles.pill,
        floating && styles.floating,
        hovered && styles.hovered,
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <MaterialCommunityIcons aria-hidden name="translate" size={16} color={COLORS.slate} />
      <Text style={styles.label}>{LANGUAGE_LABELS[next]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: COLORS.surface,
  },
  hovered: { backgroundColor: COLORS.background },
  floating: {
    position: 'absolute',
    // Clear of the status bar on native; the browser has none.
    top: Platform.OS === 'web' ? 16 : Platform.OS === 'ios' ? 56 : 40,
    right: 16,
  },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.ink },
});
