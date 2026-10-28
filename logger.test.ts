import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logError } from './logger';

describe('logError', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    function loggedEntry(): any {
        expect(errorSpy).toHaveBeenCalledTimes(1);
        return JSON.parse(errorSpy.mock.calls[0][0] as string);
    }

    it('serializes an Error with its message, context, level, and timestamp', () => {
        logError('handleIngest', new Error('db down'));
        const entry = loggedEntry();
        expect(entry).toMatchObject({ level: 'error', context: 'handleIngest', message: 'db down' });
        expect(typeof entry.timestamp).toBe('string');
        expect(() => new Date(entry.timestamp)).not.toThrow();
    });

    it('serializes a plain string error', () => {
        logError('ctx', 'plain failure');
        expect(loggedEntry().message).toBe('plain failure');
    });

    it('serializes an object with a message field (e.g. a Supabase error)', () => {
        logError('ctx', { message: 'relation does not exist', code: '42P01' });
        expect(loggedEntry().message).toBe('relation does not exist');
    });

    it('falls back to a generic message for unrecognized error shapes without throwing', () => {
        expect(() => logError('ctx', { weird: true })).not.toThrow();
        expect(loggedEntry().message).toBe('Unknown error');
    });

    it('never throws even for circular objects', () => {
        const circular: any = {};
        circular.self = circular;
        expect(() => logError('ctx', circular)).not.toThrow();
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('redacts a message that looks like it contains a bearer token', () => {
        logError('ctx', new Error('Unauthorized: Bearer abc123.def456 was rejected'));
        expect(loggedEntry().message).not.toContain('abc123.def456');
    });

    it('redacts a message mentioning a service role key or password', () => {
        logError('ctx', new Error('invalid service_role key supplied'));
        expect(loggedEntry().message).not.toContain('service_role key supplied');

        errorSpy.mockClear();
        logError('ctx', new Error('password mismatch for user'));
        expect(loggedEntry().message).not.toContain('password mismatch');
    });

    it('does not accept or echo request-shaped data: only context and err are ever logged', () => {
        logError('handleIngest', new Error('boom'));
        const entry = loggedEntry();
        expect(Object.keys(entry).sort()).toEqual(['context', 'level', 'message', 'timestamp']);
    });

    it('produces a single-line JSON string safe for any downstream log sink', () => {
        logError('ctx', new Error('line1\nline2'));
        const raw = errorSpy.mock.calls[0][0] as string;
        expect(() => JSON.parse(raw)).not.toThrow();
    });
});
