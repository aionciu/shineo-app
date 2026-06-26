# Shineo App — Design Spec

**Date:** 2026-06-26  
**Scope:** Customer-facing React Native mobile app for finding and booking car wash appointments.

---

## Overview

Shineo is a Fresha-style mobile app for car wash bookings. Customers can find nearby car washing locations, view details, make reservations, and manage their activity — all on iOS and Android from a single Expo codebase.

This spec covers the customer app only. A separate business-owner app will be built later.

---

## Stack

| Concern | Technology |
|---|---|
| Framework | Expo SDK 52+ (managed workflow) |
| Navigation | Expo Router v3 (file-based) |
| Language | TypeScript |
| Backend / DB | Supabase (Postgres + Auth + Edge Functions) |
| Search | Postgres `pg_trgm` extension (trigram GIN index on location name) |
| Geo queries | PostGIS (`ST_DWithin` radius search, `ST_Distance` for distance display) |
| Auth | Google Sign-In via `@react-native-google-signin/google-signin` + Supabase `signInWithIdToken` |
| Maps | React Native Maps (Google Maps provider) |
| Image storage | Supabase Storage |
| Image delivery | Supabase Storage transformation API (on-the-fly resize + CDN cache) |
| Image rendering | `expo-image` (disk cache, fast decode) |
| Bottom sheet | `@gorhom/bottom-sheet` |
| Push notifications | Expo Notifications |
| Session storage | Expo SecureStore |
| Internationalisation | `expo-localization` + `i18next` + `react-i18next` |
| Network detection | `@react-native-community/netinfo` |
| Animation | `react-native-reanimated` + `react-native-gesture-handler` |
| Bottom tab bar | Custom liquid tab bar (`react-native-svg` + `react-native-reanimated`) |

---

## Auth Flow

- Root layout wraps all routes in a `SessionProvider` (React context backed by Supabase session).
- `Stack.Protected` in the root layout gates routes based on two checks:
  1. Not authenticated → `/sign-in`
  2. Authenticated but no profile (`onboarded = false`) → `/profile-setup`
  3. Authenticated + onboarded → `(app)` group
- Supabase session is persisted in SecureStore so users stay logged in across app restarts.
- On sign-out the session is cleared and the router redirects to `/sign-in`.

---

## File Structure

```
app/
  _layout.tsx              ← root layout: SessionProvider + Stack.Protected (3-state guard)
  sign-in.tsx              ← public: login/landing screen
  profile-setup.tsx        ← first-login: profile setup screen (auth required, onboarded=false)
  (app)/
    _layout.tsx            ← protected layout: bottom tab bar (Home, Search, Activity, Profile)
    index.tsx              ← Home feed screen
    search.tsx             ← Search + Map screen
    activity.tsx           ← Activity screen (upcoming + past bookings)
    profile.tsx            ← Profile screen
    [id].tsx               ← Location Detail screen (stack, pushed from Home or Search)
    booking/[id].tsx       ← Booking screen (stack, pushed from Detail)
    booking/confirmation.tsx ← Booking Confirmation screen (stack, shown after successful booking)

lib/
  supabase.ts              ← Supabase client (initialized with SecureStore adapter)
  auth.tsx                 ← SessionProvider + useSession hook
```

---

## Screens

### `/sign-in` — Login / Landing
- App logo and tagline.
- `GoogleSigninButton` (wide, dark).
- On success: `supabase.auth.signInWithIdToken` → session stored → root layout evaluates onboarding state and redirects accordingly.
- No other navigation from this screen.

---

### `/profile-setup` — First-Login Profile Setup
- Shown once, immediately after the first Google Sign-In.
- Google profile photo shown at the top (read-only).
- **Privacy policy acceptance** — user must accept before continuing. Acceptance timestamp saved to `profiles.gdpr_accepted_at`. Link to privacy policy document (URL configured in `app_config`).
- **Required fields:**
  - Name / alias — pre-filled with Google display name, editable. Saved to `profiles.display_name`.
  - Phone number — stored as entered; E.164 format validation (`+40...`) added when SMS provider is integrated.
- **Optional:** add first car (make, model, plate) — user can skip and add cars later from Profile.
- **Continue** button — writes to `profiles` table with `onboarded = true`, optionally writes to `user_cars`, then navigates to `/(app)/`.
- Users cannot skip this screen; the back button is hidden.

---

### `/(app)/` — Home (Feed)
- **Search bar** at top — tapping navigates to the Search screen (does not search inline).
- **Category chips** (horizontal scroll): Washing, Self-Washing, … (list is extensible via Supabase config, not hardcoded). Tapping a chip navigates to the Search screen with that category pre-selected and results immediately loaded.
- **Feed sections** (vertical scroll):
  - *Book Again* — locations the user has previously booked (hidden if no history).
  - *Recently Viewed* — last few detail pages the user opened (stored locally via AsyncStorage).
  - *New to Shineo* — recently onboarded locations (`is_new = true`).
- Each feed card shows: photo, name, distance, star rating, price hint, **"Open now" / "Closed" badge** (derived from `locations.hours` + device time).
- Tapping a card navigates to `/(app)/[id]`.
- **Location permission denied state:** if GPS is unavailable, show a banner prompting the user to enable location. Feed sections still render but without distance info. Search is still accessible manually.

---

### `/(app)/search` — Search + Map
- **Search bar** at top — searches by location name.
- **Filter chips** below the search bar: by category (Washing, Self-Washing, Car Service, …) and by listing type (Bookable, Advertised). Filters are combinable.
- **Default state (no query typed):** shows all nearby locations within the configured default radius (default: **2 km**, configurable via `app_config`), ordered by distance. If arriving from a Home category chip, that category filter is pre-selected and results load immediately.
- **Location permission denied state:** map centers on a default city view; search and filters still work; distance is not shown in results.
- **Full-screen Google Map** behind, centered on user's current location. Pins update as filters/search change.
- Tapping a pin shows a mini card overlay: photo, name, distance, **"Open now" / "Closed" badge**, star rating.
- **Draggable bottom sheet** (`@gorhom/bottom-sheet`) over the map:
  - Pull up → more list visible, less map.
  - Pull down → more map visible, less list.
  - List items: photo thumbnail, name, distance, rating, price hint, "Open now" / "Closed" badge.
- Tapping a list item or mini card navigates to `/(app)/[id]`.

---

### `/(app)/[id]` — Location Detail
- Photo gallery (horizontal scroll).
- Name, address, star rating, review count.
- Opening hours with **"Open now" / "Closed" indicator** (derived from `locations.hours` + device time).
- **Get Directions** button — opens native maps app via deep link (both listing types).
- **If `listing_type = 'bookable'`:**
  - Services list (name, duration, price) pulled from `services` table.
  - **Book Now** button — navigates to `/(app)/booking/[id]`.
- **If `listing_type = 'advertised'`:**
  - Phone number with **Call** button.
  - No services list, no booking button.

---

### `/(app)/booking/[id]` — Booking
- Select service (pre-selected if coming from a specific service tap).
- Select date (calendar picker) — only dates that have available slots are selectable.
- Select available time slot — fetched from `location_slots` where `capacity` is not fully booked (slot capacity minus existing confirmed reservations for that slot).
- **No slots available state:** if a location has no available slots for any upcoming date, show a clear message ("No availability at this time. Check back later.") with a button to go back to the location detail.
- **Car selection (optional):** dropdown showing user's saved cars; default car pre-selected if one exists. User can proceed without selecting a car.
- Confirm button — writes to `reservations` table (with `slot_id`, optional `car_id`), stores Expo push token in `push_tokens`, schedules a local push notification reminder 24h before the appointment.
- Booking is atomic: slot availability is checked and reserved in a single Supabase transaction to prevent double-booking.
- **Slot taken race condition:** if the slot is no longer available at confirm time, show a clear error ("This slot was just taken — please pick another time.") and return the user to the slot picker.
- On success: navigate to a **Booking Confirmation screen** showing: location name, service, date, time, car (if selected), and a summary the user can screenshot. A "View in Activity" button navigates to the Activity screen. A local push notification reminder is also scheduled at this point.

---

### `/(app)/activity` — Activity
- Two sections: **Upcoming** and **Past**.
- Each card: location name, service, date/time, status badge.
- Tapping a card shows booking details (modal or stack screen).
- **Upcoming bookings:** show a **Cancel** button on the booking detail. Cancellation sets `reservations.status = 'cancelled'` and frees the slot. Cancellation policy (time cutoff) is TBD — will be configured per location via `locations.cancellation_policy` in the owner app phase. For this phase, cancellation is always allowed.
- Empty states for both sections.

---

### `/(app)/profile` — Profile
- Google profile photo (read-only, from auth).
- Editable fields: display name / alias, phone number.
- **My Cars section:** list of saved cars (make, model, plate). Add / edit / delete cars. One car can be marked as default (pre-selected at booking).
- **Preferences section:**
  - Language toggle: English / Romanian — saved to `profiles.language`, applied immediately app-wide via i18next.
  - Push notifications toggle — saved to `profiles.push_enabled`.
  - SMS notifications toggle — saved to `profiles.sms_enabled` (only shown if phone number is set).
- Save button — updates `profiles` table.
- **Delete Account** button — anonymises all reservations (nullifies `user_id`, clears personal fields), then hard-deletes `profiles`, `user_cars`, `push_tokens` rows and the `auth.users` record. Shows a confirmation dialog before proceeding.
- **Sign Out** button — clears session, redirects to `/sign-in`.

---

## Database Schema

```sql
-- Supabase managed: auth.users (created automatically)

profiles (
  id                    uuid primary key references auth.users,
  display_name          text,                    -- editable alias, pre-filled from Google display name
  phone                 text,
  onboarded             boolean default false,   -- true after profile-setup is completed
  language              text default 'en',       -- 'en' | 'ro' — overrides device locale
  push_enabled          boolean default true,    -- booking reminder push notifications
  sms_enabled           boolean default false,   -- booking reminder SMS notifications
  gdpr_accepted_at      timestamptz,             -- timestamp of privacy policy acceptance
  updated_at            timestamptz
)

user_cars (
  id          uuid primary key,
  user_id     uuid references auth.users,
  make        text not null,
  model       text not null,
  plate       text,
  is_default  boolean default false,  -- one car can be pre-selected at booking
  created_at  timestamptz
)

locations (
  id            uuid primary key,
  owner_id      uuid references auth.users,  -- future: business owner app uses this for RLS
  name          text not null,
  type          text not null,               -- 'car_wash' | 'self_washing' | 'car_service' | ...
  listing_type  text default 'advertised',   -- 'bookable' | 'advertised'
  address       text,
  coordinates   geography(Point, 4326) not null,  -- replaces lat/lng; enables PostGIS radius queries
  photos        text[],                      -- array of Supabase Storage paths (not full URLs)
  phone         text,                        -- contact number for advertised locations
  rating        float4,
  review_count  int,
  hours         jsonb,                       -- { mon: "08:00-18:00", ... } in location's local time
  timezone      text default 'Europe/Bucharest',  -- IANA timezone for correct "Open now" calculation (handles EET/EEST DST)
  is_new                boolean default false,  -- auto-cleared after `new_location_expiry_days` (app_config)
  cancellation_policy   jsonb,   -- TBD: configured by owner app (e.g. { cutoff_hours: 2 })
  created_at            timestamptz
)

-- Indexes
-- Fast trigram search on name:
CREATE INDEX locations_name_trgm_idx ON locations USING GIN (name gin_trgm_ops);
-- Fast radius + distance queries:
CREATE INDEX locations_coordinates_idx ON locations USING GIST (coordinates);

categories (
  id    uuid primary key,
  name  text not null,
  slug  text not null unique
)

location_categories (
  location_id  uuid references locations,
  category_id  uuid references categories,
  primary key (location_id, category_id)
)

services (
  id           uuid primary key,
  location_id  uuid references locations,
  name         text not null,
  duration_min int,
  price        numeric(10,2),
  currency     text default 'RON'
)

location_slots (
  id           uuid primary key,
  location_id  uuid references locations,
  start_time   timestamptz not null,
  end_time     timestamptz not null,
  capacity     int default 1,           -- how many bookings this slot allows
  created_at   timestamptz
)

reservations (
  id          uuid primary key,
  user_id     uuid references auth.users,
  location_id uuid references locations,
  service_id  uuid references services,
  slot_id     uuid references location_slots,  -- start/end time derived from slot
  car_id      uuid references user_cars,        -- optional: which car this booking is for
  status      text default 'confirmed',         -- confirmed | cancelled | completed
  created_at  timestamptz,
  unique (user_id, slot_id)                     -- prevents double-booking same slot; relax later if location allows multi-car per slot
)

reviews (
  id          uuid primary key,
  user_id     uuid references auth.users,
  location_id uuid references locations,
  rating      int not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz
)
-- Reviews are seeded with test data in this phase. Submission UI is out of scope.
-- locations.rating and review_count are updated via a Postgres trigger on reviews insert/delete.

push_tokens (
  id         uuid primary key,
  user_id    uuid references auth.users unique,
  token      text not null,             -- Expo push token
  updated_at timestamptz
)

app_config (
  key    text primary key,   -- e.g. 'default_search_radius_m'
  value  text not null,      -- e.g. '2000'
  note   text                -- human-readable description for the admin
)

-- Seed:
-- INSERT INTO app_config (key, value, note) VALUES
--   ('default_search_radius_m', '2000',  'Default nearby search radius in metres'),
--   ('privacy_policy_url',      'https://shineo.app/privacy', 'Privacy policy URL shown at first login'),
--   ('new_location_expiry_days','30',    'Days before is_new flag is cleared on locations'),
--   ('min_app_version',         '1.0.0', 'Minimum app version allowed; older versions are blocked on startup');
```

---

## Design System

**Inspiration:** Hoteliya Dribbble concept — clean, light, green-accented booking app.

### Colors
| Token | Value | Usage |
|---|---|---|
| `primary` | `#2DC653` | CTAs, selected states, active filters, calendar selection |
| `primary-dark` | `#1F9E3E` | Pressed state for primary buttons |
| `surface` | `#FFFFFF` | Cards, inputs, bottom sheet |
| `background` | `#F4F5F7` | Screen backgrounds |
| `text-primary` | `#1A1A1A` | Headings, important labels |
| `text-secondary` | `#6B7280` | Subtext, metadata |
| `border` | `#E5E7EB` | Card borders, dividers |
| `error` | `#EF4444` | Error states |
| `success` | `#2DC653` | Confirmation states (same as primary) |

Dark mode: toggled in Profile screen, persisted in `profiles`. Full dark palette defined at implementation time.

### Typography
| Role | Size | Weight |
|---|---|---|
| Screen title | 24sp | Bold |
| Section header | 18sp | SemiBold |
| Card title | 16sp | SemiBold |
| Body | 14sp | Regular |
| Caption / metadata | 12sp | Regular |

Font: **Inter** (system-available on both iOS and Android via Expo Google Fonts).

### Shape & Spacing
- Card border-radius: **16px**
- Button border-radius: **12px**
- Input border-radius: **12px**
- Chip border-radius: **999px** (pill)
- Base spacing unit: **8px** (spacing scale: 4, 8, 12, 16, 24, 32)

### Key Components
- **Search bar:** pill-shaped, search icon left, filter icon right, light shadow
- **Category chips:** pill, icon + label; selected = green border + light green background
- **Feed card:** rounded image top, white card body (name, distance, rating, price hint, open/closed badge)
- **CTA button:** full-width, green, rounded, sticky at bottom of detail/booking screens
- **Bottom tab bar:** custom liquid/fluid tab bar — active tab has a green bubble that morphs fluidly between tabs using an SVG curved path animated with Reanimated. Active icon = white inside the bubble, inactive = grey. Implemented as a custom Expo Router tab bar component.
- **Calendar:** clean grid, selected = green filled circle, unavailable dates = greyed out
- **Filter sheet:** bottom sheet with chip selectors, Clear All + Search buttons

---

## Internationalisation (i18n)

- **Supported languages:** English (`en`) and Romanian (`ro`).
- **Detection:** On startup, if the user has a saved `profiles.language` preference it takes priority; otherwise `expo-localization` reads the device locale (Romanian → `ro`, everything else → `en`).
- **Library:** `i18next` + `react-i18next`. Translation strings live in `locales/en.json` and `locales/ro.json`.
- **Scope:** All static UI strings (labels, buttons, error messages, empty states, notification copy) are translated. Location names, addresses, and service names entered by business owners are stored as-is (single language, owner's choice).
- **Adding languages later:** add a new `locales/{lang}.json` file and register the language in the i18next config — no structural changes needed.

```
locales/
  en.json
  ro.json
```

---

## Search & Geo Strategy

**Extensions required:** `pg_trgm` (trigram search) and `postgis` (geo queries) — both available in Supabase, enabled via the dashboard.

**Search query pattern:**
```sql
SELECT *, ST_Distance(coordinates, ST_Point($lng, $lat)::geography) AS distance_m
FROM locations
WHERE
  name % $query                                          -- trigram similarity match
  AND ST_DWithin(coordinates, ST_Point($lng, $lat)::geography, $radius_m)  -- within radius
  AND ($category IS NULL OR id IN (
    SELECT location_id FROM location_categories lc
    JOIN categories c ON c.id = lc.category_id
    WHERE c.slug = $category
  ))
  AND ($listing_type IS NULL OR listing_type = $listing_type)
ORDER BY distance_m ASC
```

- Trigram threshold (`pg_trgm.similarity_threshold`) set to `0.2` to allow partial/fuzzy matches.
- Default search radius: read from `app_config` (`default_search_radius_m`), defaults to **2 000 m** (2 km). Fetched once at app startup and cached.
- Results ordered by distance ascending (closest first).
- All filtering (category, listing type) happens server-side in the same query — no client-side filtering.
- Exposed as a Supabase RPC function (`search_locations`) callable from the app with typed params.

---

## Images

- Photos are uploaded by business owners and stored in **Supabase Storage** under a `locations/{id}/` path.
- `locations.photos[]` stores Storage paths, not full URLs.
- At render time, URLs are constructed with the Supabase transformation API:
  - Feed cards & map mini cards: `?width=400&height=300&quality=80&resize=cover`
  - Detail gallery (full): `?width=1200&quality=90`
- All images rendered via **`expo-image`** which provides disk caching and fast decode, avoiding re-fetching on scroll.

---

## Notifications

**Push notifications:**
- Library: Expo Notifications.
- On booking confirmation: schedule a local push notification 24h before the slot start time.
- Only sent if `profiles.push_enabled = true`.
- Notification copy (translated per `profiles.language`): *"Reminder: your [service] at [location name] is tomorrow at [time]."*
- Tapping the notification opens the Activity screen.

**SMS notifications:**
- Triggered by a Supabase Edge Function on booking confirmation.
- Only sent if `profiles.sms_enabled = true` and `profiles.phone` is set.
- SMS provider is TBD — Edge Function calls provider HTTP API (Twilio, Vonage, or AWS SNS). Swapping provider requires only an env var + one-line URL change in the Edge Function.
- SMS copy (translated per `profiles.language`): same content as push notification.
- No promotional or server-push notifications in this phase.

---

## Permissions Required

| Permission | When requested |
|---|---|
| Location (foreground) | On first open of Home or Search |
| Push notifications | On first successful booking |

---

## Row Level Security (RLS)

All Supabase tables have RLS enabled. Policies:

| Table | Read | Write |
|---|---|---|
| `locations` | Public (anyone) | Service role only (business owner app) |
| `services` | Public (anyone) | Service role only |
| `categories` | Public (anyone) | Service role only |
| `location_categories` | Public (anyone) | Service role only |
| `profiles` | Own row only (`id = auth.uid()`) | Own row only |
| `reservations` | Own rows only (`user_id = auth.uid()`) | Own rows only |
| `location_slots` | Public (anyone) | Service role only (owner app will manage slots) |
| `push_tokens` | Own row only | Own row only |
| `user_cars` | Own rows only (`user_id = auth.uid()`) | Own rows only |
| `reviews` | Public (anyone) | Own rows only (submission UI out of scope this phase — seeded via dashboard) |
| `app_config` | Public read (anyone) | Service role only (Shineo admin via Supabase dashboard) |

This ensures a user can only read and write their own bookings and profile — enforced at the database level, not just the app.

---

## GDPR & Data Privacy

- **Privacy policy acceptance** required at first login (profile-setup screen). Timestamp stored in `profiles.gdpr_accepted_at`. Privacy policy URL stored in `app_config` (`privacy_policy_url`).
- **Account deletion** (Right to Erasure):
  1. All `reservations` rows for the user have `user_id` set to `NULL` and `car_id` set to `NULL` (anonymised, kept for business records).
  2. `profiles`, `user_cars`, `push_tokens` rows are hard-deleted.
  3. `auth.users` record is deleted via Supabase Admin API (Edge Function with service role).
  4. Executed in a single Edge Function to ensure atomicity.
- **Data collected:** Google display name (read-only from auth), phone number, car make/model/plate, GPS location (not stored — used only at query time), booking history.

---

## Offline State

- All screens detect network unavailability via `@react-native-community/netinfo`.
- When offline: show a non-blocking banner ("No internet connection") at the top of the screen.
- Cached data (recently viewed, app_config) remains visible.
- Actions that require network (search, booking, cancellation) are disabled with a tooltip explaining why.
- On reconnect: banner dismisses automatically, actions re-enable.

**Force update:** on startup the app fetches `app_config.min_app_version` and compares it to the current build version (`expo-constants`). If the installed version is below the minimum, a blocking screen is shown with a link to the app store. No app functionality is accessible until updated.

---

## Extensibility Notes

- **New categories** (e.g. Car Services, Tyre Shops): add a row to the `categories` table — no code change needed. The Home screen category chips and Search filters are driven by this table.
- **New service types per location**: add rows to `services` — the booking flow is service-agnostic.
- **Different business types** (e.g. a mechanic vs a car wash): `locations.type` already distinguishes them. If a type needs a different booking flow or data, branch on `type` in the UI — no schema migration needed.
- **Listing type upgrades**: an advertised location can be upgraded to bookable by the owner app setting `listing_type = 'bookable'` and adding slots/services — the customer app UI adapts automatically via the `listing_type` check on the detail screen.
- **Ranking / Recommended**: not implemented in this phase. The owner app will include a paid ranking/promotion feature that surfaces locations higher in search results and feeds.
- **Location approval**: when the owner app is built, add `status text default 'active'` to `locations` (`pending | active | suspended`) and filter the customer app to `status = 'active'` only. No customer-app code change needed beyond adding the filter.
- **Owner cancels a reservation**: `push_tokens` is already in place — the owner app triggers a push to the customer's token via a Supabase Edge Function when status changes to `cancelled`.

---

## Out of Scope (this phase)

- Business owner app.
- Recommended / ranked feed section (paid promotion feature, owner app phase).
- Reviews / ratings submission by users.
- In-app payments.
- Real-time status updates ("your car is ready").
- Promotional notifications.
- Web version.

## Scheduled Jobs (pg_cron)

**Clear `is_new` flag daily:**
```sql
-- Runs every day at 02:00 UTC
SELECT cron.schedule('clear-is-new', '0 2 * * *', $$
  UPDATE locations SET is_new = false
  WHERE is_new = true
  AND created_at < now() - (
    SELECT value::int FROM app_config WHERE key = 'new_location_expiry_days'
  ) * interval '1 day';
$$);
```

`pg_cron` is available in Supabase and enabled via the dashboard.

---

## Notes on Slot Seeding (this phase)

`location_slots` for bookable locations will be seeded manually via the Supabase dashboard during development and testing. The owner app will provide a UI for managing slots in a future phase.
