# Shineo App — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Expo project with Supabase, auth skeleton, i18n, design tokens, navigation shell, offline detection, and force-update gate — everything later plans build on.

**Architecture:** Expo Router v3 file-based navigation with a root layout that wraps all routes in a `SessionProvider`. The root layout uses `Stack.Protected` to implement a 3-state auth guard (unauthenticated → sign-in, authenticated+not onboarded → profile-setup, authenticated+onboarded → app). Supabase session is persisted in SecureStore. Design tokens live in a single `constants/theme.ts` file. i18n is initialised once at app startup and consumed via `useTranslation()`.

**Tech Stack:** Expo SDK 52, Expo Router v3, TypeScript, Supabase JS v2, `@supabase/supabase-js`, `expo-secure-store`, `i18next`, `react-i18next`, `expo-localization`, `@react-native-community/netinfo`, `expo-font`, `@expo-google-fonts/inter`, `expo-constants`

## Global Constraints

- Expo SDK: 52+, managed workflow (no bare/ejected)
- Language: TypeScript strict mode (`"strict": true` in tsconfig)
- Navigation: Expo Router v3 file-based only — no `react-navigation` directly
- Supabase client is a singleton imported from `lib/supabase.ts`
- All static UI strings go through `useTranslation()` — no hardcoded English
- Design tokens imported from `constants/theme.ts` — no inline hex colours
- Spacing: 8px base unit; allowed values: 4, 8, 12, 16, 24, 32
- Card border-radius: 16, button: 12, input: 12, chip: 999
- Primary green: `#2DC653`, primary-dark: `#1F9E3E`

---

### Task 1: Expo Project Initialisation

**Files:**
- Create: `app.json`
- Create: `tsconfig.json`
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: a runnable Expo project skeleton that `npx expo start` can serve

- [ ] **Step 1: Initialise Expo project**

```bash
npx create-expo-app@latest shineo-app --template blank-typescript
cd shineo-app
```

- [ ] **Step 2: Install core dependencies**

```bash
npx expo install expo-router expo-constants expo-secure-store expo-localization expo-image expo-font @expo-google-fonts/inter expo-notifications
npx expo install @react-native-community/netinfo react-native-reanimated react-native-gesture-handler react-native-svg
npx expo install @supabase/supabase-js
npm install i18next react-i18next
```

- [ ] **Step 3: Update app.json for Expo Router**

Replace the contents of `app.json`:

```json
{
  "expo": {
    "name": "Shineo",
    "slug": "shineo-app",
    "version": "1.0.0",
    "scheme": "shineo",
    "sdkVersion": "52.0.0",
    "platforms": ["ios", "android"],
    "entryPoint": "expo-router/entry",
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-font",
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#2DC653"
        }
      ],
      [
        "@react-native-google-signin/google-signin",
        {
          "iosUrlScheme": "com.googleusercontent.apps.REPLACE_ME"
        }
      ]
    ],
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.shineo.app"
    },
    "android": {
      "package": "com.shineo.app",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#2DC653"
      }
    }
  }
}
```

- [ ] **Step 4: Create `.env.example`**

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Copy to `.env.local` and fill in real values.

- [ ] **Step 5: Verify project starts**

```bash
npx expo start --go
```

Expected: Metro bundler starts, no errors in terminal.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: initialise Expo project with core dependencies"
```

---

### Task 2: Database Schema (Supabase)

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`

**Interfaces:**
- Produces: all tables and indexes needed by every later plan

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/0001_initial_schema.sql`:

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;

-- profiles
CREATE TABLE profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name     text,
  phone            text,
  onboarded        boolean DEFAULT false,
  language         text DEFAULT 'en',
  push_enabled     boolean DEFAULT true,
  sms_enabled      boolean DEFAULT false,
  gdpr_accepted_at timestamptz,
  updated_at       timestamptz
);

-- user_cars
CREATE TABLE user_cars (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users ON DELETE CASCADE,
  make       text NOT NULL,
  model      text NOT NULL,
  plate      text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- locations
CREATE TABLE locations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid REFERENCES auth.users,
  name                text NOT NULL,
  type                text NOT NULL,
  listing_type        text DEFAULT 'advertised',
  address             text,
  coordinates         geography(Point, 4326) NOT NULL,
  photos              text[],
  phone               text,
  rating              float4,
  review_count        int,
  hours               jsonb,
  timezone            text DEFAULT 'Europe/Bucharest',
  is_new              boolean DEFAULT false,
  cancellation_policy jsonb,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX locations_name_trgm_idx ON locations USING GIN (name gin_trgm_ops);
CREATE INDEX locations_coordinates_idx ON locations USING GIST (coordinates);

-- categories
CREATE TABLE categories (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

-- location_categories
CREATE TABLE location_categories (
  location_id uuid REFERENCES locations ON DELETE CASCADE,
  category_id uuid REFERENCES categories ON DELETE CASCADE,
  PRIMARY KEY (location_id, category_id)
);

-- services
CREATE TABLE services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid REFERENCES locations ON DELETE CASCADE,
  name         text NOT NULL,
  duration_min int,
  price        numeric(10,2),
  currency     text DEFAULT 'RON'
);

-- location_slots
CREATE TABLE location_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations ON DELETE CASCADE,
  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  capacity    int DEFAULT 1,
  created_at  timestamptz DEFAULT now()
);

-- reservations
CREATE TABLE reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users,
  location_id uuid REFERENCES locations,
  service_id  uuid REFERENCES services,
  slot_id     uuid REFERENCES location_slots,
  car_id      uuid REFERENCES user_cars,
  status      text DEFAULT 'confirmed',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, slot_id)
);

-- reviews
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users,
  location_id uuid REFERENCES locations ON DELETE CASCADE,
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz DEFAULT now()
);

-- push_tokens
CREATE TABLE push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users ON DELETE CASCADE UNIQUE,
  token      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- app_config
CREATE TABLE app_config (
  key   text PRIMARY KEY,
  value text NOT NULL,
  note  text
);

INSERT INTO app_config (key, value, note) VALUES
  ('default_search_radius_m', '2000',  'Default nearby search radius in metres'),
  ('privacy_policy_url',      'https://shineo.app/privacy', 'Privacy policy URL shown at first login'),
  ('new_location_expiry_days','30',    'Days before is_new flag is cleared on locations'),
  ('min_app_version',         '1.0.0', 'Minimum app version allowed');

-- Trigger: update locations.rating and review_count on reviews change
CREATE OR REPLACE FUNCTION update_location_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE locations SET
    rating       = (SELECT AVG(rating)::float4 FROM reviews WHERE location_id = COALESCE(NEW.location_id, OLD.location_id)),
    review_count = (SELECT COUNT(*)::int      FROM reviews WHERE location_id = COALESCE(NEW.location_id, OLD.location_id))
  WHERE id = COALESCE(NEW.location_id, OLD.location_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_rating_update
AFTER INSERT OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION update_location_rating();

-- pg_cron: clear is_new daily at 02:00 UTC
SELECT cron.schedule('clear-is-new', '0 2 * * *', $$
  UPDATE locations SET is_new = false
  WHERE is_new = true
  AND created_at < now() - (
    SELECT value::int FROM app_config WHERE key = 'new_location_expiry_days'
  ) * interval '1 day';
$$);
```

- [ ] **Step 2: Create search_locations RPC**

Append to the same migration file:

```sql
CREATE OR REPLACE FUNCTION search_locations(
  p_lat          float8,
  p_lng          float8,
  p_radius_m     float8,
  p_query        text        DEFAULT NULL,
  p_category     text        DEFAULT NULL,
  p_listing_type text        DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  name         text,
  type         text,
  listing_type text,
  address      text,
  photos       text[],
  phone        text,
  rating       float4,
  review_count int,
  hours        jsonb,
  timezone     text,
  is_new       boolean,
  distance_m   float8
) LANGUAGE sql STABLE AS $$
  SELECT
    l.id, l.name, l.type, l.listing_type, l.address,
    l.photos, l.phone, l.rating, l.review_count,
    l.hours, l.timezone, l.is_new,
    ST_Distance(l.coordinates, ST_Point(p_lng, p_lat)::geography) AS distance_m
  FROM locations l
  WHERE
    (p_query IS NULL OR l.name % p_query)
    AND ST_DWithin(l.coordinates, ST_Point(p_lng, p_lat)::geography, p_radius_m)
    AND (p_category IS NULL OR l.id IN (
      SELECT lc.location_id FROM location_categories lc
      JOIN categories c ON c.id = lc.category_id
      WHERE c.slug = p_category
    ))
    AND (p_listing_type IS NULL OR l.listing_type = p_listing_type)
  ORDER BY distance_m ASC;
$$;
```

- [ ] **Step 3: Apply RLS policies**

Append to the same migration file:

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON profiles FOR ALL USING (id = auth.uid());

ALTER TABLE user_cars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cars" ON user_cars FOR ALL USING (user_id = auth.uid());

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reservations" ON reservations FOR ALL USING (user_id = auth.uid());

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own push token" ON push_tokens FOR ALL USING (user_id = auth.uid());

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read locations" ON locations FOR SELECT USING (true);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read services" ON services FOR SELECT USING (true);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read categories" ON categories FOR SELECT USING (true);

ALTER TABLE location_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read location_categories" ON location_categories FOR SELECT USING (true);

ALTER TABLE location_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read slots" ON location_slots FOR SELECT USING (true);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read reviews" ON reviews FOR SELECT USING (true);
CREATE POLICY "own reviews" ON reviews FOR INSERT WITH CHECK (user_id = auth.uid());

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read app_config" ON app_config FOR SELECT USING (true);
```

- [ ] **Step 4: Run the migration in Supabase dashboard**

In Supabase dashboard → SQL Editor, paste and run the full migration. Verify all tables appear in Table Editor.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add database schema with RLS policies and search RPC"
```

---

### Task 3: Supabase Client + Session Provider

**Files:**
- Create: `lib/supabase.ts`
- Create: `lib/auth.tsx`

**Interfaces:**
- Produces: `supabase` (default export from `lib/supabase.ts`), `SessionProvider` (component), `useSession()` (hook returning `{ session, profile, isLoading }`)

- [ ] **Step 1: Write test for useSession hook**

Create `__tests__/lib/auth.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../../lib/auth';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

test('useSession returns isLoading=true initially', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider>{children}</SessionProvider>
  );
  const { result } = renderHook(() => useSession(), { wrapper });
  expect(result.current.isLoading).toBe(true);
});

test('useSession returns null session when not logged in', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider>{children}</SessionProvider>
  );
  const { result } = renderHook(() => useSession(), { wrapper });
  await new Promise(r => setTimeout(r, 50));
  expect(result.current.session).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/auth.test.tsx
```

Expected: FAIL — `lib/auth` module not found.

- [ ] **Step 3: Create `lib/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
```

- [ ] **Step 4: Create `lib/auth.tsx`**

```typescript
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Profile = {
  id: string;
  display_name: string | null;
  phone: string | null;
  onboarded: boolean;
  language: string;
  push_enabled: boolean;
  sms_enabled: boolean;
  gdpr_accepted_at: string | null;
};

type SessionContextValue = {
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  refreshProfile: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue>({
  session: null,
  profile: null,
  isLoading: true,
  refreshProfile: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data ?? null);
  }

  async function refreshProfile() {
    if (session?.user.id) await loadProfile(session.user.id);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id).finally(() => setIsLoading(false));
      else setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ session, profile, isLoading, refreshProfile }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/lib/auth.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/ __tests__/lib/auth.test.tsx
git commit -m "feat: add Supabase client and SessionProvider"
```

---

### Task 4: Design Tokens

**Files:**
- Create: `constants/theme.ts`

**Interfaces:**
- Produces: `theme` object with `colors`, `typography`, `spacing`, `radius` exported from `constants/theme.ts`

- [ ] **Step 1: Write test**

Create `__tests__/constants/theme.test.ts`:

```typescript
import { theme } from '../../constants/theme';

test('primary color is correct', () => {
  expect(theme.colors.primary).toBe('#2DC653');
});

test('spacing unit 1 = 8', () => {
  expect(theme.spacing[1]).toBe(8);
});

test('card radius = 16', () => {
  expect(theme.radius.card).toBe(16);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/constants/theme.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `constants/theme.ts`**

```typescript
export const theme = {
  colors: {
    primary:        '#2DC653',
    primaryDark:    '#1F9E3E',
    surface:        '#FFFFFF',
    background:     '#F4F5F7',
    textPrimary:    '#1A1A1A',
    textSecondary:  '#6B7280',
    border:         '#E5E7EB',
    error:          '#EF4444',
    success:        '#2DC653',
  },
  typography: {
    screenTitle:   { fontSize: 24, fontWeight: '700' as const },
    sectionHeader: { fontSize: 18, fontWeight: '600' as const },
    cardTitle:     { fontSize: 16, fontWeight: '600' as const },
    body:          { fontSize: 14, fontWeight: '400' as const },
    caption:       { fontSize: 12, fontWeight: '400' as const },
  },
  spacing: {
    0: 4,
    1: 8,
    2: 12,
    3: 16,
    4: 24,
    5: 32,
  },
  radius: {
    card:   16,
    button: 12,
    input:  12,
    chip:   999,
  },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/constants/theme.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add constants/theme.ts __tests__/constants/theme.test.ts
git commit -m "feat: add design token constants"
```

---

### Task 5: i18n Setup

**Files:**
- Create: `locales/en.json`
- Create: `locales/ro.json`
- Create: `lib/i18n.ts`

**Interfaces:**
- Produces: `initI18n()` called once at app startup; `useTranslation()` from `react-i18next` works app-wide

- [ ] **Step 1: Write test**

Create `__tests__/lib/i18n.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/i18n.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `locales/en.json`**

```json
{
  "common": {
    "signIn": "Sign In",
    "continue": "Continue",
    "save": "Save",
    "cancel": "Cancel",
    "back": "Back",
    "loading": "Loading…",
    "error": "Something went wrong",
    "noInternet": "No internet connection",
    "updateRequired": "Update Required",
    "updateMessage": "Please update the app to continue.",
    "openAppStore": "Update Now",
    "openNow": "Open now",
    "closed": "Closed",
    "distance": "{{km}} km away",
    "bookAgain": "Book Again",
    "recentlyViewed": "Recently Viewed",
    "newToShineo": "New to Shineo",
    "noAvailability": "No availability at this time. Check back later.",
    "slotTaken": "This slot was just taken — please pick another time.",
    "bookNow": "Book Now",
    "getDirections": "Get Directions",
    "call": "Call",
    "viewInActivity": "View in Activity",
    "upcoming": "Upcoming",
    "past": "Past",
    "signOut": "Sign Out",
    "deleteAccount": "Delete Account",
    "deleteAccountConfirm": "Are you sure? This cannot be undone.",
    "myCars": "My Cars",
    "addCar": "Add Car",
    "defaultCar": "Default",
    "enableLocation": "Enable Location",
    "enableLocationMessage": "Enable location access to see nearby car washes.",
    "privacyPolicy": "Privacy Policy",
    "acceptPrivacyPolicy": "I accept the Privacy Policy",
    "reminderNotification": "Reminder: your {{service}} at {{location}} is tomorrow at {{time}}."
  },
  "screens": {
    "signIn": {
      "tagline": "Your car, always clean."
    },
    "profileSetup": {
      "title": "Set Up Your Profile",
      "namePlaceholder": "Your name",
      "phonePlaceholder": "+40...",
      "addCarTitle": "Add Your First Car (optional)",
      "makePlaceholder": "Make",
      "modelPlaceholder": "Model",
      "platePlaceholder": "Plate",
      "skipCar": "Skip"
    },
    "home": {
      "searchPlaceholder": "Search car washes…"
    },
    "search": {
      "searchPlaceholder": "Search by name…",
      "filterBookable": "Bookable",
      "filterAdvertised": "Advertised",
      "clearAll": "Clear All"
    },
    "booking": {
      "selectService": "Select Service",
      "selectDate": "Select Date",
      "selectTime": "Select Time",
      "selectCar": "Select Car (optional)",
      "noCar": "No car selected",
      "confirm": "Confirm Booking"
    },
    "activity": {
      "title": "Activity",
      "emptyUpcoming": "No upcoming bookings.",
      "emptyPast": "No past bookings."
    },
    "profile": {
      "title": "Profile",
      "language": "Language",
      "pushNotifications": "Push Notifications",
      "smsNotifications": "SMS Notifications",
      "preferences": "Preferences"
    }
  }
}
```

- [ ] **Step 4: Create `locales/ro.json`**

```json
{
  "common": {
    "signIn": "Autentificare",
    "continue": "Continuă",
    "save": "Salvează",
    "cancel": "Anulează",
    "back": "Înapoi",
    "loading": "Se încarcă…",
    "error": "Ceva nu a mers bine",
    "noInternet": "Fără conexiune la internet",
    "updateRequired": "Actualizare necesară",
    "updateMessage": "Vă rugăm să actualizați aplicația pentru a continua.",
    "openAppStore": "Actualizează",
    "openNow": "Deschis acum",
    "closed": "Închis",
    "distance": "{{km}} km distanță",
    "bookAgain": "Rezervă din nou",
    "recentlyViewed": "Vizualizate recent",
    "newToShineo": "Nou pe Shineo",
    "noAvailability": "Nicio disponibilitate în acest moment. Reveniți mai târziu.",
    "slotTaken": "Acest slot a fost rezervat — vă rugăm alegeți o altă oră.",
    "bookNow": "Rezervă acum",
    "getDirections": "Obține indicații",
    "call": "Sună",
    "viewInActivity": "Vezi în Activitate",
    "upcoming": "Viitoare",
    "past": "Anterioare",
    "signOut": "Deconectare",
    "deleteAccount": "Șterge contul",
    "deleteAccountConfirm": "Ești sigur? Această acțiune nu poate fi anulată.",
    "myCars": "Mașinile mele",
    "addCar": "Adaugă mașină",
    "defaultCar": "Implicită",
    "enableLocation": "Activează localizarea",
    "enableLocationMessage": "Activează accesul la locație pentru a vedea spălătoriile din apropiere.",
    "privacyPolicy": "Politica de confidențialitate",
    "acceptPrivacyPolicy": "Accept Politica de confidențialitate",
    "reminderNotification": "Reminder: {{service}} la {{location}} este mâine la {{time}}."
  },
  "screens": {
    "signIn": {
      "tagline": "Mașina ta, mereu curată."
    },
    "profileSetup": {
      "title": "Configurați profilul",
      "namePlaceholder": "Numele tău",
      "phonePlaceholder": "+40...",
      "addCarTitle": "Adaugă prima mașină (opțional)",
      "makePlaceholder": "Marcă",
      "modelPlaceholder": "Model",
      "platePlaceholder": "Număr",
      "skipCar": "Sari"
    },
    "home": {
      "searchPlaceholder": "Caută spălătorii…"
    },
    "search": {
      "searchPlaceholder": "Caută după nume…",
      "filterBookable": "Cu rezervare",
      "filterAdvertised": "Anunț",
      "clearAll": "Șterge filtrele"
    },
    "booking": {
      "selectService": "Selectează serviciu",
      "selectDate": "Selectează data",
      "selectTime": "Selectează ora",
      "selectCar": "Selectează mașina (opțional)",
      "noCar": "Nicio mașină selectată",
      "confirm": "Confirmă rezervarea"
    },
    "activity": {
      "title": "Activitate",
      "emptyUpcoming": "Nicio rezervare viitoare.",
      "emptyPast": "Nicio rezervare anterioară."
    },
    "profile": {
      "title": "Profil",
      "language": "Limbă",
      "pushNotifications": "Notificări push",
      "smsNotifications": "Notificări SMS",
      "preferences": "Preferințe"
    }
  }
}
```

- [ ] **Step 5: Create `lib/i18n.ts`**

```typescript
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
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx jest __tests__/lib/i18n.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add locales/ lib/i18n.ts __tests__/lib/i18n.test.ts
git commit -m "feat: add i18n setup with English and Romanian translations"
```

---

### Task 6: Navigation Shell + Root Layout

**Files:**
- Create: `app/_layout.tsx`
- Create: `app/(app)/_layout.tsx`
- Create: `app/sign-in.tsx` (placeholder)
- Create: `app/profile-setup.tsx` (placeholder)
- Create: `app/(app)/index.tsx` (placeholder)
- Create: `app/(app)/search.tsx` (placeholder)
- Create: `app/(app)/activity.tsx` (placeholder)
- Create: `app/(app)/profile.tsx` (placeholder)
- Create: `hooks/useAppConfig.ts`

**Interfaces:**
- Consumes: `SessionProvider`, `useSession()` from `lib/auth.tsx`; `initI18n` from `lib/i18n.ts`
- Produces: navigation skeleton where the 3-state guard routes correctly; `useAppConfig()` hook returning `{ config, isLoading }`

- [ ] **Step 1: Write test for useAppConfig**

Create `__tests__/hooks/useAppConfig.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react-native';
import { useAppConfig } from '../../hooks/useAppConfig';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({
        data: [
          { key: 'default_search_radius_m', value: '2000' },
          { key: 'min_app_version', value: '1.0.0' },
          { key: 'privacy_policy_url', value: 'https://shineo.app/privacy' },
        ],
        error: null,
      }),
    }),
  },
}));

test('useAppConfig returns parsed config', async () => {
  const { result } = renderHook(() => useAppConfig());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.config['default_search_radius_m']).toBe('2000');
  expect(result.current.config['min_app_version']).toBe('1.0.0');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/hooks/useAppConfig.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `hooks/useAppConfig.ts`**

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type AppConfig = Record<string, string>;

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('app_config')
      .select('key, value')
      .then(({ data }) => {
        if (data) {
          const map: AppConfig = {};
          for (const row of data) map[row.key] = row.value;
          setConfig(map);
        }
        setIsLoading(false);
      });
  }, []);

  return { config, isLoading };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/hooks/useAppConfig.test.ts
```

Expected: PASS

- [ ] **Step 5: Create `app/_layout.tsx`**

```tsx
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
  const { session, profile, isLoading } = useSession();
  const { config, isLoading: configLoading } = useAppConfig();

  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    const lang = profile?.language ?? (ExpoLocalization.locale.startsWith('ro') ? 'ro' : 'en');
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
  if (!profile?.onboarded) return <Redirect href="/profile-setup" />;

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
```

- [ ] **Step 6: Create `components/ForceUpdateScreen.tsx`**

```tsx
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '../constants/theme';

export function ForceUpdateScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('common.updateRequired')}</Text>
      <Text style={styles.message}>{t('common.updateMessage')}</Text>
      <Pressable
        style={styles.button}
        onPress={() => Linking.openURL('https://apps.apple.com/app/shineo')}
      >
        <Text style={styles.buttonText}>{t('common.openAppStore')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing[3], backgroundColor: theme.colors.background },
  title: { ...theme.typography.screenTitle, color: theme.colors.textPrimary, marginBottom: theme.spacing[1] },
  message: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing[4] },
  button: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[1], borderRadius: theme.radius.button },
  buttonText: { ...theme.typography.body, color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 7: Create placeholder screens**

Create `app/sign-in.tsx`:
```tsx
import { View, Text } from 'react-native';
export default function SignInScreen() {
  return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Sign In (placeholder)</Text></View>;
}
```

Create `app/profile-setup.tsx`:
```tsx
import { View, Text } from 'react-native';
export default function ProfileSetupScreen() {
  return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Profile Setup (placeholder)</Text></View>;
}
```

Create `app/(app)/_layout.tsx`:
```tsx
import { Tabs } from 'expo-router';
export default function AppLayout() {
  return <Tabs screenOptions={{ headerShown: false }} />;
}
```

Create `app/(app)/index.tsx`:
```tsx
import { View, Text } from 'react-native';
export default function HomeScreen() {
  return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Home (placeholder)</Text></View>;
}
```

Create `app/(app)/search.tsx`:
```tsx
import { View, Text } from 'react-native';
export default function SearchScreen() {
  return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Search (placeholder)</Text></View>;
}
```

Create `app/(app)/activity.tsx`:
```tsx
import { View, Text } from 'react-native';
export default function ActivityScreen() {
  return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Activity (placeholder)</Text></View>;
}
```

Create `app/(app)/profile.tsx`:
```tsx
import { View, Text } from 'react-native';
export default function ProfileScreen() {
  return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Profile (placeholder)</Text></View>;
}
```

- [ ] **Step 8: Verify navigation skeleton runs**

```bash
npx expo start --go
```

Expected: App launches, fonts load, if unauthenticated redirects to sign-in placeholder.

- [ ] **Step 9: Commit**

```bash
git add app/ components/ForceUpdateScreen.tsx hooks/useAppConfig.ts __tests__/
git commit -m "feat: add navigation shell with 3-state auth guard and force-update screen"
```

---

### Task 7: Offline Banner Component

**Files:**
- Create: `components/OfflineBanner.tsx`
- Create: `hooks/useNetworkStatus.ts`

**Interfaces:**
- Produces: `useNetworkStatus()` → `{ isOnline: boolean }`; `<OfflineBanner />` component that shows/hides based on network state

- [ ] **Step 1: Write test for useNetworkStatus**

Create `__tests__/hooks/useNetworkStatus.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

test('useNetworkStatus returns isOnline=true by default', async () => {
  (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => {
    cb({ isConnected: true });
    return jest.fn();
  });
  const { result } = renderHook(() => useNetworkStatus());
  expect(result.current.isOnline).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/hooks/useNetworkStatus.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `hooks/useNetworkStatus.ts`**

```typescript
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? true);
    });
    return unsubscribe;
  }, []);

  return { isOnline };
}
```

- [ ] **Step 4: Create `components/OfflineBanner.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { theme } from '../constants/theme';

export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const { t } = useTranslation();

  const animatedStyle = useAnimatedStyle(() => ({
    height: withTiming(isOnline ? 0 : 36, { duration: 250 }),
    opacity: withTiming(isOnline ? 0 : 1, { duration: 250 }),
  }));

  return (
    <Animated.View style={[styles.banner, animatedStyle]}>
      <Text style={styles.text}>{t('common.noInternet')}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: {
    color: '#fff',
    ...theme.typography.caption,
    fontWeight: '600',
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/hooks/useNetworkStatus.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/OfflineBanner.tsx hooks/useNetworkStatus.ts __tests__/hooks/useNetworkStatus.test.ts
git commit -m "feat: add offline detection hook and animated offline banner"
```
