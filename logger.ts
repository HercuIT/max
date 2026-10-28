// Shared server-side logger. Callers pass a short context string and the
// caught error only — never a Request/headers/payload object — so there is
// no call shape that could leak request data or credentials into logs.

const SENSITIVE_PATTERN = /(authorization|bearer|token|password|secret|service_role|api[_-]?key)/i;

function toSafeMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return 'Unknown error';
}

function redact(message: string): string {
    return SENSITIVE_PATTERN.test(message) ? '[redacted: message matched a sensitive-term pattern]' : message;
}

export function logError(context: string, err: unknown): void {
    const entry = {
        level: 'error',
        context,
        message: redact(toSafeMessage(err)),
        timestamp: new Date().toISOString(),
    };

    let line: string;
    try {
        line = JSON.stringify(entry);
    } catch {
        line = `${entry.level} ${entry.context} ${entry.message} ${entry.timestamp}`;
    }

    console.error(line);
}
