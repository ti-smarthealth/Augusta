import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';

import en from '../locales/en.json';
import zhHant from '../locales/zh-Hant.json';

export const SUPPORTED_LANGUAGES = ['en', 'zh-Hant'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-Hant': '繁體中文',
};

const LANGUAGE_STORAGE_KEY = 'user-language';

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return value === 'en' || value === 'zh-Hant';
}

function detectDeviceLanguage(): SupportedLanguage {
  const languageCode = Localization.getLocales()[0]?.languageCode;
  return languageCode === 'zh' ? 'zh-Hant' : 'en';
}

/**
 * Keep the web document's language in step with the app's.
 *
 * The language here is a stored user preference, not the device's, so nothing
 * else tells the browser about it — Expo's static web output ships a hardcoded
 * `<html lang="en">`. Left alone, a screen reader on the web build hands
 * Chinese strings to an English speech synthesiser. WCAG 3.1.1.
 *
 * No-op off web, where the document does not exist.
 */
function syncDocumentLanguage(lang: SupportedLanguage) {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
}

export async function initI18n() {
  const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  const lng = isSupportedLanguage(stored) ? stored : detectDeviceLanguage();

  await i18next.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      'zh-Hant': { translation: zhHant },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

  syncDocumentLanguage(lng);
}

export async function changeLanguage(lang: SupportedLanguage) {
  await i18next.changeLanguage(lang);
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  syncDocumentLanguage(lang);
}

export default i18next;
