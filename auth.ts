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
    for (const name of [...Object.values(COOKIE), PKCE_COOKIE]) setCookie(headers, name, '', 0);
}
const PKCE_COOKIE = '__Host-burnrate-pkce';
function publicClient(env: Env, pkce?: { request: Request; headers: Headers }) {
    try {
        if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_PUBLISHABLE_KEY?.trim()) throw new Error();
        const storageKey = 'burnrate-auth';
        const verifierKey = `${storageKey}-code-verifier`;
        const memory = new Map<string, string>();
        const stored = pkce && cookies(pkce.request).get(PKCE_COOKIE);
        if (stored && stored.length <= 2048) {
            try { memory.set(verifierKey, decodeURIComponent(stored)); } catch { /* Invalid verifier cannot authenticate. */ }
        }
        return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
            persistSession: !!pkce, autoRefreshToken: false, detectSessionInUrl: false,
            ...(pkce ? { flowType: 'pkce' as const, storageKey, storage: {
                getItem: (key: string) => memory.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    memory.set(key, value);
                    // Only the latest verifier persists; session tokens stay in request-local memory.
                    if (key === verifierKey) setCookie(pkce.headers, PKCE_COOKIE, encodeURIComponent(value), 600);
                },
                removeItem: (key: string) => {
                    memory.delete(key);
                    if (key === verifierKey) setCookie(pkce.headers, PKCE_COOKIE, '', 0);
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
    const verifier = cookies(request).get(PKCE_COOKIE);
    if (url.origin !== env.APP_ORIGIN || url.searchParams.has('error') || !code || code.length > 2048 || !verifier || verifier.length > 2048) return fail();
    await rateLimit(env, 'auth-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 20);
    const exchangeHeaders = new Headers();
    const client = publicClient(env, { request, headers: exchangeHeaders });
    // Exchange uses the latest verifier's fixed slot; newer requests supersede older links.
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
    if (error || !data.session) return fail();
    setCookie(headers, PKCE_COOKIE, '', 0);
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
    // A rejected resend must not replace the verifier for the last delivered email.
    const pendingHeaders = new Headers();
    const client = publicClient(env, path === '/auth/sign-in' ? { request, headers: pendingHeaders } : undefined);
    if (path === '/auth/sign-out') {
        const jar = cookies(request);
        let access = jar.get(COOKIE.access);
        let remoteRevoked = false;
        clearSession(headers);
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
    try {
        await rateLimit(env, 'auth-email', email, 5, 600);
    } catch (error) {
        if (error instanceof ApiError && error.status === 429) throw new ApiError(429, 'auth_email_rate_limited', UIStrings.text.authEmailRateLimited);
        throw error;
    }
    if (path === '/auth/sign-in') {
        const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${env.APP_ORIGIN}/auth/callback` } });
        if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', UIStrings.text.authUnavailable);
        if (error?.status === 429) throw new ApiError(429, 'auth_email_rate_limited', UIStrings.text.authEmailRateLimited);
        if (error) throw new ApiError(400, 'auth_email_not_sent', UIStrings.text.authEmailNotSent);
        for (const value of pendingHeaders.getSetCookie()) headers.append('Set-Cookie', value);
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
