import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ro from '../locales/ro.json';

export async function initI18n(language: string = 'en') {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(language);
    return;
  }
  await i18n
    .use(initReactI18next)
    .init({
      resources: { en: { translation: en }, ro: { translation: ro } },
      lng: language,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });
}
