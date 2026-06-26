# Shineo App — Plan 4: Location Detail & Booking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Location Detail screen, Booking screen (service/date/slot/car selection), atomic reservation with race-condition handling, and the Booking Confirmation screen.

**Architecture:** Location Detail branches on `listing_type`: bookable shows services + Book Now; advertised shows phone + Call. Booking writes to `reservations` via a Supabase RPC that checks slot capacity atomically to prevent double-booking. On conflict (slot taken), it returns an error code the app surfaces to the user. Booking Confirmation shows a summary and schedules a local push notification 24h before the slot.

**Tech Stack:** `expo-notifications`, `lib/supabase.ts`, `lib/locationUtils.ts`, `constants/theme.ts`, `react-i18next`, `expo-image`

**Prerequisite:** Plans 1, 2, and 3 complete (design tokens, i18n, Supabase client, auth, `getImageUrl`, `isOpenNow`).

## Global Constraints

- All UI strings via `useTranslation()`
- Design tokens from `constants/theme.ts`
- Detail gallery images: `?width=1200&quality=90`
- Feed card images: `?width=400&height=300&quality=80&resize=cover`
- Booking is atomic: slot availability check + insert in a single Supabase RPC
- Push notification only if `profiles.push_enabled = true`
- Notification copy from i18n key `common.reminderNotification`
- No booking UI for `listing_type = 'advertised'` — show phone + Call button only

---

### Task 1: Atomic Booking RPC (Supabase)

**Files:**
- Create: `supabase/migrations/0002_booking_rpc.sql`

**Interfaces:**
- Produces: `book_slot(p_user_id, p_location_id, p_service_id, p_slot_id, p_car_id)` RPC that returns `{ ok: boolean, error_code: text }`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/0002_booking_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION book_slot(
  p_user_id    uuid,
  p_location_id uuid,
  p_service_id  uuid,
  p_slot_id     uuid,
  p_car_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_capacity    int;
  v_booked      int;
  v_existing    uuid;
BEGIN
  -- Lock the slot row to prevent concurrent races
  SELECT capacity INTO v_capacity
  FROM location_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF v_capacity IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'slot_not_found');
  END IF;

  -- Count confirmed reservations for this slot
  SELECT COUNT(*) INTO v_booked
  FROM reservations
  WHERE slot_id = p_slot_id AND status = 'confirmed';

  IF v_booked >= v_capacity THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'slot_taken');
  END IF;

  -- Check user hasn't already booked this slot
  SELECT id INTO v_existing FROM reservations WHERE user_id = p_user_id AND slot_id = p_slot_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'already_booked');
  END IF;

  INSERT INTO reservations (user_id, location_id, service_id, slot_id, car_id, status)
  VALUES (p_user_id, p_location_id, p_service_id, p_slot_id, p_car_id, 'confirmed');

  RETURN jsonb_build_object('ok', true, 'error_code', null);
END;
$$;
```

- [ ] **Step 2: Apply migration in Supabase dashboard**

In Supabase dashboard → SQL Editor, paste and run the migration. Verify the function appears under Database → Functions.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_booking_rpc.sql
git commit -m "feat: add atomic book_slot RPC with capacity check"
```

---

### Task 2: Location Detail Screen

**Files:**
- Create: `app/(app)/[id].tsx`

**Interfaces:**
- Consumes: `supabase` (locations, services queries); `isOpenNow`, `getImageUrl` from `lib/locationUtils.ts`; `useRecentlyViewed` to record view
- Produces: screen showing gallery, name, address, hours, "Open now"/"Closed", services (if bookable), Book Now button (if bookable), Call + Get Directions (always)

- [ ] **Step 1: Write test**

Create `__tests__/app/detail.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react-native';
import DetailScreen from '../../app/(app)/[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'loc-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ ids: [], addId: jest.fn() }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('../../lib/locationUtils', () => ({
  isOpenNow: jest.fn().mockReturnValue(true),
  getImageUrl: jest.fn().mockReturnValue('https://img.test/photo.jpg'),
}));

const mockLocation = {
  id: 'loc-1', name: 'AutoSpark', address: '123 Main St',
  listing_type: 'bookable', rating: 4.5, review_count: 10,
  photos: ['locations/loc-1/p.jpg'], hours: { mon: '08:00-18:00' },
  timezone: 'Europe/Bucharest', phone: null, coordinates: null,
};
const mockServices = [
  { id: 's1', name: 'Basic Wash', duration_min: 30, price: 50, currency: 'RON' },
];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'locations') return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockLocation, error: null }),
      };
      if (table === 'services') return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockServices, error: null }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) };
    }),
  },
}));

test('renders location name', async () => {
  const { getByText } = render(<DetailScreen />);
  await waitFor(() => expect(getByText('AutoSpark')).toBeTruthy());
});

test('renders Book Now button for bookable location', async () => {
  const { getByText } = render(<DetailScreen />);
  await waitFor(() => expect(getByText('common.bookNow')).toBeTruthy());
});

test('renders service name', async () => {
  const { getByText } = render(<DetailScreen />);
  await waitFor(() => expect(getByText('Basic Wash')).toBeTruthy());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/detail.test.tsx
```

Expected: FAIL — file not found.

- [ ] **Step 3: Implement `app/(app)/[id].tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, FlatList, Pressable, StyleSheet, Linking, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { isOpenNow, getImageUrl } from '../../lib/locationUtils';
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed';
import { theme } from '../../constants/theme';

type Location = {
  id: string; name: string; address: string | null; listing_type: string;
  rating: number | null; review_count: number | null; photos: string[] | null;
  hours: Record<string, string> | null; timezone: string; phone: string | null;
  coordinates: any;
};
type Service = { id: string; name: string; duration_min: number | null; price: number | null; currency: string };

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { addId } = useRecentlyViewed();

  const [location, setLocation] = useState<Location | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    addId(id);
    Promise.all([
      supabase.from('locations').select('*').eq('id', id).single(),
      supabase.from('services').select('*').eq('location_id', id),
    ]).then(([{ data: loc }, { data: svcs }]) => {
      setLocation(loc);
      setServices(svcs ?? []);
      setLoading(false);
    });
  }, [id]);

  if (loading || !location) return <View style={styles.container} />;

  const open = isOpenNow(location.hours, location.timezone);
  const photos = (location.photos ?? []).map(p => getImageUrl(p, 1200, undefined, 90));

  function openDirections() {
    const q = encodeURIComponent(location!.address ?? location!.name);
    Linking.openURL(`https://maps.google.com/?q=${q}`);
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <FlatList
          horizontal
          data={photos}
          keyExtractor={(_, i) => String(i)}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Image source={{ uri: item }} style={styles.galleryImage} contentFit="cover" />
          )}
          style={styles.gallery}
        />

        <View style={styles.body}>
          <Text style={styles.name}>{location.name}</Text>
          {location.address && <Text style={styles.address}>{location.address}</Text>}

          <View style={styles.row}>
            {location.rating != null && (
              <Text style={styles.rating}>★ {location.rating.toFixed(1)} ({location.review_count})</Text>
            )}
            <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
              <Text style={styles.badgeText}>{open ? t('common.openNow') : t('common.closed')}</Text>
            </View>
          </View>

          <Pressable style={styles.directionsBtn} onPress={openDirections}>
            <Text style={styles.directionsBtnText}>{t('common.getDirections')}</Text>
          </Pressable>

          {location.listing_type === 'advertised' && location.phone && (
            <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${location.phone}`)}>
              <Text style={styles.callBtnText}>{t('common.call')}</Text>
            </Pressable>
          )}

          {location.listing_type === 'bookable' && services.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Services</Text>
              {services.map(s => (
                <View key={s.id} style={styles.serviceRow}>
                  <View>
                    <Text style={styles.serviceName}>{s.name}</Text>
                    {s.duration_min && <Text style={styles.serviceMeta}>{s.duration_min} min</Text>}
                  </View>
                  <Text style={styles.servicePrice}>
                    {s.price != null ? `${s.price} ${s.currency}` : ''}
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {location.listing_type === 'bookable' && (
        <View style={styles.stickyButton}>
          <Pressable style={styles.bookBtn} onPress={() => router.push(`/booking/${id}`)}>
            <Text style={styles.bookBtnText}>{t('common.bookNow')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  gallery: { height: 240 },
  galleryImage: { width: 320, height: 240 },
  body: { padding: theme.spacing[3], gap: theme.spacing[1] },
  name: { ...theme.typography.screenTitle, color: theme.colors.textPrimary, fontFamily: 'Inter_700Bold' },
  address: { ...theme.typography.body, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1] },
  rating: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.chip },
  badgeOpen: { backgroundColor: '#E8F9EE' },
  badgeClosed: { backgroundColor: '#F5F5F5' },
  badgeText: { ...theme.typography.caption, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  directionsBtn: {
    borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.radius.button,
    height: 44, justifyContent: 'center', alignItems: 'center',
  },
  directionsBtnText: { color: theme.colors.primary, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  callBtn: {
    backgroundColor: theme.colors.primary, borderRadius: theme.radius.button,
    height: 44, justifyContent: 'center', alignItems: 'center',
  },
  callBtnText: { color: '#fff', fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  sectionHeader: { ...theme.typography.sectionHeader, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold', marginTop: theme.spacing[2] },
  serviceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing[1], borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  serviceName: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  serviceMeta: { ...theme.typography.caption, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  servicePrice: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
  stickyButton: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: theme.spacing[3], backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  bookBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.button, height: 52, justifyContent: 'center', alignItems: 'center' },
  bookBtnText: { color: '#fff', ...theme.typography.body, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/app/detail.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/[id].tsx" __tests__/app/detail.test.tsx
git commit -m "feat: implement Location Detail screen"
```

---

### Task 3: Booking Screen

**Files:**
- Create: `app/(app)/booking/[id].tsx`

**Interfaces:**
- Consumes: `supabase` (services, location_slots, user_cars, book_slot RPC); `useSession`
- Produces: booking screen that on success navigates to `/(app)/booking/confirmation` with booking params; on slot-taken error, returns user to slot picker with message

- [ ] **Step 1: Write test**

Create `__tests__/app/booking.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import BookingScreen from '../../app/(app)/booking/[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'loc-1' }),
  useRouter: () => ({ replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../lib/auth', () => ({
  useSession: () => ({
    session: { user: { id: 'u1' } },
    profile: { push_enabled: true, language: 'en' },
  }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn(), requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) }));

const mockServices = [{ id: 's1', name: 'Basic Wash', duration_min: 30, price: 50, currency: 'RON' }];
const mockSlots = [
  { id: 'slot-1', start_time: '2026-07-01T09:00:00Z', end_time: '2026-07-01T09:30:00Z', capacity: 2 },
];
const mockCars = [{ id: 'car-1', make: 'Toyota', model: 'Corolla', plate: 'B-123-XY', is_default: true }];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'services') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: mockServices, error: null }) };
      if (table === 'location_slots') return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(), order: jest.fn().mockResolvedValue({ data: mockSlots, error: null }),
      };
      if (table === 'user_cars') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: mockCars, error: null }) };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) };
    }),
    rpc: jest.fn().mockResolvedValue({ data: { ok: true, error_code: null }, error: null }),
  },
}));

test('renders service name', async () => {
  const { getByText } = render(<BookingScreen />);
  await waitFor(() => expect(getByText('Basic Wash')).toBeTruthy());
});

test('renders confirm button after slot selected', async () => {
  const { getByText } = render(<BookingScreen />);
  await waitFor(() => getByText('Basic Wash'));
  fireEvent.press(getByText('Basic Wash'));
  await waitFor(() => expect(getByText('screens.booking.confirm')).toBeTruthy());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/booking.test.tsx
```

Expected: FAIL — file not found.

- [ ] **Step 3: Implement `app/(app)/booking/[id].tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Notifications from 'expo-notifications';
import { supabase } from '../../../lib/supabase';
import { useSession } from '../../../lib/auth';
import { theme } from '../../../constants/theme';

type Service = { id: string; name: string; duration_min: number | null; price: number | null; currency: string };
type Slot = { id: string; start_time: string; end_time: string; capacity: number };
type Car = { id: string; make: string; model: string; plate: string | null; is_default: boolean };

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { session, profile } = useSession();

  const [services, setServices] = useState<Service[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id || !session?.user.id) return;
    Promise.all([
      supabase.from('services').select('*').eq('location_id', id),
      supabase.from('location_slots').select('*').eq('location_id', id)
        .gte('start_time', new Date().toISOString()).order('start_time'),
      supabase.from('user_cars').select('*').eq('user_id', session.user.id),
    ]).then(([{ data: svcs }, { data: slts }, { data: crs }]) => {
      setServices(svcs ?? []);
      setSlots(slts ?? []);
      const cars = crs ?? [];
      setCars(cars);
      setSelectedCar(cars.find(c => c.is_default) ?? null);
    });
  }, [id, session?.user.id]);

  async function handleConfirm() {
    if (!selectedService || !selectedSlot || !session?.user.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('book_slot', {
        p_user_id: session.user.id,
        p_location_id: id,
        p_service_id: selectedService.id,
        p_slot_id: selectedSlot.id,
        p_car_id: selectedCar?.id ?? null,
      });
      if (error) throw error;
      const result = data as { ok: boolean; error_code: string | null };
      if (!result.ok) {
        if (result.error_code === 'slot_taken') {
          Alert.alert(t('common.error'), t('common.slotTaken'));
          setSelectedSlot(null);
        } else {
          Alert.alert(t('common.error'), result.error_code ?? 'Unknown error');
        }
        return;
      }

      // Schedule local push notification if enabled
      if (profile?.push_enabled) {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status === 'granted') {
          const slotTime = new Date(selectedSlot.start_time);
          const reminderTime = new Date(slotTime.getTime() - 24 * 60 * 60 * 1000);
          if (reminderTime > new Date()) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'Shineo',
                body: t('common.reminderNotification', {
                  service: selectedService.name,
                  location: '',
                  time: slotTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                }),
              },
              trigger: { date: reminderTime },
            });
          }
        }
      }

      router.replace({
        pathname: '/booking/confirmation',
        params: {
          locationId: id,
          serviceId: selectedService.id,
          serviceName: selectedService.name,
          slotStart: selectedSlot.start_time,
          carMake: selectedCar?.make ?? '',
          carModel: selectedCar?.model ?? '',
        },
      });
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setLoading(false);
    }
  }

  if (slots.length === 0 && services.length > 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('common.noAvailability')}</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100, gap: theme.spacing[3], padding: theme.spacing[3] }}>
        <Text style={styles.sectionHeader}>{t('screens.booking.selectService')}</Text>
        {services.map(s => (
          <Pressable
            key={s.id}
            style={[styles.option, selectedService?.id === s.id && styles.optionSelected]}
            onPress={() => setSelectedService(s)}
          >
            <Text style={styles.optionLabel}>{s.name}</Text>
            {s.price != null && <Text style={styles.optionMeta}>{s.price} {s.currency}</Text>}
          </Pressable>
        ))}

        {selectedService && (
          <>
            <Text style={styles.sectionHeader}>{t('screens.booking.selectTime')}</Text>
            {slots.map(slot => (
              <Pressable
                key={slot.id}
                style={[styles.option, selectedSlot?.id === slot.id && styles.optionSelected]}
                onPress={() => setSelectedSlot(slot)}
              >
                <Text style={styles.optionLabel}>
                  {new Date(slot.start_time).toLocaleDateString()} — {new Date(slot.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Pressable>
            ))}
          </>
        )}

        {cars.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>{t('screens.booking.selectCar')}</Text>
            {cars.map(car => (
              <Pressable
                key={car.id}
                style={[styles.option, selectedCar?.id === car.id && styles.optionSelected]}
                onPress={() => setSelectedCar(selectedCar?.id === car.id ? null : car)}
              >
                <Text style={styles.optionLabel}>{car.make} {car.model} {car.plate ?? ''}</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {selectedService && selectedSlot && (
        <View style={styles.stickyButton}>
          <Pressable style={[styles.confirmBtn, loading && styles.btnDisabled]} onPress={handleConfirm} disabled={loading}>
            <Text style={styles.confirmBtnText}>{t('screens.booking.confirm')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  sectionHeader: { ...theme.typography.sectionHeader, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
  option: {
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.card,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing[2], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  optionSelected: { borderColor: theme.colors.primary, backgroundColor: '#E8F9EE' },
  optionLabel: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  optionMeta: { ...theme.typography.body, color: theme.colors.textSecondary, fontFamily: 'Inter_600SemiBold' },
  stickyButton: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: theme.spacing[3], backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  confirmBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.button, height: 52, justifyContent: 'center', alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: '#fff', ...theme.typography.body, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing[3], gap: theme.spacing[2] },
  emptyText: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center', fontFamily: 'Inter_400Regular' },
  backBtn: { borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.radius.button, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[1] },
  backBtnText: { color: theme.colors.primary, fontFamily: 'Inter_600SemiBold' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/app/booking.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/booking/[id].tsx" __tests__/app/booking.test.tsx
git commit -m "feat: implement Booking screen with atomic slot reservation"
```

---

### Task 4: Booking Confirmation Screen

**Files:**
- Create: `app/(app)/booking/confirmation.tsx`

**Interfaces:**
- Consumes: route params `{ locationId, serviceName, slotStart, carMake, carModel }`
- Produces: confirmation summary screen with "View in Activity" button

- [ ] **Step 1: Write test**

Create `__tests__/app/booking-confirmation.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import ConfirmationScreen from '../../app/(app)/booking/confirmation';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    serviceName: 'Basic Wash',
    slotStart: '2026-07-01T09:00:00Z',
    carMake: 'Toyota',
    carModel: 'Corolla',
  }),
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

test('renders service name on confirmation', () => {
  const { getByText } = render(<ConfirmationScreen />);
  expect(getByText('Basic Wash')).toBeTruthy();
});

test('renders View in Activity button', () => {
  const { getByText } = render(<ConfirmationScreen />);
  expect(getByText('common.viewInActivity')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/booking-confirmation.test.tsx
```

Expected: FAIL — file not found.

- [ ] **Step 3: Implement `app/(app)/booking/confirmation.tsx`**

```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { theme } from '../../../constants/theme';

export default function ConfirmationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { serviceName, slotStart, carMake, carModel } = useLocalSearchParams<{
    serviceName: string; slotStart: string; carMake: string; carModel: string;
  }>();

  const date = new Date(slotStart);
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const hasCar = carMake && carModel;

  return (
    <View style={styles.container}>
      <Text style={styles.checkmark}>✓</Text>
      <Text style={styles.title}>Booking Confirmed!</Text>

      <View style={styles.card}>
        <Row label="Service" value={serviceName} />
        <Row label="Date" value={dateStr} />
        <Row label="Time" value={timeStr} />
        {hasCar && <Row label="Car" value={`${carMake} ${carModel}`} />}
      </View>

      <Pressable style={styles.button} onPress={() => router.replace('/(app)/activity')}>
        <Text style={styles.buttonText}>{t('common.viewInActivity')}</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={rowStyles.value}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing[1], borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  label: { ...theme.typography.body, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  value: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing[3], justifyContent: 'center', alignItems: 'center', gap: theme.spacing[2] },
  checkmark: { fontSize: 64, color: theme.colors.primary },
  title: { ...theme.typography.screenTitle, color: theme.colors.textPrimary, fontFamily: 'Inter_700Bold' },
  card: { width: '100%', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.border },
  button: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.button, height: 52, paddingHorizontal: theme.spacing[4], justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing[2] },
  buttonText: { color: '#fff', ...theme.typography.body, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/app/booking-confirmation.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/booking/confirmation.tsx" __tests__/app/booking-confirmation.test.tsx
git commit -m "feat: implement Booking Confirmation screen"
```
