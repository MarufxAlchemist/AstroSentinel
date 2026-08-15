-- Scientific integrity Phase 2: make SOURCE measurements nullable and retire
-- the 0.0 placeholders that were written in their place.
--
-- ROOT CAUSE
-- ──────────
-- backend/scripts/import_archive_to_postgres.py:44,180 contains:
--
--     NULL_FLOAT = 0.0
--     # Placeholder floats for NOT NULL numeric columns
--     "ra": NULL_FLOAT, "dec": NULL_FLOAT, "snr": NULL_FLOAT, ...
--
-- The importer never attempted to extract these values. It wrote zeros
-- *because the columns were NOT NULL* — the comment says so outright. The
-- constraint is what caused the fabrication, exactly as with the derived
-- sky-geometry columns in migration 0010.
--
-- 279 of 304 rows carry ra=0, dec=0, snr=0, far=0, error_radius=0
-- simultaneously. (0,0) is a *valid* celestial coordinate, so nothing
-- downstream ever flagged it: the sky map plots those events at the origin
-- and the correlation engine sees 279 events as perfectly coincident, which
-- can manufacture spurious multi-messenger "associations".
--
-- WHAT THIS MIGRATION DOES NOT DO
-- ───────────────────────────────
-- It deletes no rows. Position-less events remain in the archive; they simply
-- stop claiming measurements they never had.

-- ── 1. Allow UNKNOWN to be represented ──────────────────────────────────────
ALTER TABLE core.events ALTER COLUMN ra           DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN dec          DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN error_radius DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN snr          DROP NOT NULL;
ALTER TABLE core.events ALTER COLUMN far          DROP NOT NULL;

COMMENT ON COLUMN core.events.ra IS
  'OBSERVED Right Ascension (deg, ICRS). NULL = position not reported by source.';
COMMENT ON COLUMN core.events.dec IS
  'OBSERVED Declination (deg, ICRS). NULL = position not reported by source.';
COMMENT ON COLUMN core.events.error_radius IS
  'OBSERVED localization uncertainty (arcmin). NULL = not reported. Semantics (1-sigma vs 90%) are source-defined.';
COMMENT ON COLUMN core.events.snr IS
  'OBSERVED signal-to-noise ratio. NULL = not reported. Note: for IceCube this column has historically been populated with *signalness* (a 0-1 probability), which is NOT an SNR.';
COMMENT ON COLUMN core.events.far IS
  'OBSERVED false alarm rate (Hz). NULL = not reported. Zero is unphysical and is never stored.';

-- ── 2. Retire the placeholders, field by field ──────────────────────────────
-- Deliberately NOT a blanket "row is empty" rule: some CHIME FRB rows carry a
-- genuine position and SNR but a fabricated FAR and error_radius, so each
-- field is judged on whether zero is physically meaningful for that quantity.

-- Position: RA=0 alone can be real, but RA=0 AND Dec=0 together is the
-- "null island" sentinel. Treated as UNKNOWN only when both are exactly zero.
UPDATE core.events
   SET ra = NULL, dec = NULL
 WHERE ra = 0 AND dec = 0;

-- SNR <= 0 is physically invalid for a detection significance.
UPDATE core.events SET snr = NULL WHERE snr <= 0;

-- A false alarm rate of exactly 0 Hz would mean "never a false alarm".
-- It is also what produced the "1 per Infinity years" text in the UI,
-- which was a 1/0 artifact rendered as if it were a scientific statement.
UPDATE core.events SET far = NULL WHERE far <= 0;

-- A localization uncertainty of exactly 0 would be a perfectly known position.
UPDATE core.events SET error_radius = NULL WHERE error_radius <= 0;

-- ── 3. Decontaminate DERIVED geometry built on fabricated positions ─────────
-- Migration 0010 recomputed gal_lon/gal_lat/sun_distance/moon_distance for
-- every row. For rows whose position was the (0,0) placeholder the arithmetic
-- was correct but the input was fabricated, so the results are meaningless.
-- Derived-from-unknown must itself be UNKNOWN.
UPDATE core.events
   SET gal_lon = NULL, gal_lat = NULL, sun_distance = NULL, moon_distance = NULL
 WHERE ra IS NULL OR dec IS NULL;
