-- Adds optional per-row attribution for which machine and which user a usage
-- event came from. Both are nullable and expected to be null most of the
-- time — see specs/machine-and-user-attribution.md for why: Claude Code has
-- no auto-detected machine-name attribute (host_name only shows up if the
-- user sets OTEL_RESOURCE_ATTRIBUTES=host.name=... themselves) and user_email
-- is only sent on authenticated sessions.

ALTER TABLE public.token_usage_logs
    ADD COLUMN IF NOT EXISTS host_name TEXT,
    ADD COLUMN IF NOT EXISTS user_email TEXT;
