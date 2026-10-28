export function findAttr(attrs: any[] | undefined, key: string): string | undefined {
    return attrs?.find((a) => a.key === key)?.value?.stringValue;
}

// Codex emits per-response usage as logs, not Claude-style token metrics.
// Read OTLP AnyValue strings and numbers (Rust tracing uses both).
function logAttribute(attributes: any[] | undefined, key: string): any {
    const value = attributes?.find((attribute) => attribute.key === key)?.value;
    return value?.stringValue ?? value?.intValue ?? value?.doubleValue;
}

function telemetryNumber(value: any): number {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        (typeof value === 'string' && value.trim() === '')) {
        throw new RangeError('Codex numeric attributes must contain a number.');
    }
    return Number(value);
}

function tokenCount(value: any): number {
    const count = value === undefined ? 0 : telemetryNumber(value);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError('Codex token counts must be non-negative safe integers.');
    }
    return count;
}

export function parseCodexLogs(payload: any, project: string | null) {
    const records = [];
    let rejectedLogRecords = 0;
    for (const resource of payload.resourceLogs ?? []) {
        for (const scope of resource.scopeLogs ?? []) {
            for (const log of scope.logRecords ?? []) {
                try {
                    const attr = (key: string) => logAttribute(log.attributes, key) ??
                        logAttribute(resource.resource?.attributes, key);
                    const event = attr('event.name') ?? log.eventName;
                    const completion = event === 'codex.sse_event' && attr('event.kind') === 'response.completed';
                    const cost = event === 'codex.turn_cost';
                    if ((!completion && !cost) || attr('error.message') !== undefined) continue;
                    // Generic response.completed notices also exist; only the usage-bearing event counts.
                    if (completion && attr('input_token_count') === undefined && attr('output_token_count') === undefined) continue;
                    if (cost && attr('usage.estimated_usd') === undefined) continue;
                    const input = completion ? tokenCount(attr('input_token_count')) : 0;
                    const cached = completion ? tokenCount(attr('cached_token_count')) : 0;
                    const cacheWrite = completion ? tokenCount(attr('cache_write_token_count')) : 0;
                    if (cached + cacheWrite > input) throw new RangeError('Codex cached tokens exceed input tokens.');
                    const usd = cost ? telemetryNumber(attr('usage.estimated_usd')) : 0;
                    if (!Number.isFinite(usd) || usd < 0) throw new RangeError('Codex estimated cost must be a non-negative number.');
                    records.push({
                        source: 'codex',
                        project_name: project || attr('vcs.repository.name') || attr('project.name') || 'codex',
                        session_id: attr('conversation.id') || 'unknown_session',
                        model: attr('model') || 'unknown_model',
                        // Codex input includes cached tokens; store disjoint categories like Claude.
                        input_tokens: input - cached - cacheWrite,
                        output_tokens: completion ? tokenCount(attr('output_token_count')) : 0,
                        cache_read_tokens: cached,
                        cache_write_tokens: cacheWrite,
                        total_cost_usd: usd,
                        host_name: attr('host.name') ?? null,
                        user_email: attr('user.email') ?? null,
                    });
                } catch (error) {
                    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
                    rejectedLogRecords++;
                }
            }
        }
    }
    return { records, rejectedLogRecords };
}


export function parseClaudeMetrics(payload: any) {
        const recordsToInsert = [];
        const resourceMetrics = payload.resourceMetrics || [];

        for (const resMetric of resourceMetrics) {
            const resAttrs = resMetric.resource?.attributes || [];

            for (const scopeMetric of resMetric.scopeMetrics || []) {
                for (const metric of scopeMetric.metrics || []) {
                    const dps = metric.sum?.dataPoints || metric.gauge?.dataPoints || [];
                    for (const dp of dps) {
                        const val = Number(dp.asDouble ?? dp.asInt ?? 0);
                        // vcs.repository.name is a data-point-level attribute (like session.id),
                        // not a resource attribute — unlike project.name/service.name below.
                        const projectName =
                            findAttr(dp.attributes, 'vcs.repository.name') ??
                            findAttr(resAttrs, 'project.name') ??
                            findAttr(resAttrs, 'service.name') ??
                            'default-project';
                        // host.name/user.email aren't reliably confirmed on one location yet
                        // (see specs/machine-and-user-attribution.md) — check both the
                        // data point and the resource block until that's verified against a
                        // real payload.
                        const record = {
                            source: 'claude',
                            project_name: projectName,
                            session_id: findAttr(dp.attributes, 'session.id') || 'active_session',
                            model: 'claude-3-5-sonnet',
                            input_tokens: 0,
                            output_tokens: 0,
                            cache_read_tokens: 0,
                            cache_write_tokens: 0,
                            total_cost_usd: 0,
                            host_name: findAttr(dp.attributes, 'host.name') ?? findAttr(resAttrs, 'host.name') ?? null,
                            user_email: findAttr(dp.attributes, 'user.email') ?? findAttr(resAttrs, 'user.email') ?? null,
                        };

                        if (metric.name === 'claude_code.token.usage') {
                            const type = findAttr(dp.attributes, 'type');
                            if (type === 'input') record.input_tokens = val;
                            else if (type === 'output') record.output_tokens = val;
                            else if (type === 'cacheRead') record.cache_read_tokens = val;
                            else if (type === 'cacheCreation') record.cache_write_tokens = val;
                            else continue;
                        } else if (metric.name === 'claude_code.cost.usage') {
                            record.total_cost_usd = val;
                        } else {
                            continue;
                        }

                        recordsToInsert.push(record);
                    }
                }
            }
        }

    return recordsToInsert;
}
