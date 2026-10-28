import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, from, rpc, createClient } = vi.hoisted(() => {
    const insert = vi.fn();
    const from = vi.fn(() => ({ insert }));
    const rpc = vi.fn();
    const createClient = vi.fn(() => ({ from, rpc }));
    return { insert, from, rpc, createClient };
});

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import worker, {
    findAttr,
    handleCostApi,
    handleFaviconAsset,
    handleIngest,
    handleTokenUsageApi,
    isDashboardAuthorized,
    jsonResponse,
    parseBucketParam,
    parseCodexLogs,
    parseProjectsParam,
    unauthorizedResponse,
    type Env,
} from './index';

const testEnv: Env = {
    SUPABASE_URL: 'https://example.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    INGEST_SECRET_TOKEN: 'test-ingest-token',
    DASHBOARD_USERNAME: 'test-user',
    DASHBOARD_PASSWORD: 'test-pass',
};

function basicAuthHeader(user: string, pass: string): string {
    return 'Basic ' + btoa(`${user}:${pass}`);
}

beforeEach(() => {
    insert.mockReset().mockResolvedValue({ error: null });
    from.mockReset().mockReturnValue({ insert });
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
    createClient.mockClear();
});

describe('parseProjectsParam', () => {
    it('returns null when the param is missing', () => {
        expect(parseProjectsParam(new URL('https://x/?'))).toBeNull();
    });

    it('returns null when the param is empty', () => {
        expect(parseProjectsParam(new URL('https://x/?projects='))).toBeNull();
    });

    it('splits, trims, and drops empty entries', () => {
        expect(parseProjectsParam(new URL('https://x/?projects=a,%20b%20,,c'))).toEqual(['a', 'b', 'c']);
    });

    it('returns a single-element array for one project', () => {
        expect(parseProjectsParam(new URL('https://x/?projects=a'))).toEqual(['a']);
    });

    it('returns null when every entry is empty after trimming', () => {
        expect(parseProjectsParam(new URL('https://x/?projects=,%20,'))).toBeNull();
    });
});

describe('parseBucketParam', () => {
    it('defaults to day when missing', () => {
        expect(parseBucketParam(new URL('https://x/?'))).toBe('day');
    });

    it('accepts hour', () => {
        expect(parseBucketParam(new URL('https://x/?bucket=hour'))).toBe('hour');
    });

    it('accepts week', () => {
        expect(parseBucketParam(new URL('https://x/?bucket=week'))).toBe('week');
    });

    it('falls back to day for an invalid value', () => {
        expect(parseBucketParam(new URL('https://x/?bucket=month'))).toBe('day');
    });
});

describe('jsonResponse', () => {
    it('defaults to status 200 and application/json', async () => {
        const res = jsonResponse({ ok: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(await res.json()).toEqual({ ok: true });
    });

    it('honors a custom status', async () => {
        const res = jsonResponse({ error: 'nope' }, 404);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'nope' });
    });
});

describe('findAttr', () => {
    it('returns undefined when attrs is undefined', () => {
        expect(findAttr(undefined, 'type')).toBeUndefined();
    });

    it('returns undefined when the key is not present', () => {
        expect(findAttr([{ key: 'other', value: { stringValue: 'x' } }], 'type')).toBeUndefined();
    });

    it('returns the stringValue when the key matches', () => {
        expect(findAttr([{ key: 'type', value: { stringValue: 'input' } }], 'type')).toBe('input');
    });

    it('returns undefined when the matching attr has no stringValue', () => {
        expect(findAttr([{ key: 'type', value: {} }], 'type')).toBeUndefined();
    });
});

describe('isDashboardAuthorized', () => {
    function req(headers: Record<string, string> = {}) {
        return new Request('https://x/dashboard/token-usage', { headers });
    }

    it('accepts correct credentials', () => {
        const r = req({ Authorization: basicAuthHeader('test-user', 'test-pass') });
        expect(isDashboardAuthorized(r, testEnv)).toBe(true);
    });

    it('rejects a missing Authorization header', () => {
        expect(isDashboardAuthorized(req(), testEnv)).toBe(false);
    });

    it('rejects a non-Basic scheme', () => {
        const r = req({ Authorization: 'Bearer sometoken' });
        expect(isDashboardAuthorized(r, testEnv)).toBe(false);
    });

    it('rejects malformed base64', () => {
        const r = req({ Authorization: 'Basic %%%not-base64%%%' });
        expect(isDashboardAuthorized(r, testEnv)).toBe(false);
    });

    it('rejects a decoded value with no colon separator', () => {
        const r = req({ Authorization: 'Basic ' + btoa('no-colon-here') });
        expect(isDashboardAuthorized(r, testEnv)).toBe(false);
    });

    it('rejects wrong credentials', () => {
        const r = req({ Authorization: basicAuthHeader('test-user', 'wrong-pass') });
        expect(isDashboardAuthorized(r, testEnv)).toBe(false);
    });
});

describe('unauthorizedResponse', () => {
    it('returns 401 with a WWW-Authenticate header', () => {
        const res = unauthorizedResponse();
        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    });
});

describe('handleIngest', () => {
    const url = new URL('https://x/v1/metrics');
    const authHeaders = { Authorization: `Bearer ${testEnv.INGEST_SECRET_TOKEN}` };

    it('rejects non-POST methods', async () => {
        const req = new Request('https://x/v1/metrics', { method: 'GET' });
        const res = await handleIngest(req, testEnv, url);
        expect(res.status).toBe(405);
    });

    it('rejects a missing Authorization header', async () => {
        const req = new Request('https://x/v1/metrics', { method: 'POST', body: '{}' });
        const res = await handleIngest(req, testEnv, url);
        expect(res.status).toBe(401);
    });

    it('rejects an incorrect bearer token', async () => {
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: { Authorization: 'Bearer wrong-token' },
            body: '{}',
        });
        const res = await handleIngest(req, testEnv, url);
        expect(res.status).toBe(401);
    });

    it('returns 500 for a malformed JSON body', async () => {
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: 'not json',
        });
        const res = await handleIngest(req, testEnv, url);
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBeTruthy();
    });

    it('acknowledges /v1/logs without touching the database', async () => {
        const logsUrl = new URL('https://x/v1/logs');
        const req = new Request('https://x/v1/logs', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ resourceLogs: [] }),
        });
        const res = await handleIngest(req, testEnv, logsUrl);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: 'Logs acknowledged' });
        expect(insert).not.toHaveBeenCalled();
    });

    it('returns count 0 and skips insert for an empty payload', async () => {
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({}),
        });
        const res = await handleIngest(req, testEnv, url);
        expect(await res.json()).toEqual({ success: true, count: 0 });
        expect(insert).not.toHaveBeenCalled();
    });

    it('skips data points for metric names it does not recognize', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'some.other.metric',
                                    sum: { dataPoints: [{ asInt: '5' }] },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        const res = await handleIngest(req, testEnv, url);
        expect(await res.json()).toEqual({ success: true, count: 0 });
        expect(insert).not.toHaveBeenCalled();
    });

    it('skips token.usage data points with an unrecognized type attribute', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'claude_code.token.usage',
                                    sum: {
                                        dataPoints: [
                                            { asInt: '5', attributes: [{ key: 'type', value: { stringValue: 'unknown' } }] },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        const res = await handleIngest(req, testEnv, url);
        expect(await res.json()).toEqual({ success: true, count: 0 });
    });

    it('parses all four token types plus cost, resolving project name via the data-point-level vcs.repository.name attribute', async () => {
        const vcsAttr = { key: 'vcs.repository.name', value: { stringValue: 'repo-a' } };
        const payload = {
            resourceMetrics: [
                {
                    resource: {
                        attributes: [{ key: 'project.name', value: { stringValue: 'should-be-ignored' } }],
                    },
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'claude_code.token.usage',
                                    sum: {
                                        dataPoints: [
                                            {
                                                asInt: '10',
                                                attributes: [
                                                    vcsAttr,
                                                    { key: 'type', value: { stringValue: 'input' } },
                                                    { key: 'session.id', value: { stringValue: 'sess-1' } },
                                                ],
                                            },
                                            { asInt: '20', attributes: [vcsAttr, { key: 'type', value: { stringValue: 'output' } }] },
                                            { asInt: '30', attributes: [vcsAttr, { key: 'type', value: { stringValue: 'cacheRead' } }] },
                                            { asInt: '40', attributes: [vcsAttr, { key: 'type', value: { stringValue: 'cacheCreation' } }] },
                                        ],
                                    },
                                },
                                {
                                    name: 'claude_code.cost.usage',
                                    sum: { dataPoints: [{ asDouble: 1.23, attributes: [vcsAttr] }] },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        const res = await handleIngest(req, testEnv, url);
        expect(await res.json()).toEqual({ success: true, count: 5 });
        expect(insert).toHaveBeenCalledTimes(1);
        const records = insert.mock.calls[0][0];
        expect(records).toHaveLength(5);
        expect(records[0]).toEqual({
            source: 'claude',
            project_name: 'repo-a',
            session_id: 'sess-1',
            model: 'claude-3-5-sonnet',
            input_tokens: 10,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            total_cost_usd: 0,
            host_name: null,
            user_email: null,
        });
        expect(records[1]).toMatchObject({ output_tokens: 20, session_id: 'active_session' });
        expect(records[2]).toMatchObject({ cache_read_tokens: 30 });
        expect(records[3]).toMatchObject({ cache_write_tokens: 40 });
        expect(records[4]).toMatchObject({ total_cost_usd: 1.23 });
    });

    it('falls back to project.name when vcs.repository.name is absent', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [{ key: 'project.name', value: { stringValue: 'proj-b' } }] },
                    scopeMetrics: [
                        { metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 1 }] } }] },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0].project_name).toBe('proj-b');
    });

    it('falls back to service.name when neither vcs.repository.name nor project.name are present', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc-c' } }] },
                    scopeMetrics: [
                        { metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 1 }] } }] },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0].project_name).toBe('svc-c');
    });

    it('falls back to default-project when no identifying attribute is present', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        { metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 1 }] } }] },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0].project_name).toBe('default-project');
    });

    it('records host_name and user_email from resource attributes when present', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: {
                        attributes: [
                            { key: 'host.name', value: { stringValue: 'build-7' } },
                            { key: 'user.email', value: { stringValue: 'dev@example.com' } },
                        ],
                    },
                    scopeMetrics: [
                        { metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 1 }] } }] },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0]).toMatchObject({ host_name: 'build-7', user_email: 'dev@example.com' });
    });

    it('records host_name and user_email from data-point attributes when present there instead', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'claude_code.cost.usage',
                                    sum: {
                                        dataPoints: [
                                            {
                                                asDouble: 1,
                                                attributes: [
                                                    { key: 'host.name', value: { stringValue: 'laptop-2' } },
                                                    { key: 'user.email', value: { stringValue: 'other@example.com' } },
                                                ],
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0]).toMatchObject({ host_name: 'laptop-2', user_email: 'other@example.com' });
    });

    it('sets host_name and user_email to null when neither attribute is present anywhere', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        { metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 1 }] } }] },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0]).toMatchObject({ host_name: null, user_email: null });
    });

    it('reads gauge data points when sum is absent', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: 'claude_code.cost.usage',
                                    gauge: { dataPoints: [{ asDouble: 9.99 }] },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0].total_cost_usd).toBe(9.99);
    });

    it('tolerates missing resource/scopeMetrics/metrics/sum|gauge keys at every level without throwing', async () => {
        const payload = {
            resourceMetrics: [
                {}, // no `resource` at all -> falls back to default-project, no scopeMetrics -> no-op
                { resource: { attributes: [] } }, // no `scopeMetrics` key
                { resource: { attributes: [] }, scopeMetrics: [{}] }, // scopeMetric with no `metrics` key
                {
                    resource: { attributes: [] },
                    scopeMetrics: [{ metrics: [{ name: 'claude_code.cost.usage' }] }], // metric with neither sum nor gauge
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        const res = await handleIngest(req, testEnv, url);
        expect(await res.json()).toEqual({ success: true, count: 0 });
        expect(insert).not.toHaveBeenCalled();
    });

    it('defaults the value to 0 when a data point has neither asDouble nor asInt', async () => {
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [{ metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{}] } }] }],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        await handleIngest(req, testEnv, url);
        expect(insert.mock.calls[0][0][0].total_cost_usd).toBe(0);
    });

    it('returns 500 when the insert fails', async () => {
        insert.mockResolvedValue({ error: { message: 'db down' } });
        const payload = {
            resourceMetrics: [
                {
                    resource: { attributes: [] },
                    scopeMetrics: [
                        { metrics: [{ name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 1 }] } }] },
                    ],
                },
            ],
        };
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        const res = await handleIngest(req, testEnv, url);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'db down' });
    });
});

describe('handleTokenUsageApi', () => {
    const authHeaders = { Authorization: basicAuthHeader(testEnv.DASHBOARD_USERNAME, testEnv.DASHBOARD_PASSWORD) };

    it('returns the project list from the RPC', async () => {
        rpc.mockResolvedValue({ data: [{ project_name: 'a' }, { project_name: 'b' }], error: null });
        const url = new URL('https://x/api/token-usage/projects');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(await res.json()).toEqual({ projects: ['a', 'b'] });
    });

    it('returns 500 when the projects RPC errors', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        const url = new URL('https://x/api/token-usage/projects');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'boom' });
    });

    it('passes parsed filters through to the series RPC', async () => {
        rpc.mockResolvedValue({ data: [{ bucket: '2026-01-01' }], error: null });
        const url = new URL('https://x/api/token-usage/series?projects=a,b&start=2026-01-01&end=2026-01-02&bucket=hour');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(rpc).toHaveBeenCalledWith('get_token_usage_series', {
            p_projects: ['a', 'b'],
            p_start: '2026-01-01',
            p_end: '2026-01-02',
            p_bucket: 'hour',
        });
        expect(await res.json()).toEqual({ series: [{ bucket: '2026-01-01' }] });
    });

    it('defaults the series bucket to day and projects to null when omitted', async () => {
        const url = new URL('https://x/api/token-usage/series');
        const req = new Request(url, { headers: authHeaders });
        await handleTokenUsageApi(req, testEnv, url);
        expect(rpc).toHaveBeenCalledWith('get_token_usage_series', {
            p_projects: null,
            p_start: undefined,
            p_end: undefined,
            p_bucket: 'day',
        });
    });

    it('returns 500 when the series RPC errors', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'series boom' } });
        const url = new URL('https://x/api/token-usage/series');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(res.status).toBe(500);
    });

    it('returns table rows from the RPC', async () => {
        rpc.mockResolvedValue({ data: [{ project_name: 'a', total_tokens: 100 }], error: null });
        const url = new URL('https://x/api/token-usage/table');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(await res.json()).toEqual({ rows: [{ project_name: 'a', total_tokens: 100 }] });
    });

    it('returns 500 when the table RPC errors', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'table boom' } });
        const url = new URL('https://x/api/token-usage/table');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(res.status).toBe(500);
    });

    it('treats a null (but error-free) projects result as empty', async () => {
        rpc.mockResolvedValue({ data: null, error: null });
        const url = new URL('https://x/api/token-usage/projects');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(await res.json()).toEqual({ projects: [] });
    });

    it('treats a null (but error-free) series result as empty', async () => {
        rpc.mockResolvedValue({ data: null, error: null });
        const url = new URL('https://x/api/token-usage/series');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(await res.json()).toEqual({ series: [] });
    });

    it('treats a null (but error-free) table result as empty', async () => {
        rpc.mockResolvedValue({ data: null, error: null });
        const url = new URL('https://x/api/token-usage/table');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(await res.json()).toEqual({ rows: [] });
    });

    it('returns 404 for an unknown token-usage subpath', async () => {
        const url = new URL('https://x/api/token-usage/nope');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleTokenUsageApi(req, testEnv, url);
        expect(res.status).toBe(404);
    });
});

describe('handleCostApi', () => {
    const authHeaders = { Authorization: basicAuthHeader(testEnv.DASHBOARD_USERNAME, testEnv.DASHBOARD_PASSWORD) };

    it('returns table rows from the cost RPC', async () => {
        rpc.mockResolvedValue({ data: [{ project_name: 'a', total_cost_usd: 1.5 }], error: null });
        const url = new URL('https://x/api/cost/table');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(await res.json()).toEqual({ rows: [{ project_name: 'a', total_cost_usd: 1.5 }] });
    });

    it('returns 500 when the cost table RPC errors', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        const url = new URL('https://x/api/cost/table');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'boom' });
    });

    it('treats a null (but error-free) cost table result as empty', async () => {
        rpc.mockResolvedValue({ data: null, error: null });
        const url = new URL('https://x/api/cost/table');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(await res.json()).toEqual({ rows: [] });
    });

    it('passes parsed filters through to the cost series RPC', async () => {
        rpc.mockResolvedValue({ data: [{ project_name: 'a', bucket: '2026-01-01', cost_usd: 1 }], error: null });
        const url = new URL('https://x/api/cost/series?projects=a,b&start=2026-01-01&end=2026-01-02&bucket=hour');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(rpc).toHaveBeenCalledWith('get_cost_series', {
            p_projects: ['a', 'b'],
            p_start: '2026-01-01',
            p_end: '2026-01-02',
            p_bucket: 'hour',
        });
        expect(await res.json()).toEqual({ series: [{ project_name: 'a', bucket: '2026-01-01', cost_usd: 1 }] });
    });

    it('defaults the cost series bucket to day and projects/start/end to null/undefined when omitted', async () => {
        const url = new URL('https://x/api/cost/series');
        const req = new Request(url, { headers: authHeaders });
        await handleCostApi(req, testEnv, url);
        expect(rpc).toHaveBeenCalledWith('get_cost_series', {
            p_projects: null,
            p_start: undefined,
            p_end: undefined,
            p_bucket: 'day',
        });
    });

    it('returns 500 when the cost series RPC errors', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'series boom' } });
        const url = new URL('https://x/api/cost/series');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(res.status).toBe(500);
    });

    it('treats a null (but error-free) cost series result as empty', async () => {
        rpc.mockResolvedValue({ data: null, error: null });
        const url = new URL('https://x/api/cost/series');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(await res.json()).toEqual({ series: [] });
    });

    it('returns 404 for an unknown cost subpath', async () => {
        const url = new URL('https://x/api/cost/nope');
        const req = new Request(url, { headers: authHeaders });
        const res = await handleCostApi(req, testEnv, url);
        expect(res.status).toBe(404);
    });
});

describe('handleFaviconAsset', () => {
    it('returns null for a path with no matching asset', () => {
        expect(handleFaviconAsset('/nope.png')).toBeNull();
    });

    it('serves a known favicon with the right content-type and bytes', async () => {
        const res = handleFaviconAsset('/favicon.svg');
        expect(res).not.toBeNull();
        expect(res!.headers.get('content-type')).toBe('image/svg+xml');
        expect(res!.headers.get('cache-control')).toContain('max-age');
        const text = await res!.text();
        expect(text).toContain('<svg');
    });
});

describe('default export fetch routing', () => {
    it('requires Basic Auth on /dashboard/token-usage', async () => {
        const req = new Request('https://x/dashboard/token-usage');
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(401);
    });

    it('serves the dashboard HTML with correct credentials', async () => {
        const req = new Request('https://x/dashboard/token-usage', {
            headers: { Authorization: basicAuthHeader('test-user', 'test-pass') },
        });
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(await res.text()).toContain('HercuIT Burnrate');
    });

    it('rejects non-GET on /dashboard/token-usage', async () => {
        const req = new Request('https://x/dashboard/token-usage', { method: 'POST' });
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(405);
    });

    it('requires Basic Auth on /api/token-usage/*', async () => {
        const req = new Request('https://x/api/token-usage/projects');
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(401);
    });

    it('rejects non-GET on /api/token-usage/*', async () => {
        const req = new Request('https://x/api/token-usage/projects', {
            method: 'POST',
            headers: { Authorization: basicAuthHeader('test-user', 'test-pass') },
        });
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(405);
    });

    it('dispatches /v1/metrics to the ingest handler', async () => {
        const req = new Request('https://x/v1/metrics', {
            method: 'POST',
            headers: { Authorization: `Bearer ${testEnv.INGEST_SECRET_TOKEN}` },
            body: '{}',
        });
        const res = await worker.fetch(req, testEnv);
        expect(await res.json()).toEqual({ success: true, count: 0 });
    });

    it('dispatches /v1/logs to the ingest handler', async () => {
        const req = new Request('https://x/v1/logs', {
            method: 'POST',
            headers: { Authorization: `Bearer ${testEnv.INGEST_SECRET_TOKEN}` },
            body: '{}',
        });
        const res = await worker.fetch(req, testEnv);
        expect(await res.json()).toEqual({ message: 'Logs acknowledged' });
    });

    it('serves an authorized /api/token-usage/* request end-to-end', async () => {
        rpc.mockResolvedValue({ data: [{ project_name: 'a' }], error: null });
        const req = new Request('https://x/api/token-usage/projects', {
            headers: { Authorization: basicAuthHeader('test-user', 'test-pass') },
        });
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ projects: ['a'] });
    });

    it('requires Basic Auth on /api/cost/*', async () => {
        const req = new Request('https://x/api/cost/table');
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(401);
    });

    it('rejects non-GET on /api/cost/*', async () => {
        const req = new Request('https://x/api/cost/table', {
            method: 'POST',
            headers: { Authorization: basicAuthHeader('test-user', 'test-pass') },
        });
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(405);
    });

    it('serves an authorized /api/cost/* request end-to-end', async () => {
        rpc.mockResolvedValue({ data: [{ project_name: 'a', total_cost_usd: 1 }], error: null });
        const req = new Request('https://x/api/cost/table', {
            headers: { Authorization: basicAuthHeader('test-user', 'test-pass') },
        });
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ rows: [{ project_name: 'a', total_cost_usd: 1 }] });
    });

    it('serves favicon assets without requiring auth', async () => {
        const req = new Request('https://x/favicon-32.png');
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
    });

    it('returns 404 for an unknown path', async () => {
        const req = new Request('https://x/nope');
        const res = await worker.fetch(req, testEnv);
        expect(res.status).toBe(404);
    });
});


describe('Codex OTLP logs and dashboard sources', () => {
    const attrs = (values: Record<string, string | number>) => Object.entries(values).map(([key, value]) => ({
        key, value: typeof value === 'string' ? { stringValue: value } : { intValue: String(value) },
    }));
    const usage = { 'event.name': 'codex.sse_event', 'event.kind': 'response.completed',
        input_token_count: '100', output_token_count: '25', cached_token_count: 40,
        cache_write_token_count: 10, reasoning_token_count: 15, 'conversation.id': 'conversation-1', model: 'gpt-5-codex' };
    async function send(events: Record<string, string | number>[], query = '') {
        return worker.fetch(new Request('https://x/v1/logs' + query, {
            method: 'POST', headers: { Authorization: 'Bearer test-ingest-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ resourceLogs: [{ resource: { attributes: attrs({ 'project.name': 'repo', 'host.name': 'host' }) },
                scopeLogs: [{ logRecords: events.map((event) => ({ attributes: attrs(event) })) }] }] }),
        }), testEnv);
    }
    it('stores disjoint tokens and reported cost without adding reasoning tokens twice', async () => {
        expect((await send([usage, { 'event.name': 'codex.turn_cost', 'usage.estimated_usd': '0.125',
            'conversation.id': 'conversation-1', model: 'gpt-5-codex' }])).status).toBe(200);
        expect(insert.mock.calls[0][0]).toEqual([
            { source: 'codex', project_name: 'repo', session_id: 'conversation-1', model: 'gpt-5-codex',
                input_tokens: 50, output_tokens: 25, cache_read_tokens: 40, cache_write_tokens: 10,
                total_cost_usd: 0, host_name: 'host', user_email: null },
            expect.objectContaining({ source: 'codex', input_tokens: 0, output_tokens: 0, total_cost_usd: 0.125 }),
        ]);
    });
    it('allows an explicit exporter project name', async () => {
        await send([usage], '?project=other-repo');
        expect(insert.mock.calls[0][0][0].project_name).toBe('other-repo');
    });
    it('ignores non-usage, failed, and generic completion events', async () => {
        await send([{ 'event.name': 'codex.user_prompt' }, { 'event.name': 'codex.sse_event', 'event.kind': 'response.completed' },
            { ...usage, 'error.message': 'stream failed' }, { 'event.name': 'codex.turn_cost' }]);
        expect(insert).not.toHaveBeenCalled();
    });
    it.each([-1, 'NaN', '1.5', '9007199254740992'])('rejects invalid tokens %s before inserting', async (value) => {
        expect((await send([{ ...usage, input_token_count: value }])).status).toBe(400);
        expect(insert).not.toHaveBeenCalled();
    });
    it('rejects cached counts exceeding input and invalid estimated costs', async () => {
        expect((await send([{ ...usage, cached_token_count: 101 }])).status).toBe(400);
        expect((await send([{ 'event.name': 'codex.turn_cost', 'usage.estimated_usd': '-1' }])).status).toBe(400);
        expect(insert).not.toHaveBeenCalled();
    });
    it('reports Codex database failures', async () => {
        insert.mockResolvedValueOnce({ error: { message: 'insert failed' } });
        const response = await send([usage]);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'insert failed' });
    });
    it('handles missing token fields and metadata', async () => {
        await send([{ 'event.name': 'codex.sse_event', 'event.kind': 'response.completed', output_token_count: 2 }]);
        expect(insert.mock.calls[0][0][0]).toMatchObject({ input_tokens: 0, output_tokens: 2,
            session_id: 'unknown_session', model: 'unknown_model' });
    });
    for (const endpoint of ['token-usage/projects', 'token-usage/series', 'token-usage/table', 'cost/series', 'cost/table']) {
        it.each(['claude', 'codex'])('filters ' + endpoint + ' by %s', async (source) => {
            const response = await worker.fetch(new Request('https://x/api/' + endpoint + '?source=' + source,
                { headers: { Authorization: basicAuthHeader('test-user', 'test-pass') } }), testEnv);
            expect(response.status).toBe(200);
            expect(rpc).toHaveBeenCalledWith('get_' + endpoint.replaceAll('-', '_').replace('/', '_'),
                expect.objectContaining({ p_source: source }));
        });
        it('rejects invalid source for ' + endpoint, async () => {
            const response = await worker.fetch(new Request('https://x/api/' + endpoint + '?source=unknown',
                { headers: { Authorization: basicAuthHeader('test-user', 'test-pass') } }), testEnv);
            expect(response.status).toBe(400);
            expect(rpc).not.toHaveBeenCalled();
        });
    }
});


describe('Codex OTLP value and metadata variants', () => {
    it('accepts eventName and double values, falls back to the source project name', () => {
        const records = parseCodexLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{
            eventName: 'codex.turn_cost', attributes: [
                { key: 'usage.estimated_usd', value: { doubleValue: 0.5 } },
                { key: 'user.email', value: { stringValue: 'developer@example.test' } },
            ],
        }] }] }] }, null);
        expect(records).toEqual([expect.objectContaining({ source: 'codex', project_name: 'codex',
            total_cost_usd: 0.5, host_name: null, user_email: 'developer@example.test' })]);
    });
    it('ignores resource and scope blocks with no logs', () => {
        expect(parseCodexLogs({ resourceLogs: [{}, { scopeLogs: [{}] }] }, null)).toEqual([]);
    });
});
