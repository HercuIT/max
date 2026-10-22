import { createClient } from '@supabase/supabase-js';

export interface Env {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    INGEST_SECRET_TOKEN: string;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
        }

        if (url.pathname !== '/v1/metrics' && url.pathname !== '/v1/logs') {
            return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
        }

        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.INGEST_SECRET_TOKEN}`) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        try {
            const payload: any = await request.json();

            if (url.pathname === '/v1/logs') {
                return new Response(JSON.stringify({ message: 'Logs acknowledged' }), { status: 200 });
            }

            // Initialize Supabase Client
            const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
                auth: { persistSession: false },
            });

            // Basic payload parser extracting metrics
            const recordsToInsert = [];
            const resourceMetrics = payload.resourceMetrics || [];

            for (const resMetric of resourceMetrics) {
                const resAttrs = resMetric.resource?.attributes || [];
                const projAttr = resAttrs.find((a: any) => a.key === 'project.name' || a.key === 'service.name');
                const projectName = projAttr?.value?.stringValue || 'default-project';

                for (const scopeMetric of resMetric.scopeMetrics || []) {
                    for (const metric of scopeMetric.metrics || []) {
                        const dps = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];
                        for (const dp of dps) {
                            const val = dp.asDouble ?? dp.asInt ?? 0;
                            recordsToInsert.push({
                                project_name: projectName,
                                session_id: 'active_session',
                                model: 'claude-3-5-sonnet',
                                input_tokens: metric.name.includes('input') ? val : 0,
                                output_tokens: metric.name.includes('output') ? val : 0,
                                total_cost_usd: metric.name.includes('cost') ? val : 0,
                            });
                        }
                    }
                }
            }

            if (recordsToInsert.length > 0) {
                await supabase.from('token_usage_logs').insert(recordsToInsert);
            }

            return new Response(JSON.stringify({ success: true, count: recordsToInsert.length }), { status: 200 });
        } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    },
};