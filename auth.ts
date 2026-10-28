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
function publicClient(env: Env) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
function authUnavailable(error: { status?: number } | null | undefined): boolean {
    return !!error && (error.status === 0 || (error.status !== undefined && error.status >= 500));
}
export interface Session { userId: string; client: SupabaseClient; }
export async function sessionFor(request: Request, env: Env, headers: Headers): Promise<Session | null> {
    const jar = cookies(request);
    let access = jar.get(COOKIE.access);
    const client = publicClient(env);
    let user = access ? await client.auth.getUser(access) : null;
    if (!user?.data.user && jar.get(COOKIE.refresh)) {
        const refreshed = await client.auth.refreshSession({ refresh_token: jar.get(COOKIE.refresh)! });
        if (authUnavailable(refreshed.error)) {
            throw new ApiError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Retry shortly.');
        }
        if (refreshed.data.session) {
            access = refreshed.data.session.access_token;
            saveSession(headers, refreshed.data.session);
            user = await client.auth.getUser(access);
        }
    }
    if (!user?.data.user) {
        if (authUnavailable(user?.error)) throw new ApiError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Retry shortly.');
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
        throw new ApiError(403, 'csrf_failed', 'Reload this page before submitting the form.');
    }
}
export async function handleAuth(request: Request, env: Env, headers: Headers, session: Session | null): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/session' && request.method === 'GET') {
        const csrf = cookies(request).get(COOKIE.csrf) || randomToken('csrf_');
        setCookie(headers, COOKIE.csrf, csrf, 7 * 86400);
        return jsonResponse({ signedIn: !!session, userId: session?.userId, csrf });
    }
    if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Use POST for this operation.');
    requireCsrf(request, env);
    const client = publicClient(env);
    if (path === '/auth/sign-out') {
        const access = cookies(request).get(COOKIE.access);
        clearSession(headers);
        if (access) {
            try {
                const { error } = await client.auth.admin.signOut(access, 'local');
                if (error) console.warn(JSON.stringify({ context: 'signout', code: 'remote_revocation_failed' }));
            } catch {
                console.warn(JSON.stringify({ context: 'signout', code: 'remote_revocation_unavailable' }));
            }
        }
        return jsonResponse({ success: true });
    }
    await rateLimit(env, 'auth-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 20);
    const body = await readJson(request, 8192);
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) {
        throw new ApiError(400, 'invalid_email', 'Enter a valid email address.');
    }
    const email = body.email.trim().toLowerCase();
    await rateLimit(env, 'auth-email', email, 5, 600);
    if (path === '/auth/sign-in') {
        const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', 'Email sign-in is temporarily unavailable. Retry shortly.');
        return jsonResponse({ message: 'If this address can receive a sign-in code, it will arrive shortly.' });
    }
    if (path === '/auth/verify') {
        if (typeof body.code !== 'string' || !/^\d{6,8}$/.test(body.code)) throw new ApiError(400, 'invalid_code', 'Enter the code from your email.');
        const { data, error } = await client.auth.verifyOtp({ email, token: body.code, type: 'email' });
        if (authUnavailable(error)) throw new ApiError(503, 'auth_unavailable', 'Code verification is temporarily unavailable. Retry shortly.');
        if (error || !data.session) throw new ApiError(401, 'invalid_code', 'The code is invalid or expired. Request another code.');
        saveSession(headers, data.session);
        setCookie(headers, COOKIE.csrf, randomToken('csrf_'), 7 * 86400);
        return jsonResponse({ success: true });
    }
    throw new ApiError(404, 'not_found', 'Page not found.');
}
