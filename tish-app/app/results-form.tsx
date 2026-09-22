import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBackOrHome } from '@/utils/navigation';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { announcementLocaleFrom } from '@/utils/announcements';
import { localisedName } from '@/utils/vocabulary';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { appLocale } from '@/utils/locale';
import {
  Appbar,
  Button,
  HelperText,
  Text,
  TextInput
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { scanReport, ScanError, type ScanStage } from '@/utils/ocr';
import { scanReportLocally } from '@/utils/ocr-local';
import { matchRows, type ScanMatch } from '@/utils/ocr-match';
import { MOCK } from '@/constants/config';

// Design System Imports
import ActiveProfileBadge from '@/components/active-profile-badge';
import { useAuth } from '@/context/AuthContext';
import { a11yLang, heading } from '@/utils/accessibility';
import PlatformDatePicker from '../components/platform-date-picker';
import { COLORS, RADIUS, SHADOWS } from '../constants/theme';
import { GlobalStyles } from '../styles/globalstyles';
import { toLocalDateString } from '../utils/date';
import { apiErrorMessage, describeApiFailure } from '@/utils/api-errors';



export default function ResultsFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { t, i18n } = useTranslation();
  // Migration 018 — the test names are a localised vocabulary now, resolved the
  // same way the results dashboard resolves them, so the two screens cannot
  // label the same field differently.
  const vocabularyLocale = announcementLocaleFrom(i18n.language);
  const { activeDependent } = useAuth();

  // 1. Determine Mode (Add vs Edit)
  const isEdit = !!params.result;
  const initialData = isEdit ? JSON.parse(params.result as string) : null;

  const [configs, setConfigs] = useState<any[]>([]);
  const [formValues, setFormValues] = useState<any>(initialData || {});
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  // --- Report scanning ---
  // `scanStage` is non-null for the duration of a scan and drives both the
  // button's spinner and the one-line status under it. `scanned` remembers
  // which fields the last scan filled, so each one carries a "read from your
  // report — please check" note until the user edits it; `unmatched` is the
  // rest of the page's text, shown on request so a value for a field the
  // matcher could not place can still be found without leaving the form.
  const [scanStage, setScanStage] = useState<ScanStage | null>(null);
  // Which engine the running scan uses: the cloud function or the phone's
  // own recogniser. Two buttons for now, side by side, so the same photo can
  // be read by both and compared — see utils/ocr-local.ts for why.
  type ScanEngine = 'cloud' | 'local';
  const [scanEngine, setScanEngine] = useState<ScanEngine | null>(null);
  const [scanned, setScanned] = useState<Record<string, ScanMatch>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [showUnmatched, setShowUnmatched] = useState(false);

  // --- Date State ---
  const [date, setDate] = useState(new Date(initialData?.test_date || new Date()));
  const [showPicker, setShowPicker] = useState(false);

  const notifyUser = (title: string, message: string) => {
    if (Platform.OS === 'web') window.alert(`${title}: ${message}`);
    else Alert.alert(title, message);
  };

  // Was a bare .then() chain with no .catch(), and it cleared the loading flag
  // only on success — so offline or a 5xx left a permanent spinner with no
  // error and no way to retry.
  const loadConfigs = async () => {
    setLoading(true);
    setConfigError(false);
    try {
      const res = await apiRequest(`/test-config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfigs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Test config load failed:', e);
      setConfigError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfigs(); }, []);

  /**
   * Take or choose a photo, shrink it, send it for reading, and put what came
   * back into the inputs. **Nothing is saved here.** The values land in
   * `formValues` exactly as typed ones would, and leave through `handleSave`
   * with the same validation and the same confirmation.
   */
  const pickImage = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      // No cropping UI: a report is read whole, and the crop step is where
      // people lose the value column.
      allowsEditing: false,
      quality: 1,
      exif: false,
    };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { notifyUser(t('common.error'), t('resultsForm.scan.cameraDenied')); return null; }
      return ImagePicker.launchCameraAsync(options);
    }
    return ImagePicker.launchImageLibraryAsync(options);
  };

  /** The picked photo as a ≤2000px JPEG on local disk, ready to upload. */
  const prepareImage = async (source: 'camera' | 'library'): Promise<string | null> => {
    // Fixture mode has no file dialog to drive, and `scanReport` answers from
    // a fixture regardless of the URI — the same reason `mock.ts` exists.
    if (MOCK) return 'mock://report.jpg';

    let picked: ImagePicker.ImagePickerResult | null;
    try { picked = await pickImage(source); } catch { picked = null; }
    if (!picked || picked.canceled || !picked.assets?.[0]) return null;
    const asset = picked.assets[0];

    // Phone photos are 3000–4000px and several MB. 2000px on the long side
    // is what the OCR function downsizes to anyway, so do it here, once, and
    // upload a fifth of the bytes. Smaller images are left alone.
    const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
    const context = ImageManipulator.manipulate(asset.uri);
    if (longest > 2000) {
      context.resize(asset.width >= asset.height ? { width: 2000 } : { height: 2000 });
    }
    const rendered = await context.renderAsync();
    const jpeg = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return jpeg.uri;
  };

  const runScan = async (source: 'camera' | 'library', engine: ScanEngine) => {
    setScanEngine(engine);
    setScanStage('preparing');
    try {
      const uri = await prepareImage(source);
      if (uri === null) return;

      const result = engine === 'local'
        ? await scanReportLocally(uri, setScanStage)
        : await scanReport(uri, setScanStage);
      console.log(`Report scan (${engine}): ${result.rows.length} rows in ${result.elapsedMs ?? '?'}ms`);
      const fill = matchRows(result.rows, configs);

      const filled = Object.keys(fill.values);
      // A rescan replaces what the previous scan proposed; anything the user
      // typed into an unmatched field stays.
      setFormValues((prev: any) => {
        const next = { ...prev };
        for (const key of filled) next[key] = fill.values[key].value;
        return next;
      });
      setFieldErrors({});
      setScanned(fill.values);
      setUnmatched(fill.unmatched);
      setShowUnmatched(filled.length === 0 && fill.unmatched.length > 0);
      if (!isEdit && fill.testDate) setDate(fill.testDate);

      notifyUser(
        t(engine === 'local' ? 'resultsForm.scan.doneTitleLocal' : 'resultsForm.scan.doneTitle'),
        filled.length === 0
          ? t('resultsForm.scan.doneNone')
          : t('resultsForm.scan.doneFilled', { filled: filled.length, total: configs.length }),
      );
    } catch (e) {
      console.error('Report scan failed:', e);
      const message =
        e instanceof ScanError && e.reason === 'api' && e.failure ? apiErrorMessage(e.failure, t)
        : e instanceof ScanError && e.reason === 'timeout' ? t('resultsForm.scan.timeout')
        : t('resultsForm.scan.failed');
      notifyUser(t('common.error'), message);
    } finally {
      setScanStage(null);
      setScanEngine(null);
    }
  };

  const chooseScanSource = (engine: ScanEngine) => {
    // The web picker is a file input; there is no camera to offer separately
    // (a phone browser adds "take photo" to that input by itself).
    if (Platform.OS === 'web') { runScan('library', engine); return; }
    const title = t(engine === 'local' ? 'resultsForm.scan.buttonLocal' : 'resultsForm.scan.button');
    Alert.alert(title, t('resultsForm.scan.sourcePrompt'), [
      { text: t('resultsForm.scan.takePhoto'), onPress: () => runScan('camera', engine) },
      { text: t('resultsForm.scan.choosePhoto'), onPress: () => runScan('library', engine) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  /**
   * parseFloat("12o") is 12, and parseFloat("abc") is NaN which serialises to
   * JSON null — so a typo was silently stored as a missing reading. Validate
   * before saving rather than after.
   */
  const validate = () => {
    const errors: Record<string, boolean> = {};
    for (const cfg of configs) {
      const key = `field_${cfg.field_number}`;
      const raw = formValues[key];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue; // blank is allowed
      // Number() rejects trailing junk that parseFloat happily truncates.
      if (!Number.isFinite(Number(String(raw).trim()))) errors[key] = true;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      notifyUser(t('common.error'), t('resultsForm.fixInvalidFields'));
      return;
    }

    try {
      setSaving(true);

      const payload: any = {
        id: initialData?.id,
        test_date: date.toISOString(),
        ...formValues
      };

      // Ensure numeric fields are cast to floats
      configs.forEach(cfg => {
        const key = `field_${cfg.field_number}`;
        const raw = payload[key];
        if (raw === undefined || raw === null || String(raw).trim() === '') {
          // Send an explicit null rather than "" so the column is cleared.
          if (key in payload) payload[key] = null;
          return;
        }
        payload[key] = Number(String(raw).trim());
      });

      const res = await apiRequest(`/test-results`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }, activeDependent?.id);

      if (res.ok) {
        if (Platform.OS === 'web') window.alert(isEdit ? t('resultsForm.saveSuccessUpdated') : t('resultsForm.saveSuccessRecorded'));
        goBackOrHome(router);
      } else {
        // Previously fell through silently on a non-2xx, so the form just sat
        // there looking like nothing had happened.
        notifyUser(t('common.error'), apiErrorMessage(await describeApiFailure(res), t));
      }
    } catch (e) {
      notifyUser(t('common.error'), t('resultsForm.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={GlobalStyles.centered}><ActivityIndicator color={COLORS.primary} size="large" /></View>;

  if (configError) {
    return (
      <View style={GlobalStyles.centered}>
        <Text style={styles.errorTitle}>{t('resultsForm.configLoadFailed')}</Text>
        <Text style={styles.errorBody}>{t('resultsForm.configLoadFailedHint')}</Text>
        <Button mode="contained" onPress={loadConfigs} icon="refresh" style={{ marginTop: 16 }}>
          {t('common.retry')}
        </Button>
        <Button mode="text" onPress={() => goBackOrHome(router)} textColor={COLORS.slate}>
          {t('common.cancel')}
        </Button>
      </View>
    );
  }

  return (
    <View style={GlobalStyles.container}>
      <Appbar.Header style={{ backgroundColor: COLORS.background }}>
        <Appbar.BackAction accessibilityLabel={t('a11y.common.goBack')} {...a11yLang()} onPress={() => goBackOrHome(router)} disabled={saving} />
        <Appbar.Content title={isEdit ? t('resultsForm.editTitle') : t('resultsForm.newTitle')} titleStyle={styles.headerTitle} />
        <ActiveProfileBadge />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={GlobalStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        
        {/* --- DATE SELECTION SECTION --- */}
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText} {...heading(2)}>{t('resultsForm.testDetails')}</Text>
        </View>

        <View style={styles.fieldContainer}>
            <Text style={styles.sectionLabel}>{t('resultsForm.testDate')}</Text>
            {/* Local-time formatting both ways below. `toISOString()` showed the
                previous day for anyone east of UTC before their offset, and
                `new Date('2026-07-30')` parses as UTC midnight — the same
                off-by-one-day defect in each direction. */}
            {Platform.OS === 'web' ? (
              <input
                type="date"
                aria-label={t('resultsForm.dateOfTest')}
                value={toLocalDateString(date)}
                onChange={(e) => {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
                    setDate(new Date(y, m - 1, d));
                  }
                }}
                style={webInputStyle}
              />
            ) : (
              <Pressable
                onPress={() => !saving && setShowPicker(true)}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.common.changeDate', {
                  label: t('resultsForm.dateOfTest'),
                  value: date.toLocaleDateString(appLocale()),
                })} {...a11yLang()}
              >
                <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants">
                    <TextInput
                        label={t('resultsForm.dateOfTest')}
                        accessibilityLabel={t('resultsForm.dateOfTest')} {...a11yLang()}
                        value={date.toLocaleDateString(appLocale())}
                        mode="outlined"
                        outlineColor={COLORS.background}
                        activeOutlineColor={COLORS.primary}
                        editable={false} tabIndex={-1}
                        style={styles.input}
                        right={<TextInput.Icon aria-hidden tabIndex={-1} icon="calendar" color={COLORS.primary} />}
                    />
                </View>
              </Pressable>
            )}
            {/* Standardized Helper height for vertical rhythm */}
            <HelperText type="info" visible={false} style={styles.helper}>{''}</HelperText>
        </View>

        <PlatformDatePicker
          visible={showPicker}
          value={date}
          mode="date"
          onConfirm={d => { setDate(d); setShowPicker(false); }}
          onDismiss={() => setShowPicker(false)}
        />

        {/* --- SCAN A REPORT --- */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
            <Text style={styles.sectionHeaderText} {...heading(2)}>{t('resultsForm.scan.section')}</Text>
        </View>
        <View style={styles.fieldContainer}>
          <View style={styles.scanRow}>
            <Button
              mode="outlined"
              icon="cloud-upload"
              onPress={() => chooseScanSource('cloud')}
              loading={scanEngine === 'cloud'}
              disabled={saving || scanStage !== null}
              textColor={COLORS.primary}
              style={[styles.scanButton, styles.scanButtonHalf]}
              accessibilityHint={t('resultsForm.scan.hint')} {...a11yLang()}
            >
              {scanEngine === 'cloud' && scanStage ? t(`resultsForm.scan.stage.${scanStage}`) : t('resultsForm.scan.button')}
            </Button>
            {/* On-device recognition: no web equivalent, so the button is
                not offered there rather than offered and failing. */}
            {Platform.OS !== 'web' && (
              <Button
                mode="outlined"
                icon="cellphone"
                onPress={() => chooseScanSource('local')}
                loading={scanEngine === 'local'}
                disabled={saving || scanStage !== null}
                textColor={COLORS.slate}
                style={[styles.scanButton, styles.scanButtonHalf, styles.scanButtonLocal]}
                accessibilityHint={t('resultsForm.scan.hintLocal')} {...a11yLang()}
              >
                {scanEngine === 'local' && scanStage ? t(`resultsForm.scan.stage.${scanStage}`) : t('resultsForm.scan.buttonLocal')}
              </Button>
            )}
          </View>
          <HelperText type="info" visible style={styles.scanHelper}>
            {Platform.OS === 'web' ? t('resultsForm.scan.hint') : t('resultsForm.scan.hintBoth')}
          </HelperText>
        </View>

        {/* --- NUMERIC RESULTS SECTION --- */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
            <Text style={styles.sectionHeaderText} {...heading(2)}>{t('resultsForm.numericValues')}</Text>
        </View>

        {configs.map((cfg) => {
          const key = `field_${cfg.field_number}`;
          const hasError = !!fieldErrors[key];
          // Still exactly what the scan proposed, and not yet touched — the
          // note goes as soon as the user edits the value, because from then
          // on it is theirs.
          const fromScan = !!scanned[key] && String(formValues[key] ?? '') === scanned[key].value;
          // Units are optional — a ratio or a blood group has none — so the
          // parenthesis is only drawn when there is something to put in it,
          // rather than labelling the input "Fasting glucose (undefined)".
          const name = localisedName(cfg, 'display_name', vocabularyLocale) ?? '';
          const label = cfg.units ? `${name} (${cfg.units})` : name;
          return (
            <View key={cfg.field_number} style={styles.fieldContainer}>
              <TextInput
                label={label}
                accessibilityLabel={label} {...a11yLang()}
                value={formValues[key]?.toString() || ''}
                mode="outlined"
                outlineColor={fromScan ? COLORS.primary : COLORS.background}
                activeOutlineColor={hasError ? COLORS.error : COLORS.primary}
                error={hasError}
                keyboardType="numeric"
                style={styles.input}
                onChangeText={(val) => {
                  setFormValues({ ...formValues, [key]: val });
                  if (hasError) setFieldErrors(prev => ({ ...prev, [key]: false }));
                }}
                disabled={saving}
              />
              {/* Reserved space keeps vertical rhythm whether or not a
                  message is showing. The scan note and the error share the
                  slot; an invalid number is the one that matters. */}
              <HelperText type={hasError ? 'error' : 'info'} visible={hasError || fromScan} style={styles.helper}>
                {hasError ? t('resultsForm.invalidNumber')
                  : fromScan ? t('resultsForm.scan.readFrom', { row: scanned[key].row })
                  : ''}
              </HelperText>
            </View>
          );
        })}

        {/* Everything the scan read that matched no field. Off by default
            when the scan filled something; on by default when it filled
            nothing, because then this list is the whole result. */}
        {unmatched.length > 0 && (
          <View style={styles.unmatchedBlock}>
            <Button
              mode="text"
              compact
              icon={showUnmatched ? 'chevron-up' : 'chevron-down'}
              onPress={() => setShowUnmatched((v) => !v)}
              textColor={COLORS.slate}
              accessibilityState={{ expanded: showUnmatched }} {...a11yLang()}
            >
              {t('resultsForm.scan.unmatchedToggle', { count: unmatched.length })}
            </Button>
            {showUnmatched && (
              <View style={styles.unmatchedList} accessibilityRole="list">
                <Text style={styles.unmatchedHint}>{t('resultsForm.scan.unmatchedHint')}</Text>
                {unmatched.map((row, i) => (
                  <Text key={i} style={styles.unmatchedRow} selectable>{row}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        <Button 
          mode="contained" 
          onPress={handleSave} 
          loading={saving} 
          disabled={saving}
          buttonColor={COLORS.primary}
          style={styles.saveButton}
          labelStyle={styles.saveButtonLabel}
          icon="check-circle"
        >
          {isEdit ? t('resultsForm.updateReport') : t('resultsForm.saveReport')}
        </Button>
      </ScrollView>
    </View>
  );
}

// Imports for Styles
import { apiRequest } from '@/utils/api';

const webInputStyle = {
    padding: '14px',
    borderRadius: '12px',
    border: '1px solid #E2E8F0',
    backgroundColor: 'white',
    width: '100%',
    fontFamily: 'inherit',
    fontSize: '16px',
    outline: 'none'
};

const styles = StyleSheet.create({
  headerTitle: { fontWeight: '800', fontSize: 18, color: COLORS.ink },
  errorTitle: { fontSize: 18, fontWeight: '800', color: COLORS.ink, textAlign: 'center', paddingHorizontal: 24 },
  errorBody: { fontSize: 14, color: COLORS.slate, textAlign: 'center', marginTop: 8, paddingHorizontal: 32, lineHeight: 20 },
  
  // Consistency logic
  fieldContainer: {
    marginBottom: 4,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
  },
  helper: {
    height: 20,
    marginTop: -2,
  },
  scanRow: {
    flexDirection: 'row',
    gap: 8,
  },
  scanButton: {
    borderRadius: RADIUS.md,
    borderColor: COLORS.primary,
    backgroundColor: 'white',
  },
  scanButtonHalf: {
    flex: 1,
  },
  scanButtonLocal: {
    borderColor: COLORS.slate,
  },
  scanHelper: {
    marginTop: 0,
    paddingHorizontal: 4,
  },
  unmatchedBlock: {
    marginTop: 4,
    marginBottom: 8,
  },
  unmatchedList: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 12,
  },
  unmatchedHint: {
    fontSize: 12,
    color: COLORS.slate,
    marginBottom: 8,
  },
  unmatchedRow: {
    fontSize: 14,
    color: COLORS.ink,
    lineHeight: 22,
  },

  sectionLabel: { 
    fontSize: 16, 
    fontWeight: '800', 
    color: COLORS.ink, 
    marginBottom: 8 
  },
  sectionHeader: { 
    marginTop: 12, 
    marginBottom: 16, 
    borderLeftWidth: 4, 
    borderLeftColor: COLORS.primary, 
    paddingLeft: 12 
  },
  sectionHeaderText: { 
    fontSize: 11, 
    fontWeight: '800', 
    color: COLORS.primary, 
    letterSpacing: 1 
  },

  saveButton: { 
    marginTop: 20, 
    borderRadius: RADIUS.lg, 
    height: 56, 
    justifyContent: 'center',
    ...SHADOWS.medium 
  },
  saveButtonLabel: { 
    fontSize: 16, 
    fontWeight: '800', 
    letterSpacing: 0.5 
  }
});