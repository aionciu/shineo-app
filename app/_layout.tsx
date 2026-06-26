import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import * as ExpoLocalization from 'expo-localization';
import { SessionProvider, useSession } from '../lib/auth';
import { initI18n } from '../lib/i18n';
import { useAppConfig } from '../hooks/useAppConfig';
import { ForceUpdateScreen } from '../components/ForceUpdateScreen';
import Constants from 'expo-constants';

SplashScreen.preventAutoHideAsync();

function RootLayoutInner() {
  const { session, profile, isLoading, profileLoaded } = useSession();
  const { config, isLoading: configLoading } = useAppConfig();

  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    const lang = profile?.language ?? ((ExpoLocalization.getLocales?.()?.[0]?.languageTag ?? '').startsWith('ro') ? 'ro' : 'en');
    initI18n(lang);
  }, [profile?.language]);

  useEffect(() => {
    if (!isLoading && !configLoading && fontsLoaded) SplashScreen.hideAsync();
  }, [isLoading, configLoading, fontsLoaded]);

  if (isLoading || configLoading || !fontsLoaded) return null;

  // Force update check
  const minVersion = config['min_app_version'];
  const currentVersion = Constants.expoConfig?.version ?? '0.0.0';
  if (minVersion && compareVersions(currentVersion, minVersion) < 0) {
    return <ForceUpdateScreen />;
  }

  if (!session) return <Redirect href="/sign-in" />;
  if (profileLoaded && !profile?.onboarded) return <Redirect href="/profile-setup" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(app)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="profile-setup" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootLayoutInner />
    </SessionProvider>
  );
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}
