import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useSession } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { theme } from '../constants/theme';
import { useAppConfig } from '../hooks/useAppConfig';

const E164_REGEX = /^\+\d{7,15}$/;

export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const { session, refreshProfile } = useSession();
  const { config } = useAppConfig();

  const googleName = session?.user.user_metadata?.full_name ?? '';
  const googleAvatar = session?.user.user_metadata?.avatar_url ?? null;

  const [displayName, setDisplayName] = useState(googleName);
  const [phone, setPhone] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [carMake, setCarMake] = useState('');
  const [carModel, setCarModel] = useState('');
  const [carPlate, setCarPlate] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    if (!privacyAccepted) {
      Alert.alert(t('common.error'), t('common.acceptPrivacyPolicy'));
      return;
    }
    if (!displayName.trim()) {
      Alert.alert(t('common.error'), t('screens.profileSetup.nameRequired'));
      return;
    }
    if (phone && !E164_REGEX.test(phone)) {
      Alert.alert(t('common.error'), t('screens.profileSetup.phoneInvalid'));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('profiles').upsert(
        {
          id: session!.user.id,
          display_name: displayName.trim(),
          phone: phone.trim() || null,
          onboarded: true,
          gdpr_accepted_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (error) throw error;

      if (carMake.trim() && carModel.trim()) {
        const { error: carError } = await supabase.from('user_cars').insert({
          user_id: session!.user.id,
          make: carMake.trim(),
          model: carModel.trim(),
          plate: carPlate.trim() || null,
          is_default: true,
        });
        if (carError) throw carError;
      }

      await refreshProfile();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {googleAvatar && (
        <Image source={{ uri: googleAvatar }} style={styles.avatar} contentFit="cover" />
      )}
      <Text style={styles.title}>{t('screens.profileSetup.title')}</Text>

      <TextInput
        testID="name-input"
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t('screens.profileSetup.namePlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
      />
      <TextInput
        testID="phone-input"
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={t('screens.profileSetup.phonePlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
        keyboardType="phone-pad"
      />

      <View style={styles.privacyRow}>
        <Pressable
          testID="privacy-checkbox"
          onPress={() => setPrivacyAccepted(v => !v)}
          style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}
        />
        <Pressable onPress={() => {
          const url = config['privacy_policy_url'];
          if (url) Linking.openURL(url);
        }}>
          <Text style={styles.privacyText}>{t('common.acceptPrivacyPolicy')}</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionHeader}>{t('screens.profileSetup.addCarTitle')}</Text>
      <TextInput
        style={styles.input}
        value={carMake}
        onChangeText={setCarMake}
        placeholder={t('screens.profileSetup.makePlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
      />
      <TextInput
        style={styles.input}
        value={carModel}
        onChangeText={setCarModel}
        placeholder={t('screens.profileSetup.modelPlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
      />
      <TextInput
        style={styles.input}
        value={carPlate}
        onChangeText={setCarPlate}
        placeholder={t('screens.profileSetup.platePlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="characters"
      />

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={loading}
      >
        <Text style={styles.buttonText}>{t('common.continue')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignSelf: 'center',
    marginBottom: theme.spacing[1],
  },
  title: {
    ...theme.typography.screenTitle,
    color: theme.colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: theme.spacing[1],
  },
  sectionHeader: {
    ...theme.typography.sectionHeader,
    color: theme.colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    marginTop: theme.spacing[2],
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.surface,
    ...theme.typography.body,
    color: theme.colors.textPrimary,
    fontFamily: 'Inter_400Regular',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: 4,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  privacyText: {
    ...theme.typography.body,
    color: theme.colors.primary,
    fontFamily: 'Inter_400Regular',
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.button,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing[2],
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    ...theme.typography.body,
    color: theme.colors.onPrimary,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
});
