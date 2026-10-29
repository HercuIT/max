import { UIStrings } from './ui-strings';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, jsonResponse, randomToken, rateLimit, readJson } from './http';
import type { Env } from './types';

const COOKIE = { access: '__Host-burnrate-access', refresh: '__Host-burnrate-refresh', csrf: '__Host-burnrate-csrf' };
export function cookies(request: Request): Map<string, string> {
    return new Map((request.headers.get('Cookie') ?? '').split(';').flatMap(part => {
        const i = part.indexOf('='); return i < 0 ? [] : [[part.slice(0, i).trim(), part.slice(i + 1)]];
    }));
}
function setCookie(headers: Headers, name: string, value: string, maxAge: number) {
    headers.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function saveSession(headers: Headers, session: { access_token: string; refresh_token: string; expires_in?: number }) {
    setCookie(headers, COOKIE.access, session.access_token, session.expires_in ?? 3600);
    // The refresh token is usable only while the Supabase session remains valid.
    setCookie(headers, COOKIE.refresh, session.refresh_token, 7 * 86400);
}
export function clearSession(headers: Headers) {
    for (const name of Object.values(COOKIE)) setCookie(headers, name, '', 0);
}
const PKCE_COOKIE = '__Host-burnrate-pkce';
const FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;
function flowCookie(id: string) { return `${PKCE_COOKIE}-${id}`; }
function publicClient(env: Env, pkce?: { request: Request; headers: Headers }) {
    try {
        if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_PUBLISHABLE_KEY?.trim()) throw new Error();
        const storageKey = 'burnrate-auth';
        const memory = new Map<string, string>();
        // Persist SDK per-flow slots, never its shared legacy verifier slot.
        if (pkce) for (const [name, value] of cookies(pkce.request)) {
            const id = name.slice(PKCE_COOKIE.length + 1);
            if (!name.startsWith(PKCE_COOKIE + '-') || !FLOW_ID.test(id) || value.length > 2048) continue;
            try { memory.set(`${storageKey}-flow-${id}-code-verifier`, decodeURIComponent(value)); } catch { /* Invalid verifier cannot authenticate. */ }
        }
        const cookieForKey = (key: string) => {
            const id = key.match(/^burnrate-auth-flow-([a-zA-Z0-9_-]{8,64})-code-verifier$/)?.[1];
            return id ? flowCookie(id) : null;
        };
        return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
            persistSession: !!pkce, autoRefreshToken: false, detectSessionInUrl: false,
            ...(pkce ? { flowType: 'pkce' as const, experimental: { appendPkceFlowIdToRedirects: true }, storageKey, storage: {
                getItem: (key: string) => memory.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    memory.set(key, value);
                    // Request-specific names prevent out-of-order responses from overwriting other flows.
                    const name = cookieForKey(key);
                    if (name) setCookie(pkce.headers, name, encodeURIComponent(value), 600);
                },
                removeItem: (key: string) => {
                    memory.delete(key);
                    const name = cookieForKey(key);
                    if (name) setCookie(pkce.headers, name, '', 0);
                },
            } } : {}),
        } });
    } catch {
        // SDK construction errors describe configuration, not a failed Auth request.
        // Never return arbitrary exception text, which could contain credentials.
        throw new ApiError(503, 'auth_configuration_error', UIStrings.text.authConfigurationError);
    }
}
function authUnavailable(error: { status?: number } | null | undefined): boolean {
    return !!error && (error.status === 0 || (error.status !== undefined && error.status >= 500));
}
export interface Session { userId: string; client: SupabaseClient; }
export async function sessionFor(request: Request, env: Env, headers: Headers): Promise<Session | null> {
    const jar = cookies(request);
    let access = jar.get(COOKIE.access);
    if (!access && !jar.get(COOKIE.refresh)) return null;
    const client = publicClient(env);
    let user = access ? await client.auth.getUser(access) : null;
    if (!user?.data.user && jar.get(COOKIE.refresh)) {
        const refreshed = await client.auth.refreshSession({ refresh_token: jar.get(COOKIE.refresh)! });
        if (authUnavailable(refreshed.error)) {
            throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
        }
        if (refreshed.data.session) {
            access = refreshed.data.session.access_token;
            saveSession(headers, refreshed.data.session);
            user = await client.auth.getUser(access);
        }
    }
    if (!user?.data.user) {
        if (authUnavailable(user?.error)) throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
        if (access || jar.get(COOKIE.refresh)) clearSession(headers);
        return null;
    }
    return { userId: user.data.user.id, client: createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: `Bearer ${access}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }) };
}
export function requireCsrf(request: Request, env: Env) {
    const supplied = request.headers.get('X-CSRF-Token');
    if (request.headers.get('Origin') !== env.APP_ORIGIN || !supplied || supplied !== cookies(request).get(COOKIE.csrf)) {
        throw new ApiError(403, 'csrf_failed', UIStrings.text.csrfFailed);
    }
}
export async function handleAuthCallback(request: Request, env: Env, headers: Headers): Promise<Response> {
    const fail = () => new Response(null, { status: 303, headers: { Location: '/sign-in?error=invalid_link' } });
    if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed', UIStrings.text.requestRejected);
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const flowId = url.searchParams.get('sb_flow_id');
    if (!flowId || !FLOW_ID.test(flowId)) return fail();
    const verifier = cookies(request).get(flowCookie(flowId));
    setCookie(headers, flowCookie(flowId), '', 0);
    if (url.origin !== env.APP_ORIGIN || url.searchParams.has('error') || !code || code.length > 2048 || !verifier || verifier.length > 2048) return fail();
    await rateLimit(env, 'auth-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 20);
    const client = publicClient(env, { request, headers });
    // Consume only the verifier belonging to this callback, preserving other pending links.
    const { data, error } = await client.auth.exchangeCodeForSession(code, { flowId });
    if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
    if (error || !data.session) return fail();
    saveSession(headers, data.session);
    setCookie(headers, COOKIE.csrf, randomToken('csrf_'), 7 * 86400);
    return new Response(null, { status: 303, headers: { Location: '/dashboard/token-usage' } });
}
export async function handleAuth(request: Request, env: Env, headers: Headers, session: Session | null): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/session' && request.method === 'GET') {
        const csrf = cookies(request).get(COOKIE.csrf) || randomToken('csrf_');
        setCookie(headers, COOKIE.csrf, csrf, 7 * 86400);
        return jsonResponse({ signedIn: !!session, userId: session?.userId, csrf });
    }
    if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', UIStrings.text.usePost);
    requireCsrf(request, env);
    const client = publicClient(env, path === '/auth/sign-in' ? { request, headers } : undefined);
    if (path === '/auth/sign-out') {
        const jar = cookies(request);
        let access = jar.get(COOKIE.access);
        let remoteRevoked = false;
        clearSession(headers);
        // Explicit sign-out cancels pending flows; ordinary stale-session cleanup does not.
        for (const name of jar.keys()) {
            if (name === PKCE_COOKIE || (name.startsWith(PKCE_COOKIE + '-') && FLOW_ID.test(name.slice(PKCE_COOKIE.length + 1)))) setCookie(headers, name, '', 0);
        }
        if (jar.get(COOKIE.refresh)) {
            try {
                const { data, error } = await client.auth.refreshSession({ refresh_token: jar.get(COOKIE.refresh)! });
                if (data.session) access = data.session.access_token;
                if (error) console.warn(JSON.stringify({ context: 'signout', code: 'refresh_for_revocation_failed' }));
            } catch {
                console.warn(JSON.stringify({ context: 'signout', code: 'refresh_for_revocation_unavailable' }));
            }
        }
        if (access) {
            try {
                // Despite the SDK namespace, signOut(jwt) is POST /logout with the
                // supplied user JWT, not a service-role-only admin operation.
                const { error } = await client.auth.admin.signOut(access, 'local');
                remoteRevoked = !error;
                if (error) console.warn(JSON.stringify({ context: 'signout', code: 'remote_revocation_failed' }));
            } catch {
                console.warn(JSON.stringify({ context: 'signout', code: 'remote_revocation_unavailable' }));
            }
        }
        return jsonResponse({ success: true, remoteRevoked });
    }
    await rateLimit(env, 'auth-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 20);
    const body = await readJson(request, 8192);
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) {
        throw new ApiError(400, 'invalid_email', UIStrings.text.invalidEmail);
    }
    const email = body.email.trim().toLowerCase();
    await rateLimit(env, 'auth-email', email, 5, 600);
    if (path === '/auth/sign-in') {
        const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${env.APP_ORIGIN}/auth/callback` } });
        if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
        return jsonResponse({ message: UIStrings.text.codeSent });
    }
    if (path === '/auth/verify') {
        if (typeof body.code !== 'string' || !/^\d{6,8}$/.test(body.code)) throw new ApiError(400, 'invalid_code', UIStrings.text.enterEmailCode);
        const { data, error } = await client.auth.verifyOtp({ email, token: body.code, type: 'email' });
        if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
        if (error || !data.session) throw new ApiError(401, 'invalid_code', UIStrings.text.invalidCode);
        saveSession(headers, data.session);
        setCookie(headers, COOKIE.csrf, randomToken('csrf_'), 7 * 86400);
        return jsonResponse({ success: true });
    }
    throw new ApiError(404, 'not_found', UIStrings.text.notFound);
}
