import { UIStrings } from '../../../ui-strings.ts';

interface MailConfig {
    INVITATION_DELIVERY_TOKEN?: string;
    RESEND_API_KEY?: string;
    INVITATION_FROM_EMAIL?: string;
}

const MAX_BYTES = 16384;
const reply = (status: number, error?: string) => new Response(
    JSON.stringify(error ? { error } : { success: true }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
);

// Compare fixed-size digests without exposing token length or matching prefixes.
async function sameToken(actual: string, expected: string): Promise<boolean> {
    const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    const [a, b] = await Promise.all([digest(actual), digest(expected)]);
    let difference = 0;
    const left = new Uint8Array(a), right = new Uint8Array(b);
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
}

export async function handleInvitation(request: Request, config: MailConfig, send: typeof fetch = fetch): Promise<Response> {
    if (request.method !== 'POST') return reply(405, UIStrings.text.methodNotAllowed);
    const { INVITATION_DELIVERY_TOKEN: token, RESEND_API_KEY: apiKey, INVITATION_FROM_EMAIL: from } = config;
    if (!token?.trim() || !apiKey?.trim() || !from?.trim()) return reply(503, UIStrings.text.invitationDeliveryUnavailable);
    const authorization = request.headers.get('Authorization') ?? '';
    if (authorization.length > 4096 || !authorization.startsWith('Bearer ') ||
        !await sameToken(authorization.slice(7), token)) return reply(401, UIStrings.text.unauthorized);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return reply(415, UIStrings.text.invalidJson);
    }
    let payload: unknown;
    const reader = request.body?.getReader();
    if (!reader) return reply(400, UIStrings.text.invalidJson);
    try {
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) {
                await reader.cancel();
                return reply(413, UIStrings.format(UIStrings.text.payloadTooLarge, { maxBytes: MAX_BYTES }));
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return reply(400, UIStrings.text.invalidJson);
    } finally { reader.releaseLock(); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400, UIStrings.text.invalidJson);
    const { to, subject, text } = payload as Record<string, unknown>;
    if (typeof to !== 'string' || to.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) ||
        typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject) ||
        typeof text !== 'string' || !text.trim() || text.length > 10000) return reply(400, UIStrings.text.invalidJson);
    try {
        const response = await send('https://api.resend.com/emails', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: [to], subject, text }),
        });
        if (!response.ok) {
            await response.body?.cancel();
            return reply(502, UIStrings.text.invitationDeliveryUnavailable);
        }
        const result = await response.json() as { id?: unknown } | null;
        if (!result || typeof result.id !== 'string' || !result.id.trim()) return reply(502, UIStrings.text.invitationDeliveryUnavailable);
        return reply(200);
    } catch {
        return reply(502, UIStrings.text.invitationDeliveryUnavailable);
    }
}
