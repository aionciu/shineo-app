# Shineo App — Plan 2: Auth Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Sign-In screen (Google OAuth) and the Profile Setup screen (first-login onboarding), completing the 3-state auth guard.

**Architecture:** Google Sign-In uses `@react-native-google-signin/google-signin` to get an ID token, which is passed to `supabase.auth.signInWithIdToken`. The root layout (already in place from Plan 1) handles redirects based on session + `profile.onboarded`. Profile-setup writes to `profiles` and optionally `user_cars`, then sets `onboarded = true`.

**Tech Stack:** `@react-native-google-signin/google-signin`, Supabase Auth, `react-i18next`, `constants/theme.ts`, `lib/supabase.ts`, `lib/auth.tsx`

**Prerequisite:** Plan 1 must be complete (navigation shell, SessionProvider, DB schema, design tokens, i18n).

## Global Constraints

- All UI strings via `useTranslation()` — no hardcoded English
- Design tokens from `constants/theme.ts` — no inline hex colours
- Spacing: 4, 8, 12, 16, 24, 32 only
- Card border-radius: 16, button: 12, input: 12, chip: 999
- Primary green: `#2DC653`
- Phone validation: E.164 pattern `/^\+\d{7,15}$/`
- `onboarded = true` only written after all required fields pass validation

---

### Task 1: Google Sign-In Screen

**Files:**
- Modify: `app/sign-in.tsx`

**Interfaces:**
- Consumes: `useSession()` from `lib/auth.tsx`; `supabase` from `lib/supabase.ts`
- Produces: after successful sign-in, session is stored and root layout redirects to `/profile-setup` or `/(app)/`

- [ ] **Step 1: Install Google Sign-In package**

```bash
npx expo install @react-native-google-signin/google-signin
```

- [ ] **Step 2: Write test for sign-in logic**

Create `__tests__/app/sign-in.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SignInScreen from '../../app/sign-in';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ data: { idToken: 'test-token' } }),
  },
  GoogleSigninButton: ({ onPress }: { onPress: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return <Pressable testID="google-btn" onPress={onPress}><Text>Google</Text></Pressable>;
  },
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null }),
    },
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

test('tapping Google button calls signIn', async () => {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  const { supabase } = require('../../lib/supabase');
  const { getByTestId } = render(<SignInScreen />);
  fireEvent.press(getByTestId('google-btn'));
  await waitFor(() => {
    expect(GoogleSignin.signIn).toHaveBeenCalled();
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'test-token' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest __tests__/app/sign-in.test.tsx
```

Expected: FAIL — screen doesn't implement sign-in.

- [ ] **Step 4: Implement `app/sign-in.tsx`**

```tsx
import { useEffect, useState } from 'react';
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/app/sign-in.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/sign-in.tsx __tests__/app/sign-in.test.tsx
git commit -m "feat: implement Google Sign-In screen"
```

---

### Task 2: Profile Setup Screen

**Files:**
- Modify: `app/profile-setup.tsx`
- Create: `components/PhoneInput.tsx`

**Interfaces:**
- Consumes: `useSession()` from `lib/auth.tsx`; `supabase` from `lib/supabase.ts`
- Produces: on submit, writes `profiles` row with `onboarded=true`, optionally writes `user_cars` row; root layout then redirects to `/(app)/`

- [ ] **Step 1: Write test for profile setup validation**

Create `__tests__/app/profile-setup.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ProfileSetupScreen from '../../app/profile-setup';

const mockRefreshProfile = jest.fn();

jest.mock('../../lib/auth', () => ({
  useSession: () => ({
    session: { user: { id: 'u1', user_metadata: { full_name: 'John', avatar_url: 'https://img' } } },
    profile: null,
    isLoading: false,
    refreshProfile: mockRefreshProfile,
  }),
}));

const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockInsert = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      upsert: mockUpsert,
      insert: mockInsert,
    })),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));

test('Continue button disabled without privacy policy acceptance', () => {
  const { getByText } = render(<ProfileSetupScreen />);
  const btn = getByText('common.continue');
  expect(btn).toBeTruthy();
  fireEvent.press(btn);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('submits profile with display name and accepted privacy policy', async () => {
  const { getByText, getByTestId } = render(<ProfileSetupScreen />);
  fireEvent.changeText(getByTestId('name-input'), 'Alex');
  fireEvent.press(getByTestId('privacy-checkbox'));
  fireEvent.press(getByText('common.continue'));
  await waitFor(() => {
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Alex', onboarded: true }),
      { onConflict: 'id' }
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/profile-setup.test.tsx
```

Expected: FAIL — profile-setup screen is a placeholder.

- [ ] **Step 3: Implement `app/profile-setup.tsx`**

```tsx
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
      Alert.alert(t('common.error'), 'Name is required.');
      return;
    }
    if (phone && !E164_REGEX.test(phone)) {
      Alert.alert(t('common.error'), 'Phone must be in E.164 format (+40...).');
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
        <Pressable onPress={() => Linking.openURL(config['privacy_policy_url'] ?? '')}>
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
    color: '#fff',
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/app/profile-setup.test.tsx
```

Expected: PASS

- [ ] **Step 5: Manually test the full auth flow**

Start the app (`npx expo start --go`), sign in with Google, verify:
1. First time → lands on profile-setup screen
2. Fill name + accept privacy → tapping Continue redirects to Home
3. Sign out → back to sign-in screen
4. Sign in again → skips profile-setup, lands on Home directly

- [ ] **Step 6: Commit**

```bash
git add app/profile-setup.tsx __tests__/app/profile-setup.test.tsx
git commit -m "feat: implement profile-setup onboarding screen with GDPR acceptance"
```
