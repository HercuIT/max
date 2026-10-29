import { describe, expect, it, vi } from 'vitest';
import { handleInvitation } from './handler.ts';
import { UIStrings } from '../../../ui-strings.ts';

const config = { INVITATION_DELIVERY_TOKEN: 'test-secret', RESEND_API_KEY: 'test-resend', INVITATION_FROM_EMAIL: 'Burnrate <invite@example.test>' };
const payload = { to: 'member@example.test', subject: 'Invitation', text: 'Accept your invitation: https://example.test/invite#test' };
function request(body: unknown = payload, headers: Record<string, string> = {}) {
    return new Request('https://example.test/send-invitation', {
        method: 'POST', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}
const accepted = () => vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'email-id' }));

describe('invitation email delivery', () => {
    it('sends exactly one plain-text email and acknowledges provider acceptance', async () => {
        const send = accepted();
        const response = await handleInvitation(request(), config, send);
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({ success: true });
        expect(send).toHaveBeenCalledTimes(1);
        const [url, options] = send.mock.calls[0];
        expect(url).toBe('https://api.resend.com/emails');
        expect(options?.headers).toEqual({ Authorization: 'Bearer test-resend', 'Content-Type': 'application/json' });
        expect(options?.redirect).toBe('error');
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(options?.body as string)).toEqual({ from: config.INVITATION_FROM_EMAIL, ...payload, to: [payload.to] });
    });
    it('accepts JSON with a charset parameter', async () => {
        const send = accepted();
        expect((await handleInvitation(request(payload, { 'Content-Type': 'application/json; charset=utf-8' }), config, send)).status).toBe(200);
        expect(send).toHaveBeenCalledTimes(1);
    });
    // A 64-character local part and domain labels within DNS limits: 254 total.
    const longestRecipient = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    it('accepts valid fields exactly at all three limits without truncation', async () => {
        const body = { to: longestRecipient, subject: 's'.repeat(200), text: 't'.repeat(10000) };
        expect(body.to.length).toBe(254);
        const send = accepted();
        expect((await handleInvitation(request(body), config, send)).status).toBe(200);
        expect(send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(send.mock.calls[0][1]?.body as string)).toEqual({ from: config.INVITATION_FROM_EMAIL, ...body, to: [body.to] });
    });
    it.each([
        { ...payload, to: longestRecipient + 'x' },
        { ...payload, subject: 's'.repeat(201) },
    ])('rejects fields one character past their limits %#', async body => {
        const send = accepted();
        expect((await handleInvitation(request(body), config, send)).status).toBe(400);
        expect(send).not.toHaveBeenCalled();
    });
    it.each(['', 'Bearer wrong', 'Basic test-secret', 'Bearer test-secret-extra', 'Bearer ' + 'x'.repeat(4096)])('rejects invalid credentials before delivery: %s', async authorization => {
        const send = accepted();
        expect((await handleInvitation(request(payload, { Authorization: authorization }), config, send)).status).toBe(401);
        expect(send).not.toHaveBeenCalled();
    });
    it.each(['INVITATION_DELIVERY_TOKEN', 'RESEND_API_KEY', 'INVITATION_FROM_EMAIL'])('fails closed with missing %s', async key => {
        const send = accepted();
        const response = await handleInvitation(request(), { ...config, [key]: '' }, send);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: UIStrings.text.invitationDeliveryUnavailable });
        expect(send).not.toHaveBeenCalled();
    });
    it('rejects unsupported methods and media types', async () => {
        const send = accepted();
        const response = await handleInvitation(new Request('https://example.test'), config, send);
        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST');
        expect(await response.json()).toEqual({ error: UIStrings.text.usePost });
        expect((await handleInvitation(request(payload, { 'Content-Type': 'text/plain' }), config, send)).status).toBe(415);
        expect(send).not.toHaveBeenCalled();
    });
    it.each([null, [], {}, { ...payload, to: ['member@example.test'] }, { ...payload, to: 'a@example.test,b@example.test' }, { ...payload, to: 'a\r\n@example.test' }, { ...payload, subject: 'Hi\r\nBcc: x@example.test' }, { ...payload, subject: ' ' }, { ...payload, text: '' }, { ...payload, text: 'x'.repeat(10001) }])('rejects malformed fields %#', async body => {
        const send = accepted();
        expect((await handleInvitation(request(body), config, send)).status).toBe(400);
        expect(send).not.toHaveBeenCalled();
    });
    it('rejects malformed JSON and absent bodies', async () => {
        const send = accepted();
        for (const body of ['{', undefined]) {
            const req = new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' }, body });
            expect((await handleInvitation(req, config, send)).status).toBe(400);
        }
        expect(send).not.toHaveBeenCalled();
    });
    it('bounds body bytes even without Content-Length', async () => {
        const send = accepted();
        expect((await handleInvitation(request({ ...payload, text: 'x'.repeat(17000) }), config, send)).status).toBe(413);
        expect(send).not.toHaveBeenCalled();
    });
    it.each([400, 401, 429, 500])('does not report success for provider status %s or leak its body', async status => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-provider-details', { status }));
        const response = await handleInvitation(request(), config, send);
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: UIStrings.text.invitationProviderFailed });
    });
    it.each([{}, null, { id: '' }, { id: 123 }])('requires a provider email ID %#', async body => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
        const response = await handleInvitation(request(), config, send);
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: UIStrings.text.invitationProviderFailed });
    });
    it('handles network failure and invalid provider JSON without leaking secrets', async () => {
        for (const send of [vi.fn<typeof fetch>().mockRejectedValue(new Error('test-resend')), vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid-json'))]) {
            const response = await handleInvitation(request(), config, send);
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({ error: UIStrings.text.invitationProviderFailed });
        }
    });
    it('aborts a stalled delivery after the real eight-second deadline and returns 502', async () => {
        let deliverySignal: AbortSignal | undefined;
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        const send = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
            deliverySignal = options?.signal as AbortSignal;
            deliverySignal.addEventListener('abort', () => reject(deliverySignal?.reason), { once: true });
        }));
        try {
            const response = await handleInvitation(request(), config, send);
            expect(timeout).toHaveBeenCalledWith(8000);
            expect(deliverySignal?.aborted).toBe(true);
            expect(deliverySignal?.reason.name).toBe('TimeoutError');
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({ error: UIStrings.text.invitationProviderFailed });
        } finally { timeout.mockRestore(); }
    }, 15000);
});
