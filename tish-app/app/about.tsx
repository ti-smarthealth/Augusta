import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Divider, List, Surface, Text } from 'react-native-paper';

import { COLORS, RADIUS, SHADOWS, SPACING } from '../constants/theme';
import { GlobalStyles } from '../styles/globalstyles';
import { a11yLang, heading } from '@/utils/accessibility';
import { buildSummary } from '@/utils/build-info';
import { appLocale } from '@/utils/locale';
import { goBackOrHome } from '@/utils/navigation';

/**
 * What this phone is actually running.
 *
 * **Built because support could not answer "have you got the fix yet?"** JS
 * ships over the air without moving the app version, so two phones both
 * reporting `1.1.0` can be running code days apart — and a crash that was fixed
 * on Monday kept being reported on Wednesday with no way to tell whether the
 * fix had arrived. The revision below changes with every publish, so reading it
 * out settles the question in one sentence.
 */
export default function AboutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const info = buildSummary();

  const version = info.nativeBuild
    ? `${info.appVersion ?? '—'} (${info.nativeBuild})`
    : (info.appVersion ?? '—');

  // The embedded bundle is a real answer, not a missing one: it means no update
  // has ever been applied, which is exactly what support needs to hear.
  const revision = info.isEmbedded || !info.revision
    ? t('about.embedded')
    : info.revision;

  const updated = info.updatedAt
    ? info.updatedAt.toLocaleString(appLocale(), {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—';

  return (
    <View style={GlobalStyles.container}>
      <Appbar.Header style={{ backgroundColor: COLORS.background }}>
        <Appbar.BackAction accessibilityLabel={t('a11y.common.goBack')} {...a11yLang()} onPress={() => goBackOrHome(router)} />
        <Appbar.Content title={t('about.title')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={styles.card} elevation={0}>
          <List.Item
            title={t('about.version')}
            description={version}
            descriptionStyle={styles.value}
            left={p => <List.Icon {...p} icon="cellphone" color={COLORS.primary} />}
          />
          <Divider />
          <List.Item
            title={t('about.revision')}
            description={revision}
            descriptionStyle={styles.value}
            left={p => <List.Icon {...p} icon="tag-outline" color={COLORS.primary} />}
          />
          <Divider />
          <List.Item
            title={t('about.updated')}
            description={updated}
            descriptionStyle={styles.value}
            left={p => <List.Icon {...p} icon="clock-outline" color={COLORS.primary} />}
          />
        </Surface>

        <Text style={styles.hint} {...heading(2)}>{t('about.supportTitle')}</Text>
        <Text style={styles.hintBody}>{t('about.supportHint')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitle: { fontWeight: '800', fontSize: 18 },
  content: { padding: SPACING.lg },
  card: { backgroundColor: 'white', borderRadius: RADIUS.lg, overflow: 'hidden', ...SHADOWS.medium },
  // Monospaced-ish emphasis: these get read aloud down a phone line.
  value: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  hint: { marginTop: SPACING.xl, fontSize: 12, fontWeight: '800', color: COLORS.primary, letterSpacing: 1 },
  hintBody: { marginTop: 6, fontSize: 14, color: COLORS.slate, lineHeight: 20 },
});
