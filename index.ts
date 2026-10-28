import { createClient } from '@supabase/supabase-js';
import { tokenUsageDashboardHtml } from './dashboard';
import { faviconAssets } from './assets';
import { logError } from './logger';

export interface Env {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    INGEST_SECRET_TOKEN: string;
    DASHBOARD_USERNAME: string;
    DASHBOARD_PASSWORD: string;
}

const ALLOWED_BUCKETS = ['hour', 'day', 'week'] as const;
type Bucket = (typeof ALLOWED_BUCKETS)[number];

export function isDashboardAuthorized(request: Request, env: Env): boolean {
    const header = request.headers.get('Authorization');
    if (!header || !header.startsWith('Basic ')) return false;

    let decoded: string;
    try {
        decoded = atob(header.slice('Basic '.length));
    } catch {
        return false;
    }

    const sep = decoded.indexOf(':');
    if (sep === -1) return false;

    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    return user === env.DASHBOARD_USERNAME && pass === env.DASHBOARD_PASSWORD;
}

export function unauthorizedResponse(): Response {
    return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="token-usage-dashboard"' },
    });
}

export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

export function parseProjectsParam(url: URL): string[] | null {
    const raw = url.searchParams.get('projects');
    if (!raw) return null;
    const projects = raw.split(',').map((p) => p.trim()).filter(Boolean);
    return projects.length > 0 ? projects : null;
}

export function parseBucketParam(url: URL): Bucket {
    const raw = url.searchParams.get('bucket');
    return (ALLOWED_BUCKETS as readonly string[]).includes(raw ?? '') ? (raw as Bucket) : 'day';
}

export function findAttr(attrs: any[] | undefined, key: string): string | undefined {
    return attrs?.find((a) => a.key === key)?.value?.stringValue;
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function handleFaviconAsset(pathname: string): Response | null {
    const asset = faviconAssets[pathname];
    if (!asset) return null;
    return new Response(base64ToBytes(asset.base64).buffer as ArrayBuffer, {
        headers: {
            'content-type': asset.contentType,
            'cache-control': 'public, max-age=86400',
        },
    });
}

export async function handleIngest(request: Request, env: Env, url: URL): Promise<Response> {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${env.INGEST_SECRET_TOKEN}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        const payload: any = await request.json();

        if (url.pathname === '/v1/logs') {
            return jsonResponse({ message: 'Logs acknowledged' });
        }

        const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false },
        });

        const recordsToInsert = [];
        const resourceMetrics = payload.resourceMetrics || [];

        for (const resMetric of resourceMetrics) {
            const resAttrs = resMetric.resource?.attributes || [];

            for (const scopeMetric of resMetric.scopeMetrics || []) {
                for (const metric of scopeMetric.metrics || []) {
                    const dps = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];
                    for (const dp of dps) {
                        const val = Number(dp.asDouble ?? dp.asInt ?? 0);
                        // vcs.repository.name is a data-point-level attribute (like session.id),
                        // not a resource attribute — unlike project.name/service.name below.
                        const projectName =
                            findAttr(dp.attributes, 'vcs.repository.name') ??
                            findAttr(resAttrs, 'project.name') ??
                            findAttr(resAttrs, 'service.name') ??
                            'default-project';
                        // host.name/user.email aren't reliably confirmed on one location yet
                        // (see specs/machine-and-user-attribution.md) — check both the
                        // data point and the resource block until that's verified against a
                        // real payload.
                        const record = {
                            project_name: projectName,
                            session_id: findAttr(dp.attributes, 'session.id') || 'active_session',
                            model: 'claude-3-5-sonnet',
                            input_tokens: 0,
                            output_tokens: 0,
                            cache_read_tokens: 0,
                            cache_write_tokens: 0,
                            total_cost_usd: 0,
                            host_name: findAttr(dp.attributes, 'host.name') ?? findAttr(resAttrs, 'host.name') ?? null,
                            user_email: findAttr(dp.attributes, 'user.email') ?? findAttr(resAttrs, 'user.email') ?? null,
                        };

                        if (metric.name === 'claude_code.token.usage') {
                            const type = findAttr(dp.attributes, 'type');
                            if (type === 'input') record.input_tokens = val;
                            else if (type === 'output') record.output_tokens = val;
                            else if (type === 'cacheRead') record.cache_read_tokens = val;
                            else if (type === 'cacheCreation') record.cache_write_tokens = val;
                            else continue;
                        } else if (metric.name === 'claude_code.cost.usage') {
                            record.total_cost_usd = val;
                        } else {
                            continue;
                        }

                        recordsToInsert.push(record);
                    }
                }
            }
        }

        if (recordsToInsert.length > 0) {
            const { error: insertError } = await supabase.from('token_usage_logs').insert(recordsToInsert);
            if (insertError) {
                logError('handleIngest.insert', insertError);
                return jsonResponse({ error: insertError.message }, 500);
            }
        }

        return jsonResponse({ success: true, count: recordsToInsert.length });
    } catch (err: any) {
        logError('handleIngest', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

export async function handleTokenUsageApi(request: Request, env: Env, url: URL): Promise<Response> {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    const projects = parseProjectsParam(url);
    const start = url.searchParams.get('start') ?? undefined;
    const end = url.searchParams.get('end') ?? undefined;

    if (url.pathname === '/api/token-usage/projects') {
        const { data, error } = await supabase.rpc('get_token_usage_projects');
        if (error) {
            logError('handleTokenUsageApi.projects', error);
            return jsonResponse({ error: error.message }, 500);
        }
        return jsonResponse({ projects: (data ?? []).map((row: any) => row.project_name) });
    }

    if (url.pathname === '/api/token-usage/series') {
        const { data, error } = await supabase.rpc('get_token_usage_series', {
            p_projects: projects,
            p_start: start,
            p_end: end,
            p_bucket: parseBucketParam(url),
        });
        if (error) {
            logError('handleTokenUsageApi.series', error);
            return jsonResponse({ error: error.message }, 500);
        }
        return jsonResponse({ series: data ?? [] });
    }

    if (url.pathname === '/api/token-usage/table') {
        const { data, error } = await supabase.rpc('get_token_usage_table', {
            p_projects: projects,
            p_start: start,
            p_end: end,
        });
        if (error) {
            logError('handleTokenUsageApi.table', error);
            return jsonResponse({ error: error.message }, 500);
        }
        return jsonResponse({ rows: data ?? [] });
    }

    return jsonResponse({ error: 'Not Found' }, 404);
}

export async function handleCostApi(request: Request, env: Env, url: URL): Promise<Response> {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    const projects = parseProjectsParam(url);
    const start = url.searchParams.get('start') ?? undefined;
    const end = url.searchParams.get('end') ?? undefined;

    if (url.pathname === '/api/cost/table') {
        const { data, error } = await supabase.rpc('get_cost_table', {
            p_projects: projects,
            p_start: start,
            p_end: end,
        });
        if (error) {
            logError('handleCostApi.table', error);
            return jsonResponse({ error: error.message }, 500);
        }
        return jsonResponse({ rows: data ?? [] });
    }

    if (url.pathname === '/api/cost/series') {
        const { data, error } = await supabase.rpc('get_cost_series', {
            p_projects: projects,
            p_start: start,
            p_end: end,
            p_bucket: parseBucketParam(url),
        });
        if (error) {
            logError('handleCostApi.series', error);
            return jsonResponse({ error: error.message }, 500);
        }
        return jsonResponse({ series: data ?? [] });
    }

    return jsonResponse({ error: 'Not Found' }, 404);
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/v1/metrics' || url.pathname === '/v1/logs') {
            return handleIngest(request, env, url);
        }

        const faviconResponse = handleFaviconAsset(url.pathname);
        if (faviconResponse) return faviconResponse;

        if (url.pathname === '/dashboard/token-usage') {
            if (request.method !== 'GET') {
                return jsonResponse({ error: 'Method Not Allowed' }, 405);
            }
            if (!isDashboardAuthorized(request, env)) {
                return unauthorizedResponse();
            }
            return new Response(tokenUsageDashboardHtml, {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        }

        if (url.pathname.startsWith('/api/token-usage/')) {
            if (request.method !== 'GET') {
                return jsonResponse({ error: 'Method Not Allowed' }, 405);
            }
            if (!isDashboardAuthorized(request, env)) {
                return unauthorizedResponse();
            }
            return handleTokenUsageApi(request, env, url);
        }

        if (url.pathname.startsWith('/api/cost/')) {
            if (request.method !== 'GET') {
                return jsonResponse({ error: 'Method Not Allowed' }, 405);
            }
            if (!isDashboardAuthorized(request, env)) {
                return unauthorizedResponse();
            }
            return handleCostApi(request, env, url);
        }

        return jsonResponse({ error: 'Not Found' }, 404);
    },
};
