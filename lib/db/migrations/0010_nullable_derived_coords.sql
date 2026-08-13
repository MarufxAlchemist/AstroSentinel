-- Scientific integrity: make DERIVED sky-geometry quantities nullable.
--
-- RATIONALE
-- ─────────
-- gal_lat, gal_lon, sun_distance and moon_distance are DERIVED quantities,
-- not source measurements. They are computed from (ra, dec, detection_time).
--
-- Declaring them NOT NULL made UNKNOWN structurally unrepresentable, which
-- forced the ingestion path to fabricate values whenever the calculation
-- could not be performed:
--
--   backend/app/gcn/normalizer.py::_sun_moon_distance()
--     → returned 90.0, 90.0 on missing timestamp / ephemeris failure
--
-- A fabricated 90.0 is indistinguishable from a genuine ~90° separation once
-- stored, so the archive silently mixed invented numbers with real ones.
--
-- Making these columns nullable lets the pipeline record UNKNOWN honestly.
-- NULL here means "could not be responsibly derived", never "zero" or
-- "typical value".
--
-- Source-measured columns (ra, dec, snr, ...) are deliberately NOT touched by
-- this migration — their nullability is a separate question.

ALTER TABLE core.events ALTER COLUMN gal_lat       DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN gal_lon       DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN sun_distance  DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN moon_distance DROP NOT NULL;

COMMENT ON COLUMN core.events.gal_lat IS
  'DERIVED (ICRS->Galactic, astropy). NULL = could not be derived.';
COMMENT ON COLUMN core.events.gal_lon IS
  'DERIVED (ICRS->Galactic, astropy). NULL = could not be derived.';
COMMENT ON COLUMN core.events.sun_distance IS
  'DERIVED angular separation from Sun in deg (astropy get_body). NULL = could not be derived.';
COMMENT ON COLUMN core.events.moon_distance IS
  'DERIVED angular separation from Moon in deg (astropy get_body). NULL = could not be derived.';
