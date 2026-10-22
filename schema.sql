CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.projects (
                                               id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS public.token_usage_logs (
                                                       id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT 'unknown_session',
    model TEXT NOT NULL DEFAULT 'unknown_model',
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS idx_token_usage_logs_project_name ON public.token_usage_logs(project_name);
CREATE INDEX IF NOT EXISTS idx_token_usage_logs_recorded_at ON public.token_usage_logs(recorded_at DESC);

CREATE OR REPLACE VIEW public.project_spend_summary AS
SELECT
    project_name,
    COALESCE(SUM(input_tokens), 0)::BIGINT AS total_input_tokens,
    COALESCE(SUM(output_tokens), 0)::BIGINT AS total_output_tokens,
    COALESCE(SUM(cache_read_tokens), 0)::BIGINT AS total_cache_read_tokens,
    COALESCE(SUM(cache_write_tokens), 0)::BIGINT AS total_cache_write_tokens,
    COALESCE(SUM(total_cost_usd), 0.000000)::NUMERIC(10, 6) AS total_cost_usd,
    COUNT(DISTINCT session_id)::BIGINT AS total_sessions,
    MAX(recorded_at) AS last_active_at
FROM public.token_usage_logs
GROUP BY project_name
ORDER BY last_active_at DESC;