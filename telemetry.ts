import { UIStrings } from './ui-strings';
export interface UsageRecord {
    source: 'claude' | 'codex';
    project_name: string;
    session_id: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    total_cost_usd: number;
    host_name: string | null;
    user_email: string | null;
}

export const MAX_USAGE_ROWS = 5000;
export class TelemetryLimitError extends Error {
    constructor() { super(UIStrings.text.tooManyRows); }
}
function appendRecord<T>(records: T[], record: T, maxRows: number) {
    if (records.length >= maxRows) throw new TelemetryLimitError();
    records.push(record);
}
const NUMERIC_LOG_ATTRIBUTES = new Set([
    'input_token_count', 'output_token_count', 'cached_token_count',
    'cache_write_token_count', 'usage.estimated_usd',
]);

export function findAttr(attrs: any[] | undefined, key: string): string | undefined {
    return attrs?.find((a) => a.key === key)?.value?.stringValue;
}

// Codex emits per-response usage as logs, not Claude-style token metrics.
// Read OTLP AnyValue strings and numbers (Rust tracing uses both).
function logAttribute(attributes: any[] | undefined, key: string): any {
    const attribute = attributes?.find((attribute) => attribute.key === key);
    const value = attribute?.value;
    if (attribute && NUMERIC_LOG_ATTRIBUTES.has(key)) {
        const fields = value && typeof value === 'object' ? Object.keys(value) : [];
        if (fields.length !== 1 || !['stringValue', 'intValue', 'doubleValue'].includes(fields[0]) ||
            !['string', 'number'].includes(typeof value[fields[0]])) {
            throw new RangeError(UIStrings.text.invalidCodexNumber);
        }
    }
    return value?.stringValue ?? value?.intValue ?? value?.doubleValue;
}

function telemetryNumber(value: any): number {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        (typeof value === 'string' && value.trim() === '')) {
        throw new RangeError(UIStrings.text.invalidCodexNumber);
    }
    return Number(value);
}

function tokenCount(value: any): number {
    const count = value === undefined ? 0 : telemetryNumber(value);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError(UIStrings.text.invalidCodexTokens);
    }
    return count;
}

export function parseCodexLogs(payload: any, project: string | null, maxRows = MAX_USAGE_ROWS) {
    const records: UsageRecord[] = [];
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
                    if (cached + cacheWrite > input) throw new RangeError(UIStrings.text.invalidCachedTokens);
                    const usd = cost ? telemetryNumber(attr('usage.estimated_usd')) : 0;
                    if (!Number.isFinite(usd) || usd < 0) throw new RangeError(UIStrings.text.invalidCodexCost);
                    appendRecord(records, {
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
                    }, maxRows);
                } catch (error) {
                    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
                    rejectedLogRecords++;
                }
            }
        }
    }
    return { records, rejectedLogRecords };
}


export function parseClaudeMetrics(payload: any, maxRows = MAX_USAGE_ROWS) {
    const records: UsageRecord[] = [];
    let rejectedDataPoints = 0;
    for (const resource of payload.resourceMetrics ?? []) {
        const resourceAttributes = resource.resource?.attributes;
        for (const scope of resource.scopeMetrics ?? []) {
            for (const metric of scope.metrics ?? []) {
                if (metric.name !== 'claude_code.token.usage' && metric.name !== 'claude_code.cost.usage') continue;
                const tokenMetric = metric.name === 'claude_code.token.usage';
                for (const point of metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? []) {
                    const type = findAttr(point.attributes, 'type');
                    if (tokenMetric && !['input', 'output', 'cacheRead', 'cacheCreation'].includes(type ?? '')) continue;
                    const raw = point.asDouble ?? point.asInt ?? 0;
                    const value = Number(raw);
                    if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && raw.trim() === '') ||
                        !Number.isFinite(value) || value < 0 || (tokenMetric && !Number.isSafeInteger(value))) {
                        rejectedDataPoints++;
                        continue;
                    }
                    const record: UsageRecord = {
                        source: 'claude',
                        project_name: findAttr(point.attributes, 'vcs.repository.name') ??
                            findAttr(resourceAttributes, 'project.name') ?? findAttr(resourceAttributes, 'service.name') ?? 'default-project',
                        session_id: findAttr(point.attributes, 'session.id') || 'active_session',
                        model: 'claude-3-5-sonnet',
                        input_tokens: tokenMetric && type === 'input' ? value : 0,
                        output_tokens: tokenMetric && type === 'output' ? value : 0,
                        cache_read_tokens: tokenMetric && type === 'cacheRead' ? value : 0,
                        cache_write_tokens: tokenMetric && type === 'cacheCreation' ? value : 0,
                        total_cost_usd: tokenMetric ? 0 : value,
                        // README.md documents best-effort host/email attribution at either location.
                        host_name: findAttr(point.attributes, 'host.name') ?? findAttr(resourceAttributes, 'host.name') ?? null,
                        user_email: findAttr(point.attributes, 'user.email') ?? findAttr(resourceAttributes, 'user.email') ?? null,
                    };
                    appendRecord(records, record, maxRows);
                }
            }
        }
    }
    return { records, rejectedDataPoints };
}
