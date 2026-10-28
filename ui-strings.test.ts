import { describe, expect, it } from 'vitest';
import { UIStrings } from './ui-strings';
import { databaseError } from './http';

describe('shared UI copy', () => {
    it('keeps identical wording under a single reusable key', () => {
        const values = Object.values(UIStrings.text);
        expect(new Set(values).size).toBe(values.length);
        expect(Object.isFrozen(UIStrings.text)).toBe(true);
    });

    it('formats repeated parameters, numeric zero, and preserves unknown placeholders', () => {
        expect(UIStrings.format('{status}: {status} {unknown}', { status: 0 })).toBe('0: 0 {unknown}');
        expect(UIStrings.format('{name}', Object.create({ name: 'inherited' }))).toBe('{name}');
        expect(UIStrings.format(UIStrings.text.signIn)).toBe(UIStrings.text.signIn);
    });

    it('uses catalog text for known database domain failures', () => {
        expect(() => databaseError({ code: 'PT409', message: UIStrings.text.lastOwner })).toThrow(UIStrings.text.lastOwner);
        expect(() => databaseError({ code: 'PT404', message: UIStrings.text.memberNotFound })).toThrow(UIStrings.text.memberNotFound);
    });

    it('never surfaces arbitrary provider messages as application copy', () => {
        expect(UIStrings.databaseMessage()).toBe(UIStrings.text.requestRejected);
        expect(() => databaseError({ code: 'PT403', message: 'unexpected provider details' })).toThrow(UIStrings.text.requestRejected);
    });

    it('escapes script-closing sequences when serializing the browser catalog', () => {
        const script = UIStrings.browserScript({ text: '</script><script>injected()</script>' });
        expect(script).not.toContain('</script>');
        expect(script).toContain('\\u003c/script>');
    });
});
