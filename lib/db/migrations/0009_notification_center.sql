ALTER TABLE "alerts"."alert_subscriptions" ADD COLUMN "priority_level" text DEFAULT 'all' NOT NULL;
ALTER TABLE "alerts"."alert_subscriptions" ADD COLUMN "behaviour" jsonb DEFAULT '{"aiSummary":true,"correlation":true,"localization":true,"digest":false,"instant":true}'::jsonb NOT NULL;
