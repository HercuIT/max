import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.toml' },
        }),
    ],
    test: {
        coverage: {
            provider: 'istanbul',
            // dashboard.ts is a plain-JS-in-a-template-string HTML page with no bundler
            // (see CLAUDE.md) — there's no Workers-side logic in it to unit test here.
            include: ['index.ts', 'auth.ts', 'http.ts', 'tenancy.ts', 'telemetry.ts', 'ui-strings.ts', 'logger.ts'],
            thresholds: {
                lines: 90,
                statements: 90,
                functions: 90,
                branches: 90,
            },
        },
    },
});
