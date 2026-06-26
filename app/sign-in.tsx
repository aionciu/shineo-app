import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { GoogleSignin, GoogleSigninButton } from '@react-native-google-signin/google-signin';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { theme } from '../constants/theme';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

export default function SignInScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleGoogleSignIn() {
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices();
      const { data } = await GoogleSignin.signIn();
      if (!data?.idToken) throw new Error('No ID token');
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: data.idToken,
      });
      if (error) throw error;
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Shineo</Text>
      <Text style={styles.tagline}>{t('screens.signIn.tagline')}</Text>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} size="large" />
      ) : (
        <GoogleSigninButton
          size={GoogleSigninButton.Size.Wide}
          color={GoogleSigninButton.Color.Dark}
          onPress={handleGoogleSignIn}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  logo: {
    fontSize: 40,
    fontWeight: '700',
    color: theme.colors.primary,
    fontFamily: 'Inter_700Bold',
  },
  tagline: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[4],
    fontFamily: 'Inter_400Regular',
  },
});
