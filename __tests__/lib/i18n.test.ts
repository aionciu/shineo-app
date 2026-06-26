import i18n from 'i18next';
import { initI18n } from '../../lib/i18n';

test('i18n initialises with en locale', async () => {
  await initI18n('en');
  expect(i18n.language).toBe('en');
  expect(i18n.t('common.signIn')).toBe('Sign In');
});

test('i18n switches to ro locale', async () => {
  await initI18n('ro');
  expect(i18n.t('common.signIn')).toBe('Autentificare');
});
