-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_cron;

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
  location_id uuid REFERENCES locations ON DELETE SET NULL,
  service_id  uuid REFERENCES services ON DELETE SET NULL,
  slot_id     uuid REFERENCES location_slots ON DELETE SET NULL,
  car_id      uuid REFERENCES user_cars ON DELETE SET NULL,
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
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, location_id)
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
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE locations SET
    rating       = (SELECT AVG(rating)::float4 FROM reviews WHERE location_id = COALESCE(NEW.location_id, OLD.location_id)),
    review_count = (SELECT COUNT(*)::int      FROM reviews WHERE location_id = COALESCE(NEW.location_id, OLD.location_id))
  WHERE id = COALESCE(NEW.location_id, OLD.location_id);
  RETURN COALESCE(NEW, OLD);
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

-- search_locations RPC
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

-- RLS Policies
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

-- Location owners can manage their own slots (needed by owner app + booking flow)
CREATE POLICY "owner manage slots" ON location_slots
FOR ALL USING (
  location_id IN (SELECT id FROM locations WHERE owner_id = auth.uid())
);
