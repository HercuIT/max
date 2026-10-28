import { createClient } from '@supabase/supabase-js';
import type { Env } from './types';

export class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}
export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
export function serviceClient(env: Env) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function digest(value: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export function randomToken(prefix: string): string {
    return prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
}
export function uuid(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new ApiError(400, 'invalid_id', 'Supply a valid organization or object UUID.');
    }
    return value;
}
export function isTimestamp(value: string): boolean {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return false;
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    return year > 0 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && Number.isFinite(Date.parse(value));
}
export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<any> {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
        throw new ApiError(415, 'json_required', 'Send Content-Type: application/json.');
    }
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'invalid_json', 'Send a JSON body.');
    let size = 0;
    const decoder = new TextDecoder();
    let text = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'payload_too_large', 'Maximum request size is 1 MiB.'); }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        const result = JSON.parse(text);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('object required');
        return result;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(400, 'invalid_json', 'Send a valid JSON object.');
    } finally { reader.releaseLock(); }
}
export function databaseError(error: { code?: string; message?: string }): never {
    const status = /^PT(401|403|404|409|413)$/.exec(error.code ?? '');
    if (status) throw new ApiError(Number(status[1]), 'request_rejected', error.message ?? 'Request rejected.');
    if (['22023', '23514', '22P02', '22007', '22008', '22003'].includes(error.code ?? '')) {
        throw new ApiError(400, 'invalid_fields', 'Check the supplied names, roles, dates, and usage values.');
    }
    if (error.code === '23505') throw new ApiError(409, 'already_exists', 'This record already exists.');
    throw new ApiError(503, 'database_unavailable', 'The database could not complete this operation. Retry shortly.');
}
export async function rateLimit(env: Env, scope: string, identity: string, limit: number, seconds = 60) {
    const { data, error } = await serviceClient(env).rpc('check_rate_limit', {
        p_key_hash: await digest(scope + ':' + identity), p_limit: limit, p_window_seconds: seconds,
    });
    if (error) databaseError(error);
    if (data !== true) throw new ApiError(429, 'rate_limited', 'Too many requests. Wait a minute and try again.');
}
