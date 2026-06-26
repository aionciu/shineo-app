# Shineo App — Plan 3: Home & Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Home feed screen (search bar, category chips, feed sections) and the Search+Map screen (full-screen Google Map, draggable bottom sheet, filters) including the custom liquid tab bar.

**Architecture:** Home fetches categories from Supabase and builds feed sections (Book Again, Recently Viewed, New to Shineo). Recently Viewed is stored in AsyncStorage. Search calls the `search_locations` Supabase RPC with live params. A `@gorhom/bottom-sheet` overlays the map on the Search screen. The custom tab bar is a Reanimated+SVG component registered as `tabBar` in the `(app)/_layout.tsx`.

**Tech Stack:** `expo-location`, `react-native-maps`, `@gorhom/bottom-sheet`, `@react-native-async-storage/async-storage`, `react-native-reanimated`, `react-native-svg`, `react-i18next`, `constants/theme.ts`

**Prerequisite:** Plans 1 and 2 complete.

## Global Constraints

- All UI strings via `useTranslation()`
- Design tokens from `constants/theme.ts`
- Location permission requested on first open of Home or Search (not at app startup)
- Default search radius read from `app_config.default_search_radius_m` (hook from Plan 1)
- Distance displayed in km with 1 decimal (e.g. "1.2 km away")
- "Open now" / "Closed" derived client-side from `locations.hours` JSONB + `locations.timezone` + device time
- Feed card image: `?width=400&height=300&quality=80&resize=cover` transform param
- Recently Viewed stored under AsyncStorage key `@shineo:recently_viewed` as JSON array of location IDs (max 10)
- Category chips and feed sections driven by Supabase data — nothing hardcoded

---

### Task 1: Install dependencies

**Files:** none (dependency install)

- [ ] **Step 1: Install packages**

```bash
npx expo install expo-location react-native-maps
npx expo install @react-native-async-storage/async-storage
npm install @gorhom/bottom-sheet
npx expo install @react-native-google-signin/google-signin  # already done in Plan 2
```

- [ ] **Step 2: Add maps config to app.json**

In `app.json` under `expo.android`, add:
```json
"config": {
  "googleMaps": {
    "apiKey": "REPLACE_WITH_ANDROID_MAPS_KEY"
  }
}
```

Under `expo.ios`, add:
```json
"config": {
  "googleMapsApiKey": "REPLACE_WITH_IOS_MAPS_KEY"
}
```

- [ ] **Step 3: Commit**

```bash
git add app.json package.json
git commit -m "chore: install location, maps, and bottom-sheet dependencies"
```

---

### Task 2: Shared Utilities — isOpenNow + imageUrl

**Files:**
- Create: `lib/locationUtils.ts`

**Interfaces:**
- Produces: `isOpenNow(hours: Record<string, string>, timezone: string): boolean`; `getImageUrl(storagePath: string, width: number, height?: number, quality?: number): string`

- [ ] **Step 1: Write tests**

Create `__tests__/lib/locationUtils.test.ts`:

```typescript
import { isOpenNow, getImageUrl } from '../../lib/locationUtils';

const SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;

describe('isOpenNow', () => {
  test('returns true when current time is within hours', () => {
    // Mock: Tuesday 10:00 AM Romania time
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T07:00:00Z')); // UTC+3 EEST = 10:00 local
    const hours = { tue: '08:00-18:00' };
    expect(isOpenNow(hours, 'Europe/Bucharest')).toBe(true);
    jest.useRealTimers();
  });

  test('returns false when current time is outside hours', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T20:00:00Z')); // 23:00 EEST
    const hours = { tue: '08:00-18:00' };
    expect(isOpenNow(hours, 'Europe/Bucharest')).toBe(false);
    jest.useRealTimers();
  });

  test('returns false when no hours entry for today', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T10:00:00Z'));
    const hours = { mon: '08:00-18:00' }; // no tuesday
    expect(isOpenNow(hours, 'Europe/Bucharest')).toBe(false);
    jest.useRealTimers();
  });
});

describe('getImageUrl', () => {
  test('constructs feed card URL', () => {
    const url = getImageUrl('locations/abc/photo.jpg', 400, 300, 80);
    expect(url).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/locations/abc/photo.jpg?width=400&height=300&quality=80&resize=cover`
    );
  });

  test('constructs detail gallery URL (no height)', () => {
    const url = getImageUrl('locations/abc/photo.jpg', 1200, undefined, 90);
    expect(url).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/locations/abc/photo.jpg?width=1200&quality=90`
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/locationUtils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/locationUtils.ts`**

```typescript
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function isOpenNow(
  hours: Record<string, string> | null | undefined,
  timezone: string
): boolean {
  if (!hours) return false;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value.toLowerCase().slice(0, 3) ?? '';
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  const currentMinutes = parseInt(hour) * 60 + parseInt(minute);

  const dayHours = hours[weekday];
  if (!dayHours) return false;

  const [openStr, closeStr] = dayHours.split('-');
  const [openH, openM] = openStr.split(':').map(Number);
  const [closeH, closeM] = closeStr.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

export function getImageUrl(
  storagePath: string,
  width: number,
  height?: number,
  quality: number = 80
): string {
  const base = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${storagePath}`;
  const params = new URLSearchParams({ width: String(width), quality: String(quality) });
  if (height !== undefined) {
    params.set('height', String(height));
    params.set('resize', 'cover');
  }
  return `${base}?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/lib/locationUtils.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/locationUtils.ts __tests__/lib/locationUtils.test.ts
git commit -m "feat: add isOpenNow and getImageUrl utilities"
```

---

### Task 3: Location Hook + Recently Viewed

**Files:**
- Create: `hooks/useUserLocation.ts`
- Create: `hooks/useRecentlyViewed.ts`

**Interfaces:**
- Produces: `useUserLocation()` → `{ coords: { latitude: number; longitude: number } | null, permissionDenied: boolean }`
- Produces: `useRecentlyViewed()` → `{ ids: string[], addId: (id: string) => void }`

- [ ] **Step 1: Write tests**

Create `__tests__/hooks/useUserLocation.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react-native';
import * as ExpoLocation from 'expo-location';
import { useUserLocation } from '../../hooks/useUserLocation';

jest.mock('expo-location');

test('returns coords on permission grant', async () => {
  (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: 44.4, longitude: 26.1 },
  });
  const { result } = renderHook(() => useUserLocation());
  await waitFor(() => expect(result.current.coords).not.toBeNull());
  expect(result.current.coords?.latitude).toBe(44.4);
  expect(result.current.permissionDenied).toBe(false);
});

test('sets permissionDenied on denial', async () => {
  (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  const { result } = renderHook(() => useUserLocation());
  await waitFor(() => expect(result.current.permissionDenied).toBe(true));
  expect(result.current.coords).toBeNull();
});
```

Create `__tests__/hooks/useRecentlyViewed.test.ts`:

```typescript
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

test('addId persists and deduplicates', async () => {
  const { result } = renderHook(() => useRecentlyViewed());
  await waitFor(() => expect(result.current.ids).toEqual([]));
  act(() => { result.current.addId('loc-1'); });
  act(() => { result.current.addId('loc-2'); });
  act(() => { result.current.addId('loc-1'); }); // duplicate
  await waitFor(() => expect(result.current.ids[0]).toBe('loc-1'));
  expect(result.current.ids).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/hooks/useUserLocation.test.ts __tests__/hooks/useRecentlyViewed.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `hooks/useUserLocation.ts`**

```typescript
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

type Coords = { latitude: number; longitude: number } | null;

export function useUserLocation() {
  const [coords, setCoords] = useState<Coords>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(pos => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      });
    });
  }, []);

  return { coords, permissionDenied };
}
```

- [ ] **Step 4: Create `hooks/useRecentlyViewed.ts`**

```typescript
import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@shineo:recently_viewed';
const MAX = 10;

export function useRecentlyViewed() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (raw) setIds(JSON.parse(raw));
    });
  }, []);

  const addId = useCallback((id: string) => {
    setIds(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, MAX);
      AsyncStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { ids, addId };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/hooks/useUserLocation.test.ts __tests__/hooks/useRecentlyViewed.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add hooks/useUserLocation.ts hooks/useRecentlyViewed.ts __tests__/hooks/
git commit -m "feat: add user location hook and recently-viewed AsyncStorage hook"
```

---

### Task 4: Feed Card Component

**Files:**
- Create: `components/FeedCard.tsx`

**Interfaces:**
- Consumes: `getImageUrl` from `lib/locationUtils.ts`; `isOpenNow` from `lib/locationUtils.ts`; `theme` from `constants/theme.ts`
- Produces: `<FeedCard location={...} onPress={() => void} />` — renders photo, name, distance, rating, price hint, open/closed badge

- [ ] **Step 1: Write test**

Create `__tests__/components/FeedCard.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import { FeedCard } from '../../components/FeedCard';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: any) => k }) }));
jest.mock('../../lib/locationUtils', () => ({
  isOpenNow: jest.fn().mockReturnValue(true),
  getImageUrl: jest.fn().mockReturnValue('https://img.test/photo.jpg'),
}));

const location = {
  id: 'loc-1',
  name: 'AutoSpark',
  rating: 4.5,
  review_count: 23,
  photos: ['locations/loc-1/photo.jpg'],
  hours: { mon: '08:00-18:00' },
  timezone: 'Europe/Bucharest',
  distance_m: 1200,
};

test('renders location name', () => {
  const { getByText } = render(<FeedCard location={location as any} onPress={() => {}} />);
  expect(getByText('AutoSpark')).toBeTruthy();
});

test('shows open badge when open', () => {
  const { getByText } = render(<FeedCard location={location as any} onPress={() => {}} />);
  expect(getByText('common.openNow')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/components/FeedCard.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `components/FeedCard.tsx`**

```tsx
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { theme } from '../constants/theme';
import { isOpenNow, getImageUrl } from '../lib/locationUtils';

export type FeedLocation = {
  id: string;
  name: string;
  rating: number | null;
  review_count: number | null;
  photos: string[] | null;
  hours: Record<string, string> | null;
  timezone: string;
  distance_m?: number | null;
};

type Props = { location: FeedLocation; onPress: () => void };

export function FeedCard({ location, onPress }: Props) {
  const { t } = useTranslation();
  const open = isOpenNow(location.hours, location.timezone);
  const imageUrl = location.photos?.[0]
    ? getImageUrl(location.photos[0], 400, 300, 80)
    : null;
  const distanceKm = location.distance_m != null
    ? (location.distance_m / 1000).toFixed(1)
    : null;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {imageUrl && (
        <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{location.name}</Text>
        <View style={styles.meta}>
          {distanceKm && (
            <Text style={styles.metaText}>{t('common.distance', { km: distanceKm })}</Text>
          )}
          {location.rating != null && (
            <Text style={styles.metaText}>★ {location.rating.toFixed(1)}</Text>
          )}
        </View>
        <View style={styles.footer}>
          <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
            <Text style={styles.badgeText}>
              {open ? t('common.openNow') : t('common.closed')}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 200,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  image: { width: '100%', height: 120 },
  body: { padding: theme.spacing[1], gap: 4 },
  name: {
    ...theme.typography.cardTitle,
    color: theme.colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
  },
  meta: { flexDirection: 'row', gap: theme.spacing[1] },
  metaText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontFamily: 'Inter_400Regular',
  },
  footer: { flexDirection: 'row', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.chip },
  badgeOpen: { backgroundColor: '#E8F9EE' },
  badgeClosed: { backgroundColor: '#F5F5F5' },
  badgeText: {
    ...theme.typography.caption,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/components/FeedCard.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/FeedCard.tsx __tests__/components/FeedCard.test.tsx
git commit -m "feat: add FeedCard component with open/closed badge"
```

---

### Task 5: Home Screen

**Files:**
- Modify: `app/(app)/index.tsx`
- Create: `components/CategoryChip.tsx`

**Interfaces:**
- Consumes: `useUserLocation`, `useRecentlyViewed`, `useSession`, `useAppConfig`, `FeedCard`, `OfflineBanner`
- Consumes: `supabase` for categories, book-again locations, new-to-shineo locations
- Produces: rendered Home screen with all feed sections

- [ ] **Step 1: Write test**

Create `__tests__/app/home.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react-native';
import HomeScreen from '../../app/(app)/index';

jest.mock('../../hooks/useUserLocation', () => ({
  useUserLocation: () => ({ coords: { latitude: 44.4, longitude: 26.1 }, permissionDenied: false }),
}));
jest.mock('../../hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ ids: [], addId: jest.fn() }),
}));
jest.mock('../../lib/auth', () => ({
  useSession: () => ({ session: { user: { id: 'u1' } }, profile: { language: 'en' } }),
}));
jest.mock('../../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ config: { default_search_radius_m: '2000' }, isLoading: false }),
}));
jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('../../lib/locationUtils', () => ({
  isOpenNow: jest.fn().mockReturnValue(true),
  getImageUrl: jest.fn().mockReturnValue('https://img.test/photo.jpg'),
}));

const mockCategories = [{ id: 'c1', name: 'Washing', slug: 'washing' }];
const mockNewLocations = [
  { id: 'l1', name: 'Shine Co', rating: 4.2, review_count: 5, photos: [], hours: {}, timezone: 'Europe/Bucharest', distance_m: 500 },
];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'categories') return { select: jest.fn().mockResolvedValue({ data: mockCategories, error: null }) };
      if (table === 'reservations') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [], error: null }) };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: mockNewLocations, error: null }) };
    }),
    rpc: jest.fn().mockResolvedValue({ data: mockNewLocations, error: null }),
  },
}));

test('renders New to Shineo section', async () => {
  const { getByText } = render(<HomeScreen />);
  await waitFor(() => expect(getByText('common.newToShineo')).toBeTruthy());
});

test('renders category chip', async () => {
  const { getByText } = render(<HomeScreen />);
  await waitFor(() => expect(getByText('Washing')).toBeTruthy());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/home.test.tsx
```

Expected: FAIL — home screen is a placeholder.

- [ ] **Step 3: Create `components/CategoryChip.tsx`**

```tsx
import { Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '../constants/theme';

type Props = { label: string; selected?: boolean; onPress: () => void };

export function CategoryChip({ label, selected, onPress }: Props) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0],
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: '#E8F9EE',
  },
  label: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    fontFamily: 'Inter_400Regular',
  },
  labelSelected: {
    color: theme.colors.primary,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
});
```

- [ ] **Step 4: Implement `app/(app)/index.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/auth';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { FeedCard, FeedLocation } from '../../components/FeedCard';
import { CategoryChip } from '../../components/CategoryChip';
import { OfflineBanner } from '../../components/OfflineBanner';
import { theme } from '../../constants/theme';

type Category = { id: string; name: string; slug: string };

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useSession();
  const { coords, permissionDenied } = useUserLocation();
  const { ids: recentIds, addId } = useRecentlyViewed();
  const { config } = useAppConfig();
  const { isOnline } = useNetworkStatus();

  const [categories, setCategories] = useState<Category[]>([]);
  const [newLocations, setNewLocations] = useState<FeedLocation[]>([]);
  const [bookAgainLocations, setBookAgainLocations] = useState<FeedLocation[]>([]);
  const [recentLocations, setRecentLocations] = useState<FeedLocation[]>([]);

  useEffect(() => {
    supabase.from('categories').select('*').then(({ data }) => setCategories(data ?? []));
  }, []);

  useEffect(() => {
    if (!coords) return;
    const radius = parseInt(config['default_search_radius_m'] ?? '2000');
    supabase
      .rpc('search_locations', { p_lat: coords.latitude, p_lng: coords.longitude, p_radius_m: radius })
      .then(({ data }) => {
        const all: FeedLocation[] = data ?? [];
        setNewLocations(all.filter(l => (l as any).is_new));
      });
  }, [coords, config]);

  useEffect(() => {
    if (!session?.user.id) return;
    supabase
      .from('reservations')
      .select('location_id')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        const ids = [...new Set((data ?? []).map((r: any) => r.location_id))];
        if (ids.length === 0) return;
        supabase.from('locations').select('*').in('id', ids).then(({ data: locs }) => {
          setBookAgainLocations(locs ?? []);
        });
      });
  }, [session?.user.id]);

  useEffect(() => {
    if (recentIds.length === 0) return;
    supabase.from('locations').select('*').in('id', recentIds).then(({ data }) => {
      if (!data) return;
      const ordered = recentIds.map(id => data.find((l: any) => l.id === id)).filter(Boolean);
      setRecentLocations(ordered as FeedLocation[]);
    });
  }, [recentIds]);

  function navigateToLocation(id: string) {
    addId(id);
    router.push(`/${id}`);
  }

  function navigateToSearch(categorySlug?: string) {
    router.push(categorySlug ? `/search?category=${categorySlug}` : '/search');
  }

  return (
    <View style={styles.container}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.searchBar} onPress={() => navigateToSearch()}>
          <Text style={styles.searchPlaceholder}>{t('screens.home.searchPlaceholder')}</Text>
        </Pressable>

        {permissionDenied && (
          <View style={styles.locationBanner}>
            <Text style={styles.locationBannerText}>{t('common.enableLocationMessage')}</Text>
          </View>
        )}

        <FlatList
          horizontal
          data={categories}
          keyExtractor={c => c.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing[1], paddingHorizontal: theme.spacing[3] }}
          renderItem={({ item }) => (
            <CategoryChip label={item.name} onPress={() => navigateToSearch(item.slug)} />
          )}
          style={styles.chips}
        />

        {bookAgainLocations.length > 0 && (
          <FeedSection
            title={t('common.bookAgain')}
            locations={bookAgainLocations}
            onPress={navigateToLocation}
          />
        )}

        {recentLocations.length > 0 && (
          <FeedSection
            title={t('common.recentlyViewed')}
            locations={recentLocations}
            onPress={navigateToLocation}
          />
        )}

        {newLocations.length > 0 && (
          <FeedSection
            title={t('common.newToShineo')}
            locations={newLocations}
            onPress={navigateToLocation}
          />
        )}
      </ScrollView>
    </View>
  );
}

function FeedSection({ title, locations, onPress }: { title: string; locations: FeedLocation[]; onPress: (id: string) => void }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        horizontal
        data={locations}
        keyExtractor={l => l.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing[1], paddingHorizontal: theme.spacing[3] }}
        renderItem={({ item }) => <FeedCard location={item} onPress={() => onPress(item.id)} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { paddingBottom: theme.spacing[4] },
  searchBar: {
    margin: theme.spacing[3],
    height: 48,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.spacing[2],
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  searchPlaceholder: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    fontFamily: 'Inter_400Regular',
  },
  locationBanner: {
    marginHorizontal: theme.spacing[3],
    backgroundColor: '#FFF3E0',
    borderRadius: theme.radius.card,
    padding: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  locationBannerText: {
    ...theme.typography.caption,
    color: '#E65100',
    fontFamily: 'Inter_400Regular',
  },
  chips: { marginBottom: theme.spacing[1] },
  section: { marginTop: theme.spacing[2] },
  sectionTitle: {
    ...theme.typography.sectionHeader,
    color: theme.colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/app/home.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/index.tsx components/CategoryChip.tsx __tests__/app/home.test.tsx
git commit -m "feat: implement Home feed screen with categories and feed sections"
```

---

### Task 6: Search + Map Screen

**Files:**
- Modify: `app/(app)/search.tsx`
- Create: `components/MapPinCard.tsx`

**Interfaces:**
- Consumes: `useUserLocation`, `useAppConfig`, `useNetworkStatus`, `supabase.rpc('search_locations', ...)`, `FeedCard`, `isOpenNow`, `getImageUrl`
- Produces: full-screen map with bottom sheet list; tapping list item navigates to `/(app)/[id]`

- [ ] **Step 1: Write test**

Create `__tests__/app/search.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SearchScreen from '../../app/(app)/search';

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: any) => <View testID="map" />, Marker: (props: any) => null };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: ({ children }: any) => <View>{children}</View>, BottomSheetFlatList: require('react-native').FlatList };
});
jest.mock('../../hooks/useUserLocation', () => ({
  useUserLocation: () => ({ coords: { latitude: 44.4, longitude: 26.1 }, permissionDenied: false }),
}));
jest.mock('../../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ config: { default_search_radius_m: '2000' }, isLoading: false }),
}));
jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('../../lib/locationUtils', () => ({
  isOpenNow: jest.fn().mockReturnValue(true),
  getImageUrl: jest.fn().mockReturnValue('https://img.test/photo.jpg'),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));

const mockData = [
  { id: 'l1', name: 'Shine Co', rating: 4.2, review_count: 5, photos: [], hours: {}, timezone: 'Europe/Bucharest', distance_m: 500, listing_type: 'bookable' },
];
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn().mockResolvedValue({ data: mockData, error: null }),
    from: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ data: [], error: null }) }),
  },
}));

test('renders map', async () => {
  const { getByTestId } = render(<SearchScreen />);
  expect(getByTestId('map')).toBeTruthy();
});

test('renders search result after load', async () => {
  const { getByText } = render(<SearchScreen />);
  await waitFor(() => expect(getByText('Shine Co')).toBeTruthy());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/app/search.test.tsx
```

Expected: FAIL — search screen is a placeholder.

- [ ] **Step 3: Create `components/MapPinCard.tsx`**

```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { theme } from '../constants/theme';
import { isOpenNow, getImageUrl, type } from '../lib/locationUtils';
import type { FeedLocation } from './FeedCard';

type Props = { location: FeedLocation; onPress: () => void };

export function MapPinCard({ location, onPress }: Props) {
  const { t } = useTranslation();
  const open = isOpenNow(location.hours, location.timezone);
  const imageUrl = location.photos?.[0] ? getImageUrl(location.photos[0], 400, 300, 80) : null;
  const distanceKm = location.distance_m != null ? (location.distance_m / 1000).toFixed(1) : null;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {imageUrl && <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{location.name}</Text>
        <Text style={styles.meta}>
          {distanceKm ? t('common.distance', { km: distanceKm }) : ''}
          {location.rating ? `  ★ ${location.rating.toFixed(1)}` : ''}
        </Text>
        <Text style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
          {open ? t('common.openNow') : t('common.closed')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  image: { width: 80, height: 80 },
  body: { flex: 1, padding: theme.spacing[1], justifyContent: 'center', gap: 4 },
  name: { ...theme.typography.cardTitle, color: theme.colors.textPrimary, fontFamily: 'Inter_600SemiBold' },
  meta: { ...theme.typography.caption, color: theme.colors.textSecondary, fontFamily: 'Inter_400Regular' },
  badge: { ...theme.typography.caption, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  badgeOpen: { color: theme.colors.primary },
  badgeClosed: { color: theme.colors.textSecondary },
});
```

- [ ] **Step 4: Implement `app/(app)/search.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { CategoryChip } from '../../components/CategoryChip';
import { MapPinCard } from '../../components/MapPinCard';
import { OfflineBanner } from '../../components/OfflineBanner';
import { theme } from '../../constants/theme';
import type { FeedLocation } from '../../components/FeedCard';

const SNAP_POINTS = ['25%', '50%', '90%'];
const DEFAULT_REGION = { latitude: 44.4268, longitude: 26.1025, latitudeDelta: 0.05, longitudeDelta: 0.05 };

type Category = { id: string; name: string; slug: string };

export default function SearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const { coords, permissionDenied } = useUserLocation();
  const { config } = useAppConfig();
  const { isOnline } = useNetworkStatus();

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(params.category ?? null);
  const [selectedListingType, setSelectedListingType] = useState<string | null>(null);
  const [results, setResults] = useState<FeedLocation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const bottomSheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    supabase.from('categories').select('*').then(({ data }) => setCategories(data ?? []));
  }, []);

  const search = useCallback(async () => {
    const lat = coords?.latitude ?? DEFAULT_REGION.latitude;
    const lng = coords?.longitude ?? DEFAULT_REGION.longitude;
    const radius = parseInt(config['default_search_radius_m'] ?? '2000');
    const { data } = await supabase.rpc('search_locations', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radius,
      p_query: query || null,
      p_category: selectedCategory,
      p_listing_type: selectedListingType,
    });
    setResults(data ?? []);
  }, [coords, config, query, selectedCategory, selectedListingType]);

  useEffect(() => { search(); }, [search]);

  const region: Region = coords
    ? { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : DEFAULT_REGION;

  return (
    <View style={styles.container}>
      <MapView style={StyleSheet.absoluteFillObject} provider="google" region={region} showsUserLocation={!permissionDenied}>
        {results.map(loc => (
          <Marker
            key={loc.id}
            coordinate={{ latitude: (loc as any).coordinates?.latitude ?? 0, longitude: (loc as any).coordinates?.longitude ?? 0 }}
            onPress={() => router.push(`/${loc.id}`)}
          />
        ))}
      </MapView>

      <OfflineBanner />

      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t('screens.search.searchPlaceholder')}
          placeholderTextColor={theme.colors.textSecondary}
          editable={isOnline}
        />
      </View>

      <FlatList
        horizontal
        data={categories}
        keyExtractor={c => c.id}
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={{ gap: theme.spacing[1], paddingHorizontal: theme.spacing[3] }}
        renderItem={({ item }) => (
          <CategoryChip
            label={item.name}
            selected={selectedCategory === item.slug}
            onPress={() => setSelectedCategory(selectedCategory === item.slug ? null : item.slug)}
          />
        )}
        ListFooterComponent={
          <View style={{ flexDirection: 'row', gap: theme.spacing[1] }}>
            <CategoryChip
              label={t('screens.search.filterBookable')}
              selected={selectedListingType === 'bookable'}
              onPress={() => setSelectedListingType(selectedListingType === 'bookable' ? null : 'bookable')}
            />
            <CategoryChip
              label={t('screens.search.filterAdvertised')}
              selected={selectedListingType === 'advertised'}
              onPress={() => setSelectedListingType(selectedListingType === 'advertised' ? null : 'advertised')}
            />
          </View>
        }
      />

      <BottomSheet ref={bottomSheetRef} snapPoints={SNAP_POINTS} index={1}>
        <BottomSheetFlatList
          data={results}
          keyExtractor={l => l.id}
          renderItem={({ item }) => (
            <MapPinCard location={item} onPress={() => router.push(`/${item.id}`)} />
          )}
          contentContainerStyle={{ paddingBottom: theme.spacing[4] }}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    position: 'absolute',
    top: 48,
    left: theme.spacing[3],
    right: theme.spacing[3],
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.spacing[2],
    height: 48,
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  input: { ...theme.typography.body, color: theme.colors.textPrimary, fontFamily: 'Inter_400Regular' },
  chips: { position: 'absolute', top: 108, left: 0, right: 0 },
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/app/search.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/search.tsx components/MapPinCard.tsx __tests__/app/search.test.tsx
git commit -m "feat: implement Search+Map screen with bottom sheet and filters"
```

---

### Task 7: Custom Liquid Tab Bar

**Files:**
- Create: `components/LiquidTabBar.tsx`
- Modify: `app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `react-native-svg`, `react-native-reanimated`
- Produces: custom `tabBar` prop component for the `(app)` Tabs layout; active tab shows green bubble morphing with SVG curved path; inactive icons grey

- [ ] **Step 1: Create `components/LiquidTabBar.tsx`**

```tsx
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../constants/theme';

const TAB_WIDTH = 70;
const BAR_HEIGHT = 64;
const BUBBLE_RADIUS = 28;

function getBubblePath(cx: number): string {
  const r = BUBBLE_RADIUS;
  const top = 4;
  return [
    `M ${cx - r - 16} ${top + r}`,
    `Q ${cx - r - 8} ${top} ${cx - r} ${top}`,
    `Q ${cx} ${top - 12} ${cx + r} ${top}`,
    `Q ${cx + r + 8} ${top} ${cx + r + 16} ${top + r}`,
    `L ${cx + r + 16} ${BAR_HEIGHT}`,
    `L ${cx - r - 16} ${BAR_HEIGHT}`,
    'Z',
  ].join(' ');
}

export function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const bubbleX = useSharedValue(state.index * TAB_WIDTH + TAB_WIDTH / 2);

  const animatedBubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bubbleX.value - BUBBLE_RADIUS - 16 }],
  }));

  const icons: Record<string, string> = {
    index: '🏠',
    search: '🔍',
    activity: '📋',
    profile: '👤',
  };

  return (
    <View style={styles.container}>
      {/* SVG curved background for active bubble */}
      <Svg width="100%" height={BAR_HEIGHT} style={StyleSheet.absoluteFillObject}>
        <Path
          d={getBubblePath(state.index * TAB_WIDTH + TAB_WIDTH / 2)}
          fill={theme.colors.primary}
        />
      </Svg>

      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const label = icons[route.name] ?? '●';

        function onPress() {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) {
            bubbleX.value = withSpring(index * TAB_WIDTH + TAB_WIDTH / 2, { damping: 15 });
            navigation.navigate(route.name);
          }
        }

        return (
          <Pressable key={route.key} style={styles.tab} onPress={onPress}>
            <Animated.Text style={[styles.icon, isFocused ? styles.iconActive : styles.iconInactive]}>
              {label}
            </Animated.Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  icon: { fontSize: 22 },
  iconActive: { tintColor: '#fff' },
  iconInactive: { opacity: 0.5 },
});
```

- [ ] **Step 2: Update `app/(app)/_layout.tsx`**

```tsx
import { Tabs } from 'expo-router';
import { LiquidTabBar } from '../../components/LiquidTabBar';

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={props => <LiquidTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
```

- [ ] **Step 3: Visually verify the tab bar**

Start the app (`npx expo start --go`). Navigate between tabs and confirm:
- Green bubble shifts fluidly between tabs
- Active tab icon is white, inactive icons are grey

- [ ] **Step 4: Commit**

```bash
git add components/LiquidTabBar.tsx app/\(app\)/_layout.tsx
git commit -m "feat: add custom liquid SVG tab bar with animated bubble"
```
