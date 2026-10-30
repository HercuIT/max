import { UIStrings } from './ui-strings';
import type { Session } from './auth';
import { ApiError, databaseError, digest, isTimestamp, jsonResponse, randomToken, readJson, uuid } from './http';
import type { Env } from './types';

export async function rpc(session: Session, name: string, args?: Record<string, unknown>): Promise<any> {
    const { data, error } = await session.client.rpc(name, args);
    if (error) databaseError(error);
    return data;
}
export function dashboardArguments(url: URL, tenantId: string) {
    const query = url.searchParams;
    const source = query.get('source');
    const bucket = query.get('bucket') || 'day';
    if (source && !['claude', 'codex'].includes(source)) throw new ApiError(400, 'invalid_source', UIStrings.text.invalidSource);
    if (!['hour', 'day', 'week'].includes(bucket)) throw new ApiError(400, 'invalid_bucket', UIStrings.text.invalidBucket);
    const start = query.get('start'), end = query.get('end');
    for (const value of [start, end]) {
        if (value && !isTimestamp(value)) {
            throw new ApiError(400, 'invalid_date', UIStrings.text.invalidDate);
        }
    }
    if (start && end && Date.parse(start) > Date.parse(end)) throw new ApiError(400, 'invalid_range', UIStrings.text.invalidRange);
    const projects = query.get('projects')?.split(',').map(x => x.trim()).filter(Boolean);
    return { p_tenant_id: tenantId, ...(source ? { p_source: source } : {}),
        p_projects: projects?.length ? projects : null, ...(start ? { p_start: start } : {}), ...(end ? { p_end: end } : {}), p_bucket: bucket };
}
async function deliverInvitation(env: Env, email: string, token: string): Promise<boolean> {
    if (!env.INVITATION_DELIVERY_URL || !env.INVITATION_DELIVERY_TOKEN) return false;
    try {
        const endpoint = new URL(env.INVITATION_DELIVERY_URL);
        if (endpoint.protocol !== 'https:') return false;
        // A fragment never reaches the web server/referrer. The landing page removes it immediately.
        const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INVITATION_DELIVERY_TOKEN}` },
            body: JSON.stringify({ to: email, subject: UIStrings.text.invitationSubject,
                text: UIStrings.format(UIStrings.text.invitationEmail, { url: `${env.APP_ORIGIN}/invite#${token}` }) }) });
        return response.ok;
    } catch { return false; } // Caller reports the persisted invitation and actionable delivery failure.
}
export async function handleTenantApi(request: Request, env: Env, session: Session, requestId: string, rolloutReads = false): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/tenants' && request.method === 'GET') return jsonResponse({ tenants: await rpc(session, 'list_tenants') ?? [] });
    if (url.pathname === '/api/invitations/accept' && request.method === 'POST') {
        const body = await readJson(request, 8192);
        if (typeof body.token !== 'string' || !/^bri_[0-9a-f]{64}$/.test(body.token)) throw new ApiError(400, 'invalid_invitation', UIStrings.text.invalidInvitation);
        const id = await rpc(session, 'accept_tenant_invitation', { p_token_hash: await digest(body.token), p_request_id: requestId });
        return jsonResponse({ tenantId: id });
    }
    const match = /^\/api\/tenants\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!match) throw new ApiError(404, 'not_found', UIStrings.text.notFound);
    const tenantId = uuid(match[1]);
    const memberships = await rpc(session, 'list_tenants') ?? [];
    if (!memberships.some((t: { id: string }) => t.id === tenantId)) throw new ApiError(404, 'not_found', UIStrings.text.organizationNotFound);
    const path = match[2] || '';
    const method = request.method;
    if (/^(token-usage\/(projects|table|series)|cost\/(table|series))$/.test(path) && method === 'GET') {
        const args = dashboardArguments(url, tenantId);
        const name = (rolloutReads ? 'organization_get_' : 'get_') + path.replaceAll('-', '_').replace('/', '_');
        const params: Record<string, unknown> = path.endsWith('/projects')
            ? { p_tenant_id: tenantId, ...(args.p_source ? { p_source: args.p_source } : {}) } : { ...args };
        if (!path.endsWith('/series')) delete params.p_bucket;
        const data = await rpc(session, name, params) ?? [];
        return jsonResponse(path.endsWith('/projects') ? { projects: data.map((p: { project_name: string }) => p.project_name) }
            : path.endsWith('/series') ? { series: data } : { rows: data });
    }
    if (path === 'members' && method === 'GET') return jsonResponse({ members: await rpc(session, 'get_tenant_members', { p_tenant_id: tenantId }) ?? [] });
    let action = '', target: string | undefined;
    if (path === 'ingestion-keys' && ['GET', 'POST'].includes(method)) action = method === 'GET' ? 'keys.list' : 'keys.create';
    else if (/^ingestion-keys\/[^/]+$/.test(path) && method === 'DELETE') { action = 'keys.revoke'; target = path.split('/')[1]; }
    else if (path === 'invitations' && ['GET', 'POST'].includes(method)) action = method === 'GET' ? 'invitations.list' : 'invitations.create';
    else if (/^invitations\/[^/]+\/resend$/.test(path) && method === 'POST') { action = 'invitations.resend'; target = path.split('/')[1]; }
    else if (/^invitations\/[^/]+$/.test(path) && method === 'DELETE') { action = 'invitations.revoke'; target = path.split('/')[1]; }
    else if (/^members\/[^/]+$/.test(path) && ['DELETE', 'PATCH'].includes(method)) { action = method === 'DELETE' ? 'members.remove' : 'members.update'; target = path.split('/')[1]; }
    else if (!path && method === 'PATCH') action = 'rename';
    else if (path === 'deletion-request' && method === 'POST') action = 'deletion-request';
    else throw new ApiError(404, 'not_found', UIStrings.text.notFound);
    if (target) uuid(target);
    const body = ['POST', 'PATCH'].includes(method) ? await readJson(request, 8192) : {};
    // Never forward caller-controlled hash/prefix fields or arbitrary database values.
    const values: Record<string, unknown> = {};
    for (const key of ['label', 'expires_at', 'email', 'role', 'name', 'confirmation']) if (body[key] !== undefined) values[key] = body[key];
    const required = action === 'keys.create' ? ['label'] : action === 'rename' ? ['name'] : [];
    for (const name of required) {
        if (typeof values[name] !== 'string' || (values[name] as string).trim() === '') {
            throw new ApiError(400, 'invalid_fields', UIStrings.format(UIStrings.text.nonEmptyField, { name }));
        }
    }
    for (const [name, value] of Object.entries(values)) {
        if (typeof value !== 'string' || value.trim() === '') throw new ApiError(400, 'invalid_fields', UIStrings.format(UIStrings.text.nonEmptyField, { name }));
    }
    if (values.expires_at && !isTimestamp(values.expires_at as string)) throw new ApiError(400, 'invalid_expiry', UIStrings.text.invalidExpiry);
    let rawToken: string | undefined;
    if (action === 'keys.create' || action === 'invitations.create' || action === 'invitations.resend') {
        rawToken = randomToken(action === 'keys.create' ? 'brk_' : 'bri_');
        values.token_hash = await digest(rawToken);
        if (action === 'keys.create') values.prefix = rawToken.slice(0, 12);
    }
    const data = await rpc(session, 'manage_tenant', { p_tenant_id: tenantId, p_action: action,
        p_target_id: target ?? null, p_values: values, p_request_id: requestId });
    if (action === 'keys.create') return jsonResponse({ ...data, token: rawToken }, 201);
    if (action === 'invitations.create' || action === 'invitations.resend') {
        const delivered = await deliverInvitation(env, data.email, rawToken!);
        return jsonResponse({ id: data.id, delivered, ...(delivered ? {} : { code: 'invitation_delivery_failed',
            error: UIStrings.text.invitationDeliveryFailed }) }, delivered ? 201 : 503);
    }
    return jsonResponse(action.endsWith('.list') ? { [action.startsWith('keys') ? 'keys' : 'invitations']: data } : { success: true });
}
