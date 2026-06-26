# Shineo App — Plan 5: Activity & Profile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Activity screen (upcoming/past bookings, cancellation), Profile screen (edit profile, cars management, preferences, account deletion, sign-out), and the GDPR account-deletion Edge Function.

**Architecture:** Activity fetches the user's reservations joined with location and service data. Cancellation updates `reservations.status = 'cancelled'`. Profile screen reads from `profiles` and `user_cars`, writing updates on Save. Account deletion calls a Supabase Edge Function (`delete-account`) that anonymises reservations and hard-deletes the user record. Language change applies immediately via `i18n.changeLanguage()`.

**Tech Stack:** Supabase Edge Functions (Deno), `lib/supabase.ts`, `lib/auth.tsx`, `lib/i18n.ts`, `constants/theme.ts`, `react-i18next`

**Prerequisite:** Plans 1–4 complete.

## Global Constraints

- All UI strings via `useTranslation()`
- Design tokens from `constants/theme.ts`
- Cancellation is always allowed in this phase (no cutoff policy)
- Account deletion is atomic (Edge Function, service role)
- Language change saves to `profiles.language` AND calls `i18n.changeLanguage()` immediately
- Phone validation: E.164 `/^\+\d{7,15}$/` before saving
- One `user_cars` row can have `is_default = true`; setting a new default clears others

---

### Task 1: Account Deletion Edge Function

**Files:**
- Create: `supabase/functions/delete-account/index.ts`

**Interfaces:**
- Produces: `POST /functions/v1/delete-account` (authenticated) → anonymises reservations, deletes profiles/user_cars/push_tokens, deletes auth user

- [ ] **Step 1: Create Edge Function**

Create `supabase/functions/delete-account/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 1. Anonymise reservations (keep for business records)
  await adminClient
    .from('reservations')
    .update({ user_id: null, car_id: null })
    .eq('user_id', user.id);

  // 2. Hard-delete personal data tables
  await adminClient.from('push_tokens').delete().eq('user_id', user.id);
  await adminClient.from('user_cars').delete().eq('user_id', user.id);
  await adminClient.from('profiles').delete().eq('id', user.id);

  // 3. Delete auth user
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

- [ ] **Step 2: Deploy Edge Function**

```bash
npx supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF
```

Verify in Supabase dashboard → Edge Functions that `delete-account` appears.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/
git commit -m "feat: add delete-account Edge Function for GDPR erasure"
```

---

### Task 2: Activity Screen

**Files:**
- Modify: `app/(app)/activity.tsx`

**Interfaces:**
- Consumes: `supabase` (reservations joined with locations and services); `useSession`
- Produces: two-section list (Upcoming / Past); booking detail modal with Cancel button that sets `status = 'cancelled'`

- [ ] **Step 1: Write test**

Create `__tests__/app/activity.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ActivityScreen from '../../app/(app)/activity';

jest.mock('../../lib/auth', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } }, profile: null }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const now = new Date();
const futureDate = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
const pastDate = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

const mockReservations = [
  {
    id: 'r1', status: 'confirmed',
    slot: { start_time: futureDate, end_time: futureDate },
    location: { id: 'l1', name: 'AutoSpark' },
    service: { name: 'Basic Wash' },
  },
  {
    id: 'r2', status: 'completed',
    slot: { start_time: pastDate, end_time: pastDate },
    location: { id: 'l2', name: 'ShineCo' },
    service: { name: 'Full Wash' },
  },
];

const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'reservations') return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockReservations, error: null }),
        update: mockUpdate,
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) };
    }),
  },
}));

test('renders upcoming section', async () => {
  const { getByText } = render(<ActivityScreen />);
  await waitFor(() => expect(getByText('screens.activity.title')).toBeTruthy());
  expect(getByText('AutoSpark')).toBeTruthy();
});

test('renders past section', async () => {
  const { getByText } = render(<ActivityScreen />);
  await waitFor(() => expect(getByText('ShineCo')).toBeTruthy());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/activity.test.tsx
```

Expected: FAIL — activity screen is placeholder.

- [ ] **Step 3: Implement `app/(app)/activity.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { theme } from '../../constants/theme';

type Reservation = {
  id: string;
  status: string;
  slot: { start_time: string; end_time: string };
  location: { id: string; name: string };
  service: { name: string };
};

export default function ActivityScreen() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function load() {
    if (!session?.user.id) return;
    const { data } = await supabase
      .from('reservations')
      .select('id, status, slot:location_slots(start_time, end_time), location:locations(id, name), service:services(name)')
      .eq('user_id', session.user.id);
    setReservations((data ?? []) as unknown as Reservation[]);
  }

  useEffect(() => { load(); }, [session?.user.id]);

  const now = new Date();
  const upcoming = reservations.filter(r => r.status === 'confirmed' && new Date(r.slot.start_time) > now);
  const past = reservations.filter(r => r.status !== 'confirmed' || new Date(r.slot.start_time) <= now);

  async function handleCancel() {
    if (!selected) return;
    setCancelling(true);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', selected.id);
    setCancelling(false);
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    setSelected(null);
    load();
  }

  function ReservationCard({ item }: { item: Reservation }) {
    const date = new Date(item.slot.start_time);
    return (
      <Pressable style={styles.card} onPress={() => setSelected(item)}>
        <Text style={styles.locationName}>{item.location.name}</Text>
        <Text style={styles.serviceName}>{item.service.name}</Text>
        <Text style={styles.dateText}>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        <View style={[styles.statusBadge, item.status === 'cancelled' ? styles.statusCancelled : styles.statusConfirmed]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('screens.activity.title')}</Text>

      <Text style={styles.sectionHeader}>{t('common.upcoming')}</Text>
      {upcoming.length === 0
        ? <Text style={styles.empty}>{t('screens.activity.emptyUpcoming')}</Text>
        : <FlatList data={upcoming} keyExtractor={r => r.id} renderItem={({ item }) => <ReservationCard item={item} />} />
      }

      <Text style={styles.sectionHeader}>{t('common.past')}</Text>
      {past.length === 0
        ? <Text style={styles.empty}>{t('screens.activity.emptyPast')}</Text>
        : <FlatList data={past} keyExtractor={r => r.id} renderItem={({ item }) => <ReservationCard item={item} />} />
      }

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            {selected && (
              <>
                <Text style={styles.modalTitle}>{selected.location.name}</Text>
                <Text style={styles.modalBody}>{selected.service.name}</Text>
                <Text style={styles.modalBody}>
                  {new Date(selected.slot.start_time).toLocaleDateString()}{' '}
                  {new Date(selected.slot.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {selected.status === 'confirmed' && new Date(selected.slot.start_time) > new Date() && (
                  <Pressable style={styles.cancelBtn} onPress={handleCancel} disabled={cancelling}>
                    <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                  </Pressable>
                )}
                <Pressable style={styles.closeBtn} onPress={() => setSelected(null)}>
                  <Text style={styles.closeBtnText}>{t('common.back')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing[3] },
  title: { ...theme.typography.screenTitle, color: theme.colors.textPrimary, fontFamily: 'Inter_700Bold', marginBottom: theme.spacing[2] },
  sectionHeader: { ...theme.typography.sectionHeader, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold', marginTop: theme.spacing[2], marginBottom: theme.spacing[1] },
  empty: { ...theme.typography.body, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing[2], marginBottom: theme.spacing[1], gap: 4 },
  locationName: { ...theme.typography.cardTitle, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
  serviceName: { ...theme.typography.body, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  dateText: { ...theme.typography.caption, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.chip },
  statusConfirmed: { backgroundColor: '#E8F9EE' },
  statusCancelled: { backgroundColor: '#F5F5F5' },
  statusText: { ...theme.typography.caption, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing[3], gap: theme.spacing[1] },
  modalTitle: { ...theme.typography.sectionHeader, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
  modalBody: { ...theme.typography.body, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  cancelBtn: { backgroundColor: theme.colors.error, borderRadius: theme.radius.button, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing[2] },
  cancelBtnText: { color: '#fff', fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  closeBtn: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.button, height: 44, justifyContent: 'center', alignItems: 'center' },
  closeBtnText: { color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/app/activity.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/activity.tsx" __tests__/app/activity.test.tsx
git commit -m "feat: implement Activity screen with cancellation"
```

---

### Task 3: Profile Screen

**Files:**
- Modify: `app/(app)/profile.tsx`

**Interfaces:**
- Consumes: `useSession` (profile read + `refreshProfile`); `supabase` (profiles upsert, user_cars CRUD); `initI18n` for immediate language switch; `supabase.functions.invoke('delete-account')` for GDPR deletion
- Produces: full Profile screen with edit, cars, preferences, sign-out, delete account

- [ ] **Step 1: Write test**

Create `__tests__/app/profile.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../../app/(app)/profile';

const mockRefresh = jest.fn();
jest.mock('../../lib/auth', () => ({
  useSession: () => ({
    session: { user: { id: 'u1', user_metadata: { avatar_url: null } } },
    profile: { display_name: 'Alex', phone: '+40712345678', language: 'en', push_enabled: true, sms_enabled: false },
    refreshProfile: mockRefresh,
  }),
}));

const mockUpsert = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: mockUpsert,
      insert: jest.fn().mockResolvedValue({ error: null }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })),
    auth: { signOut: jest.fn().mockResolvedValue({}) },
    functions: { invoke: jest.fn().mockResolvedValue({ error: null }) },
  },
}));

jest.mock('../../lib/i18n', () => ({ initI18n: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));

test('renders display name', () => {
  const { getByDisplayValue } = render(<ProfileScreen />);
  expect(getByDisplayValue('Alex')).toBeTruthy();
});

test('save button triggers upsert', async () => {
  const { getByText } = render(<ProfileScreen />);
  fireEvent.press(getByText('common.save'));
  await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
});

test('sign out button exists', () => {
  const { getByText } = render(<ProfileScreen />);
  expect(getByText('common.signOut')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/profile.test.tsx
```

Expected: FAIL — profile screen is placeholder.

- [ ] **Step 3: Implement `app/(app)/profile.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Switch, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { initI18n } from '../../lib/i18n';
import { theme } from '../../constants/theme';

type Car = { id: string; make: string; model: string; plate: string | null; is_default: boolean };

const E164_REGEX = /^\+\d{7,15}$/;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, profile, refreshProfile } = useSession();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [language, setLanguage] = useState(profile?.language ?? 'en');
  const [pushEnabled, setPushEnabled] = useState(profile?.push_enabled ?? true);
  const [smsEnabled, setSmsEnabled] = useState(profile?.sms_enabled ?? false);
  const [cars, setCars] = useState<Car[]>([]);
  const [saving, setSaving] = useState(false);

  const avatar = session?.user.user_metadata?.avatar_url ?? null;

  useEffect(() => {
    if (!session?.user.id) return;
    supabase.from('user_cars').select('*').eq('user_id', session.user.id)
      .then(({ data }) => setCars((data ?? []) as Car[]));
  }, [session?.user.id]);

  async function handleSave() {
    if (phone && !E164_REGEX.test(phone)) {
      Alert.alert(t('common.error'), 'Phone must be in E.164 format (+40...).');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: session!.user.id,
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        language,
        push_enabled: pushEnabled,
        sms_enabled: smsEnabled,
        updated_at: new Date().toISOString(),
      }, { eq: 'id' });
      if (error) throw error;
      await initI18n(language);
      await refreshProfile();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(carId: string) {
    await Promise.all(
      cars.map(c =>
        supabase.from('user_cars').update({ is_default: c.id === carId }).eq('id', c.id)
      )
    );
    setCars(cars.map(c => ({ ...c, is_default: c.id === carId })));
  }

  async function handleDeleteCar(carId: string) {
    await supabase.from('user_cars').delete().eq('id', carId);
    setCars(cars.filter(c => c.id !== carId));
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/sign-in');
  }

  async function handleDeleteAccount() {
    Alert.alert(t('common.deleteAccount'), t('common.deleteAccountConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.deleteAccount'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.functions.invoke('delete-account');
          if (error) { Alert.alert(t('common.error'), error.message); return; }
          await supabase.auth.signOut();
          router.replace('/sign-in');
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('screens.profile.title')}</Text>

      {avatar && <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />}

      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t('screens.profileSetup.namePlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
      />
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={t('screens.profileSetup.phonePlaceholder')}
        placeholderTextColor={theme.colors.textSecondary}
        keyboardType="phone-pad"
      />

      {/* Cars */}
      <Text style={styles.sectionHeader}>{t('common.myCars')}</Text>
      {cars.map(car => (
        <View key={car.id} style={styles.carRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.carName}>{car.make} {car.model} {car.plate ?? ''}</Text>
            {car.is_default && <Text style={styles.defaultBadge}>{t('common.defaultCar')}</Text>}
          </View>
          {!car.is_default && (
            <Pressable onPress={() => handleSetDefault(car.id)} style={styles.carAction}>
              <Text style={styles.carActionText}>Set Default</Text>
            </Pressable>
          )}
          <Pressable onPress={() => handleDeleteCar(car.id)} style={styles.carAction}>
            <Text style={[styles.carActionText, { color: theme.colors.error }]}>Delete</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        style={styles.addCarBtn}
        onPress={() => {
          Alert.prompt('Add Car', 'Enter make model plate (space separated)', text => {
            const [make, model, plate] = (text ?? '').split(' ');
            if (!make || !model) return;
            supabase.from('user_cars').insert({ user_id: session!.user.id, make, model, plate: plate ?? null, is_default: cars.length === 0 })
              .then(({ error }) => {
                if (!error) supabase.from('user_cars').select('*').eq('user_id', session!.user.id).then(({ data }) => setCars((data ?? []) as Car[]));
              });
          });
        }}
      >
        <Text style={styles.addCarBtnText}>{t('common.addCar')}</Text>
      </Pressable>

      {/* Preferences */}
      <Text style={styles.sectionHeader}>{t('screens.profile.preferences')}</Text>

      <View style={styles.prefRow}>
        <Text style={styles.prefLabel}>{t('screens.profile.language')}</Text>
        <View style={styles.langToggle}>
          {['en', 'ro'].map(lang => (
            <Pressable
              key={lang}
              style={[styles.langBtn, language === lang && styles.langBtnActive]}
              onPress={() => setLanguage(lang)}
            >
              <Text style={[styles.langBtnText, language === lang && styles.langBtnTextActive]}>
                {lang.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.prefRow}>
        <Text style={styles.prefLabel}>{t('screens.profile.pushNotifications')}</Text>
        <Switch value={pushEnabled} onValueChange={setPushEnabled} trackColor={{ true: theme.colors.primary }} />
      </View>

      {phone && (
        <View style={styles.prefRow}>
          <Text style={styles.prefLabel}>{t('screens.profile.smsNotifications')}</Text>
          <Switch value={smsEnabled} onValueChange={setSmsEnabled} trackColor={{ true: theme.colors.primary }} />
        </View>
      )}

      <Pressable style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveBtnText}>{t('common.save')}</Text>
      </Pressable>

      <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutBtnText}>{t('common.signOut')}</Text>
      </Pressable>

      <Pressable style={styles.deleteBtn} onPress={handleDeleteAccount}>
        <Text style={styles.deleteBtnText}>{t('common.deleteAccount')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing[3], gap: theme.spacing[1], paddingBottom: theme.spacing[5], backgroundColor: theme.colors.background },
  title: { ...theme.typography.screenTitle, color: theme.colors.textPrimary, fontFamily: 'Inter_700Bold', marginBottom: theme.spacing[2] },
  avatar: { width: 80, height: 80, borderRadius: 40, alignSelf: 'center', marginBottom: theme.spacing[1] },
  input: { height: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.input, paddingHorizontal: theme.spacing[1], backgroundColor: theme.colors.surface, ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  sectionHeader: { ...theme.typography.sectionHeader, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold', marginTop: theme.spacing[2] },
  carRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing[1], gap: theme.spacing[1] },
  carName: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  defaultBadge: { ...theme.typography.caption, color: theme.colors.primary, fontFamily: 'Inter_600SemiBold' },
  carAction: { paddingHorizontal: theme.spacing[1] },
  carActionText: { ...theme.typography.caption, color: theme.colors.primary, fontFamily: 'Inter_600SemiBold' },
  addCarBtn: { borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.radius.button, height: 40, justifyContent: 'center', alignItems: 'center' },
  addCarBtnText: { color: theme.colors.primary, fontFamily: 'Inter_600SemiBold' },
  prefRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing[1], borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  prefLabel: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  langToggle: { flexDirection: 'row', gap: 4 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: theme.radius.chip, borderWidth: 1, borderColor: theme.colors.border },
  langBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  langBtnText: { ...theme.typography.caption, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  langBtnTextActive: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  saveBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.button, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing[3] },
  btnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  signOutBtn: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.button, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing[1] },
  signOutBtnText: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  deleteBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing[1] },
  deleteBtnText: { ...theme.typography.body, color: theme.colors.error, fontFamily: 'Inter_400Regular' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/app/profile.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/profile.tsx" __tests__/app/profile.test.tsx
git commit -m "feat: implement Profile screen with cars, preferences, and account deletion"
```

---

### Task 4: Push Token Registration

**Files:**
- Create: `hooks/usePushToken.ts`

**Interfaces:**
- Produces: `usePushToken()` — requests notification permissions on first booking, upserts Expo push token to `push_tokens` table

- [ ] **Step 1: Write test**

Create `__tests__/hooks/usePushToken.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { usePushToken } from '../../hooks/usePushToken';

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
}));

const mockUpsert = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

test('registers push token when called', async () => {
  const { result } = renderHook(() => usePushToken('u1'));
  await act(async () => { await result.current.registerToken(); });
  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: 'u1', token: 'ExponentPushToken[test]' }),
    { onConflict: 'user_id' }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/hooks/usePushToken.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `hooks/usePushToken.ts`**

```typescript
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

export function usePushToken(userId: string | undefined) {
  async function registerToken() {
    if (!userId) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await supabase.from('push_tokens').upsert(
      { user_id: userId, token, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  }

  return { registerToken };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/hooks/usePushToken.test.ts
```

Expected: PASS

- [ ] **Step 5: Call registerToken from Booking screen after successful booking**

In `app/(app)/booking/[id].tsx`, add at the top of the file:

```tsx
import { usePushToken } from '../../../hooks/usePushToken';
```

Inside `BookingScreen`, add:

```tsx
const { registerToken } = usePushToken(session?.user.id);
```

After `if (!result.ok) {` block resolves successfully (just before the `router.replace(...)` call), add:

```tsx
await registerToken();
```

- [ ] **Step 6: Commit**

```bash
git add hooks/usePushToken.ts __tests__/hooks/usePushToken.test.ts "app/(app)/booking/[id].tsx"
git commit -m "feat: add push token registration on first booking"
```
