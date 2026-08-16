-- 0014_derived_science.sql
-- Phase 5: uncertainty semantics, credible regions and derived science.
-- Spec sections 21-24, 33-34.
--
-- Three things this migration makes representable that previously were not:
--
--   1. WHAT A LOCALIZATION RADIUS MEANS. `error_radius` was stored as a bare
--      number. A 1-sigma radius and a 90% containment radius differ by a
--      factor of 2.15 for a 2-D Gaussian, so every cross-instrument comparison
--      and every drawn error circle was comparing incomparable quantities.
--      NULL is the honest default: the source did not say.
--
--   2. CREDIBLE AREAS AS THEIR OWN QUANTITY. The GW parser previously fell
--      back to `area_90` (a 90% credible AREA in deg^2) when no error radius
--      was present, writing it into `error_radius` (an ANGLE in arcmin). A
--      100 deg^2 skymap was recorded as a 1.67 deg radius; the equivalent
--      radius is 5.6 deg. Areas now have their own columns.
--
--   3. DERIVED QUANTITIES WITH THEIR ASSUMPTIONS. Rest-frame T90/Epeak,
--      luminosity distance, band-limited E_iso, credible-region geometry and
--      observability, each carrying its method, inputs, propagated
--      uncertainty and the cosmology it assumed.
--
-- Idempotent: safe to re-run.

-- ── Localization semantics ──────────────────────────────────────────────────

ALTER TABLE core.events
  ADD COLUMN IF NOT EXISTS error_radius_containment text,
  ADD COLUMN IF NOT EXISTS area_50_deg2             double precision,
  ADD COLUMN IF NOT EXISTS area_90_deg2             double precision,
  ADD COLUMN IF NOT EXISTS luminosity_distance_error double precision,
  ADD COLUMN IF NOT EXISTS redshift_error           double precision,
  ADD COLUMN IF NOT EXISTS derived                  jsonb;

COMMENT ON COLUMN core.events.error_radius_containment IS
  'What error_radius contains: 1SIGMA_1D | 1SIGMA_2D | 50_2D | 68_2D | 90_2D | 95_2D. '
  'NULL = the source did not state it, and it is NOT assumed.';
COMMENT ON COLUMN core.events.area_50_deg2 IS
  '50% credible sky area in square degrees. An area, not a radius.';
COMMENT ON COLUMN core.events.area_90_deg2 IS
  '90% credible sky area in square degrees. An area, not a radius.';
COMMENT ON COLUMN core.events.luminosity_distance_error IS
  '1-sigma uncertainty on luminosity_distance [Mpc]. GW distance posteriors '
  'are broad; the point estimate alone is not usable for prioritisation.';
COMMENT ON COLUMN core.events.redshift_error IS
  '1-sigma uncertainty on redshift, propagated into every rest-frame quantity.';
COMMENT ON COLUMN core.events.derived IS
  'Derived scientific quantities, each with method, inputs, assumptions, '
  'propagated uncertainty and provenance. An underivable quantity is stored '
  'as UNKNOWN with the reason, never omitted and never guessed.';

-- ── Constraints ─────────────────────────────────────────────────────────────
-- Written so an invalid value fails loudly at write time rather than being
-- discovered later in a plot.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_containment_convention') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_containment_convention
      CHECK (error_radius_containment IS NULL OR error_radius_containment IN
             ('1SIGMA_1D', '1SIGMA_2D', '50_2D', '68_2D', '90_2D', '95_2D'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_area_50_positive') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_area_50_positive
      CHECK (area_50_deg2 IS NULL OR (area_50_deg2 > 0 AND area_50_deg2 <= 41253));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_area_90_positive') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_area_90_positive
      CHECK (area_90_deg2 IS NULL OR (area_90_deg2 > 0 AND area_90_deg2 <= 41253));
  END IF;

  -- A smaller credible level cannot enclose more sky.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_credible_areas_ordered') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_credible_areas_ordered
      CHECK (area_50_deg2 IS NULL OR area_90_deg2 IS NULL
             OR area_50_deg2 <= area_90_deg2);
  END IF;

  -- An uncertainty is a non-negative width, and cannot exist without a value.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_distance_error_valid') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_distance_error_valid
      CHECK (luminosity_distance_error IS NULL
             OR (luminosity_distance_error >= 0 AND luminosity_distance IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_redshift_error_valid') THEN
    ALTER TABLE core.events ADD CONSTRAINT chk_redshift_error_valid
      CHECK (redshift_error IS NULL
             OR (redshift_error >= 0 AND redshift IS NOT NULL));
  END IF;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Partial: the columns are sparse by design, so only populated rows are worth
-- indexing.

CREATE INDEX IF NOT EXISTS idx_events_area_90
  ON core.events (area_90_deg2)
  WHERE area_90_deg2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_containment
  ON core.events (error_radius_containment)
  WHERE error_radius_containment IS NOT NULL;
