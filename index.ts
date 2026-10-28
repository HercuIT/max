import { UIStrings } from './ui-strings';
import { tokenUsageDashboardHtml } from './dashboard';
import { signInHtml, settingsHtml, invitationHtml } from './pages';
import { faviconAssets } from './assets';
import { handleAuth, requireCsrf, sessionFor } from './auth';
import { ApiError, databaseError, digest, jsonResponse, rateLimit, readJson, serviceClient } from './http';
import { handleTenantApi } from './tenancy';
import { parseClaudeMetrics, parseCodexLogs, TelemetryLimitError } from './telemetry';
import type { Env } from './types';
export type { Env } from './types';
export { jsonResponse } from './http';
export { findAttr, parseClaudeMetrics, parseCodexLogs } from './telemetry';

export function handleFaviconAsset(pathname: string): Response | null {
    const asset = faviconAssets[pathname];
    if (!asset) return null;
    const bytes = Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0));
    return new Response(bytes.buffer, { headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'public, max-age=86400' } });
}
export async function handleIngest(request: Request, env: Env, url: URL, requestId = crypto.randomUUID()): Promise<Response> {
    if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', UIStrings.text.usePost);
    const token = request.headers.get('Authorization')?.match(/^Bearer (brk_[0-9a-f]{64})$/)?.[1];
    // Limit failed attempts by trusted Cloudflare IP, not a caller-supplied forwarding header.
    await rateLimit(env, 'ingest-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 120);
    if (!token) throw new ApiError(401, 'unauthorized', UIStrings.text.unauthorized);
    const hash = await digest(token);
    await rateLimit(env, 'ingest-key', hash, 600);
    const payload = await readJson(request);
    const logs = url.pathname === '/v1/logs';
    let records: ReturnType<typeof parseClaudeMetrics>['records'];
    let rejectedLogRecords = 0, rejectedDataPoints = 0;
    try {
        if (logs) ({ records, rejectedLogRecords } = parseCodexLogs(payload, url.searchParams.get('project')));
        else ({ records, rejectedDataPoints } = parseClaudeMetrics(payload));
    } catch (error) {
        if (error instanceof TelemetryLimitError) throw new ApiError(413, 'too_many_rows', UIStrings.text.tooManyRows);
        if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
        throw new ApiError(400, 'invalid_telemetry', UIStrings.text.invalidTelemetry);
    }
    // Even an empty batch must validate the current key/tenant inside the database.
    const { data, error } = await serviceClient(env).rpc('ingest_telemetry', { p_token_hash: hash, p_rows: records });
    if (error) databaseError(error);
    console.info(JSON.stringify({ context: 'ingest', requestId, tenantId: data.tenant_id, keyId: data.key_id, count: data.count }));
    return jsonResponse(logs ? { message: UIStrings.text.logsAcknowledged, ...(rejectedLogRecords ? { partialSuccess: {
        rejectedLogRecords: String(rejectedLogRecords), errorMessage: UIStrings.text.rejectedUsageRecords,
    } } : {}) } : { success: true, count: data.count, ...(rejectedDataPoints ? { partialSuccess: {
        rejectedDataPoints: String(rejectedDataPoints), errorMessage: UIStrings.text.rejectedUsageRecords,
    } } : {}) });
}
function html(body: string) { return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }); }
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const requestId = crypto.randomUUID();
        const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
        let response: Response;
        try {
            const url = new URL(request.url);
            const asset = handleFaviconAsset(url.pathname);
            if (asset) response = asset;
            else if (url.pathname === '/v1/metrics' || url.pathname === '/v1/logs') response = await handleIngest(request, env, url, requestId);
            else {
                const session = url.pathname === '/auth/sign-out' ? null : await sessionFor(request, env, headers);
                if (url.pathname === '/api/session' || ['/auth/sign-in', '/auth/verify', '/auth/sign-out'].includes(url.pathname)) {
                    response = await handleAuth(request, env, headers, session);
                } else if (url.pathname === '/sign-in' && request.method === 'GET') response = html(signInHtml);
                else if (url.pathname === '/invite' && request.method === 'GET') response = html(invitationHtml);
                else if (['/dashboard/token-usage', '/settings'].includes(url.pathname) && request.method === 'GET') {
                    response = session ? html(url.pathname === '/settings' ? settingsHtml : tokenUsageDashboardHtml)
                        : new Response(null, { status: 303, headers: { Location: '/sign-in' } });
                } else if (url.pathname.startsWith('/api/tenants') || url.pathname === '/api/invitations/accept') {
                    if (!session) throw new ApiError(401, 'sign_in_required', UIStrings.text.signInRequired);
                    if (!['GET', 'HEAD'].includes(request.method)) {
                        requireCsrf(request, env);
                        await rateLimit(env, 'administration', session.userId, 60);
                    }
                    response = await handleTenantApi(request, env, session, requestId);
                } else if (/^\/api\/(token-usage|cost)\//.test(url.pathname)) {
                    throw new ApiError(410, 'tenant_required', UIStrings.text.tenantRequired);
                } else throw new ApiError(404, 'not_found', UIStrings.text.notFound);
            }
        } catch (error) {
            const failure = error instanceof ApiError ? error : new ApiError(500, 'unexpected_error', UIStrings.text.unexpectedError);
            // Deliberately log safe categories only: DB/Auth errors can contain credentials or payload values.
            console.error(JSON.stringify({ context: 'request', requestId, code: failure.code, status: failure.status }));
            response = jsonResponse({ error: failure.message, code: failure.code, requestId }, failure.status);
            if (failure.status === 429 || failure.status === 503) response.headers.set('Retry-After', '60');
        }
        for (const [name, value] of headers) if (name !== 'set-cookie' && !(name === 'cache-control' && response.headers.has(name))) response.headers.set(name, value);
        for (const value of headers.getSetCookie()) response.headers.append('Set-Cookie', value);
        return response;
    },
};
