-- 0008_ai_scientific_summaries.sql
-- Phase 5.6: Caching table for AI Scientific Summaries

CREATE TABLE IF NOT EXISTS "core"."ai_scientific_summaries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"metadata_hash" text NOT NULL,
	"model_name" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "core"."ai_scientific_summaries" ADD CONSTRAINT "ai_scientific_summaries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Index for quick lookup of cached summaries by event and hash
CREATE INDEX IF NOT EXISTS "ai_scientific_summaries_event_id_hash_idx" ON "core"."ai_scientific_summaries" USING btree ("event_id", "metadata_hash");
