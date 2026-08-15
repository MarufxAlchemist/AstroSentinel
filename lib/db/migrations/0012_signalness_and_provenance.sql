-- Scientific integrity Phase 2 (part 2):
--   1. core.events.signalness      — stop conflating signalness with SNR
--   2. core.event_correlations     — table the schema declared but was never created
--   3. core.event_value_provenance — per-value audit trail for derived quantities

-- ── 1. IceCube signalness ───────────────────────────────────────────────────
-- backend/app/gcn/normalizer.py previously wrote IceCube "signalness" into the
-- snr column. Signalness is a probability in [0,1] that the event is
-- astrophysical; SNR is a detection significance in sigma. Different
-- quantities, different units, not comparable — storing one as the other made
-- any cross-messenger SNR comparison meaningless.

ALTER TABLE core.events ADD COLUMN IF NOT EXISTS signalness double precision;

COMMENT ON COLUMN core.events.signalness IS
  'OBSERVED IceCube signalness: probability in [0,1] that the event is astrophysical. NOT an SNR. NULL = not reported.';

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_signalness_probability;
ALTER TABLE core.events ADD CONSTRAINT chk_signalness_probability
  CHECK (signalness IS NULL OR (signalness >= 0.0 AND signalness <= 1.0));

-- Physical-range guards on the source measurements freed by migration 0011.
-- These make a fabricated placeholder fail loudly at write time instead of
-- silently entering the archive.
ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_ra_range;
ALTER TABLE core.events ADD CONSTRAINT chk_ra_range
  CHECK (ra IS NULL OR (ra >= 0.0 AND ra < 360.0));

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_dec_range;
ALTER TABLE core.events ADD CONSTRAINT chk_dec_range
  CHECK (dec IS NULL OR (dec >= -90.0 AND dec <= 90.0));

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_snr_positive;
ALTER TABLE core.events ADD CONSTRAINT chk_snr_positive
  CHECK (snr IS NULL OR snr > 0.0);

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_far_positive;
ALTER TABLE core.events ADD CONSTRAINT chk_far_positive
  CHECK (far IS NULL OR far > 0.0);

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_error_radius_positive;
ALTER TABLE core.events ADD CONSTRAINT chk_error_radius_positive
  CHECK (error_radius IS NULL OR error_radius > 0.0);

-- Derived sky geometry must be physically possible too.
ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_sun_distance_range;
ALTER TABLE core.events ADD CONSTRAINT chk_sun_distance_range
  CHECK (sun_distance IS NULL OR (sun_distance >= 0.0 AND sun_distance <= 180.0));

ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_moon_distance_range;
ALTER TABLE core.events ADD CONSTRAINT chk_moon_distance_range
  CHECK (moon_distance IS NULL OR (moon_distance >= 0.0 AND moon_distance <= 180.0));

-- A derived quantity may not exist where its inputs do not.
ALTER TABLE core.events DROP CONSTRAINT IF EXISTS chk_derived_requires_position;
ALTER TABLE core.events ADD CONSTRAINT chk_derived_requires_position
  CHECK (
    (ra IS NOT NULL AND dec IS NOT NULL)
    OR (gal_lon IS NULL AND gal_lat IS NULL
        AND sun_distance IS NULL AND moon_distance IS NULL)
  );

-- ── 2. core.event_correlations ──────────────────────────────────────────────
-- Declared in lib/db/src/schema/events.ts and written by
-- science/correlationEngine/repository.ts, but no migration ever created it.
-- saveCorrelation() swallows errors by design, so every persist silently
-- failed and the correlation audit trail was empty.

CREATE TABLE IF NOT EXISTS core.event_correlations (
  id                 bigserial PRIMARY KEY,
  primary_event_id   bigint      NOT NULL REFERENCES core.events(id) ON DELETE CASCADE,
  candidate_event_id bigint      NOT NULL REFERENCES core.events(id) ON DELETE CASCADE,
  confidence         text        NOT NULL DEFAULT 'NONE',
  score              integer     NOT NULL DEFAULT 0,
  delta_t_sec        double precision NOT NULL DEFAULT 0,
  angular_sep_deg    double precision NOT NULL DEFAULT 0,
  correlation_type   text        NOT NULL DEFAULT 'speculative',
  reasoning          text,
  computed_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_correlations_pair UNIQUE (primary_event_id, candidate_event_id),
  CONSTRAINT chk_correlation_angular_sep
    CHECK (angular_sep_deg >= 0.0 AND angular_sep_deg <= 180.0)
);

CREATE INDEX IF NOT EXISTS event_correlations_primary_idx
  ON core.event_correlations (primary_event_id);
CREATE INDEX IF NOT EXISTS event_correlations_confidence_idx
  ON core.event_correlations (confidence, computed_at DESC);

-- ── 3. core.event_value_provenance ──────────────────────────────────────────
-- Per-value audit trail. One row per (event, parameter) for any quantity that
-- was DERIVED, INFERRED, or taken from a CATALOG — i.e. anything not read
-- straight off the source notice.
--
-- Kept as a side table rather than widening core.events: provenance is
-- sparse, append-mostly, and only a handful of parameters per event carry it.

CREATE TABLE IF NOT EXISTS core.event_value_provenance (
  id             bigserial   PRIMARY KEY,
  event_id       bigint      NOT NULL REFERENCES core.events(id) ON DELETE CASCADE,

  -- Column on core.events this describes, e.g. 'sun_distance'.
  parameter      text        NOT NULL,

  -- OBSERVED | DERIVED | INFERRED | CATALOG | UNKNOWN
  source         text        NOT NULL,

  -- MEASURED | CALCULATED | MODEL_DEPENDENT | LIMITED | UNKNOWN
  confidence     text,

  -- VALID | SUSPICIOUS | INVALID | MISSING
  quality        text        NOT NULL DEFAULT 'VALID',

  unit           text,
  uncertainty    double precision,

  -- How it was produced, e.g. 'astropy GCRS separation via get_body'.
  method         text,
  -- Which source fields fed the calculation.
  input_fields   text[]      NOT NULL DEFAULT '{}',
  -- Library/version for reproducibility, e.g. 'astropy 6.1.4'.
  software       text,
  -- Model/cosmology assumptions. Empty for purely geometric results.
  assumptions    text[]      NOT NULL DEFAULT '{}',

  calculated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_value_provenance UNIQUE (event_id, parameter),
  CONSTRAINT chk_provenance_source
    CHECK (source IN ('OBSERVED','DERIVED','INFERRED','CATALOG','UNKNOWN')),
  CONSTRAINT chk_provenance_quality
    CHECK (quality IN ('VALID','SUSPICIOUS','INVALID','MISSING')),
  CONSTRAINT chk_provenance_confidence
    CHECK (confidence IS NULL OR confidence IN
      ('MEASURED','CALCULATED','MODEL_DEPENDENT','LIMITED','UNKNOWN'))
);

CREATE INDEX IF NOT EXISTS event_value_provenance_event_idx
  ON core.event_value_provenance (event_id);
CREATE INDEX IF NOT EXISTS event_value_provenance_param_idx
  ON core.event_value_provenance (parameter, source);

COMMENT ON TABLE core.event_value_provenance IS
  'Per-value scientific audit trail: how each non-source quantity was produced, from what inputs, under what assumptions.';
