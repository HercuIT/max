import { darkLogoSvg, lightLogoSvg } from './brand.ts';
import { UIStrings } from './ui-strings.ts';

export const tokenUsageDashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${UIStrings.text.appName} — ${UIStrings.text.tokenUsage}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script>(function(){let theme;try{theme=localStorage.getItem('burnrate-theme')}catch{}if(theme!=='dark'&&theme!=='light')theme=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=theme})();</script><style>
:root {
  color-scheme:dark;
  --surface-100:#0B0C10;
  --surface-200:#15171D;
  --surface-300:#1F222A;
  --border:#2A2E38;
  --border-strong:#5A6070;
  --ink:#F3F1EE;
  --muted:#9BA1AD;
  --brand-text:#FF8A4C;
  --action:#FF6A1F;
  --on-action:#111318;
  --success:#4ADE80;
  --danger:#F87171;
}
@media(prefers-color-scheme:light) {
  :root:not([data-theme=dark]) {
  color-scheme:light;
  --surface-100:#FAF8F5;
  --surface-200:#FFFFFF;
  --surface-300:#F1EDE7;
  --border:#E3DED6;
  --border-strong:#8C8478;
  --ink:#111318;
  --muted:#5B606B;
  --brand-text:#C2410C;
  --action:#C2410C;
  --on-action:#FFFFFF;
  --success:#15803D;
  --danger:#B91C1C;
}
}
:root[data-theme=light] {
  color-scheme:light;
  --surface-100:#FAF8F5;
  --surface-200:#FFFFFF;
  --surface-300:#F1EDE7;
  --border:#E3DED6;
  --border-strong:#8C8478;
  --ink:#111318;
  --muted:#5B606B;
  --brand-text:#C2410C;
  --action:#C2410C;
  --on-action:#FFFFFF;
  --success:#15803D;
  --danger:#B91C1C;
}
* {
  box-sizing:border-box
}
 [hidden] {
  display:none!important
}
body {
  margin:0;
  background:var(--surface-100);
  color:var(--ink);
  font:14px/1.5 Inter,Arial,sans-serif
}
header,main {
  width:min(1600px,100%);
  margin:auto;
  padding:24px 32px
}
header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  border-bottom:1px solid var(--border)
}
.wordmark {
  min-width:0
}
.logo {
  width:256px;
  height:64px;
  display:block;
  max-width:100%
}
.logo-light {
  display:none
}
:root[data-theme=light] .logo-light {
  display:block
}
:root[data-theme=light] .logo-dark {
  display:none
}
.header-tools,nav,.tabs,.chart-toggle {
  display:flex;
  align-items:center;
  gap:12px;
  flex-wrap:wrap
}
.header-tools {
  justify-content:flex-end
}
#updated {
  font-size:12px;
  color:var(--muted)
}
h1,h2 {
  font-family:'Space Grotesk',Arial,sans-serif;
  line-height:1.2
}
h1 {
  font-size:32px;
  margin:8px 0
}
h2 {
  font-size:20px;
  margin:0 0 20px
}
.subtitle,.hint,small {
  color:var(--muted)
}
.subtitle {
  margin:0 0 24px
}
.hint {
  font-size:12px
}
.tabs {
  margin:24px 0 12px
}
nav {
  margin:16px 0
}
a {
  color:var(--brand-text)
}
button,input,select {
  font:inherit;
  min-height:40px;
  border:1px solid var(--border-strong);
  border-radius:6px;
  background:var(--surface-200);
  color:var(--ink);
  padding:8px 12px;
  max-width:100%
}
button {
  border-radius:10px;
  cursor:pointer;
  font-weight:600
}
button:hover {
  background:var(--surface-300)
}
button.active,#apply,#retry {
  background:var(--action);
  color:var(--on-action);
  border-color:var(--action)
}
button:disabled {
  cursor:wait
}
summary:focus-visible,a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible {
  outline:3px solid var(--brand-text);
  outline-offset:3px
}
.filter-panel {
  position:sticky;
  top:0;
  z-index:3;
  background:var(--surface-200);
  border-radius:10px
}
.filter-panel>summary {
  display:none
}
.filters {
  display:flex;
  flex-wrap:wrap;
  align-items:flex-end;
  gap:12px;
  padding:16px;
  margin:24px 0 0;
  background:var(--surface-200);
  border:1px solid var(--border);
  border-radius:10px
}
.field {
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:0;
  flex:1 1 120px
}
.field label {
  font-size:12px;
  color:var(--muted)
}
.field:has(#projects) {
  flex-basis:192px
}
select[multiple] {
  height:80px;
  width:100%
}
#clearProjects {
  min-height:28px;
  padding:4px 8px;
  font-size:12px
}
input[type=datetime-local] {
  width:100%;
  min-width:0
}
.active-filters {
  flex-basis:100%;
  margin:0;
  padding-top:12px;
  border-top:1px solid var(--border);
  font-size:12px;
  color:var(--muted);
  overflow-wrap:anywhere
}
.workspace-bar {
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:16px;
  flex-wrap:wrap
}
.workspace-bar>.field {
  max-width:320px
}
.workspace-bar nav {
  margin:0
}
.table-toolbar h2 {
  margin:0 auto 0 0
}
.kpis {
  margin-bottom:24px
}
.kpis .card {
  margin-bottom:0
}
#updated {
  font-family:JetBrains Mono,monospace;
  font-variant-numeric:tabular-nums
}
.status-line {
  display:flex;
  align-items:center;
  gap:12px;
  min-height:48px
}
#status {
  color:var(--muted)
}
.kpis {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:16px
}
.card {
  border:1px solid var(--border);
  border-radius:10px;
  padding:24px;
  margin-bottom:24px;
  background:var(--surface-200);
  min-width:0
}
.kpis .card {
  padding:20px
}
.kpis span,.kpis small {
  display:block;
  font-size:12px
}
.kpis strong {
  display:block;
  font:500 clamp(24px,3vw,40px)/1.4 'JetBrains Mono',monospace;
  margin:12px 0;
  font-variant-numeric:tabular-nums
}
.kpis small {
  min-height:36px
}
.tab-pane {
  display:none
}
.tab-pane.active {
  display:block
}
.chart-wrap {
  position:relative;
  height:320px
}
.legend {
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-bottom:16px
}
.legend button {
  font-size:12px;
  min-height:36px;
  font-weight:400;
  display:flex;
  align-items:center;
  gap:8px
}
.swatch {
  width:12px;
  height:12px;
  border-radius:3px;
  display:inline-block
}
.legend [aria-pressed=false] {
  text-decoration:line-through
}
.chart-toggle {
  margin-bottom:16px
}
.table-scroll {
  overflow:auto;
  max-height:560px;
  border:1px solid var(--border);
  border-radius:6px
}
table {
  width:100%;
  min-width:1100px;
  border-collapse:separate;
  border-spacing:0;
  font-size:12px
}
th,td {
  padding:12px;
  text-align:right;
  border-bottom:1px solid var(--border);
  white-space:nowrap
}
td {
  font-family:'JetBrains Mono',monospace;
  font-variant-numeric:tabular-nums
}
th:first-child,td:first-child {
  text-align:left
}
td:first-child {
  font-family:Inter,Arial,sans-serif;
  white-space:normal;
  overflow-wrap:anywhere;
  min-width:180px;
  max-width:280px
}
thead {
  position:sticky;
  top:0;
  z-index:1;
  background:var(--surface-200)
}
th {
  cursor:pointer;
  color:var(--muted)
}
th button {
  border:0;
  background:transparent;
  padding:4px;
  min-height:32px;
  font-size:12px;
  color:inherit
}
th.sorted {
  color:var(--ink)
}
tbody tr:hover {
  background:var(--surface-300)
}
.project-link {
  padding:0;
  min-height:32px;
  border:0;
  background:transparent;
  color:var(--brand-text);
  text-align:left;
  overflow-wrap:anywhere;
  max-width:240px
}
.share {
  display:block;
  width:100%;
  height:4px;
  background:var(--surface-300);
  margin-top:8px;
  border-radius:6px;
  overflow:hidden
}
.share i {
  display:block;
  height:100%;
  background:var(--action)
}
.filter-input {
  width:100%;
  font-size:12px;
  padding:4px;
  min-height:32px
}
.range {
  display:flex;
  gap:4px
}
.range input {
  width:50%;
  min-width:48px
}
.table-toolbar {
  display:flex;
  justify-content:flex-end;
  margin-bottom:12px
}
.table-toolbar button {
  font-size:12px;
  min-height:32px
}
.filter-row td {
  padding:4px 8px
}
body.loading .kpis strong {
  color:transparent;
  background:var(--surface-300);
  border-radius:6px;
  animation:pulse 1s ease-in-out infinite alternate
}
body.loading .tab-pane.active .chart-wrap:after,body.loading .tab-pane.active .table-scroll:after {
  content:'';
  position:absolute;
  inset:0;
  background:var(--surface-300);
  animation:pulse 1s ease-in-out infinite alternate
}
.table-scroll {
  position:relative
}
body.loading .table-scroll {
  min-height:160px
}
body.loading .tab-pane.active table {
  visibility:hidden
}
body.failed .tab-pane.active,body.failed .kpis {
  display:none
}
@keyframes pulse {
  to {
  opacity:.45
}
}
@media(prefers-reduced-motion:reduce) {
  * {
  animation:none!important
}
}
@media(max-width:800px) {
  header,main {
  padding:16px
}
.kpis {
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px
}
.filter-panel {
  border:1px solid var(--border);
  margin-top:16px
}
.filter-panel>summary {
  display:list-item;
  cursor:pointer;
  padding:12px 16px;
  font-weight:600
}
.filter-panel[open] {
  max-height:70vh;
  overflow:auto
}
.filter-panel .filters {
  border:0;
  margin:0
}
.filter-panel>summary span {
  display:block;
  font-size:11px;
  color:var(--muted);
  font-weight:400;
  overflow-wrap:anywhere
}
.card {
  padding:16px
}
.field {
  flex-basis:calc(50% - 12px)
}
.field:has(#projects) {
  flex-basis:calc(50% - 12px)
}
.header-tools {
  gap:8px
}
#updated {
  width:100%
}
.logo {
  width:200px
}
.chart-wrap {
  height:280px
}
}
@media(max-width:420px) {
  header {
  align-items:flex-start;
  gap:8px
}
.logo {
  width:172px;
  height:44px
}
.header-tools {
  max-width:150px;
  font-size:12px
}
.header-tools button {
  font-size:12px;
  min-height:36px
}
#updated {
  font-size:10px
}
.kpis .card {
  padding:12px
}
.kpis strong {
  font-size:24px
}
.kpis small {
  font-size:11px
}
h1 {
  font-size:28px
}
.filters {
  padding:12px;
  gap:8px
}
.workspace-bar>.field {
  max-width:none
}
.field {
  flex-basis:100%
}
.field:has(#projects) {
  flex-basis:100%
}
.legend button {
  padding:4px 8px
}
main>select {
  width:100%
}
}
</style>
</head>
<body>
  <header><div class="wordmark">${lightLogoSvg}
  ${darkLogoSvg}
  </div><div class="header-tools"><span id="updated">${UIStrings.text.notUpdated}</span><button id="theme" type="button">${UIStrings.text.toggleTheme}</button></div></header>
  <main><h1>${UIStrings.text.tokenUsage}</h1><p class="subtitle">${UIStrings.text.dashboardSubtitle}</p>

  <div class="workspace-bar"><div class="field"><label for="tenant">${UIStrings.text.organization}</label><select id="tenant"></select></div><nav><a href="/settings">${UIStrings.text.organizationSettings}</a> <button id="signout" type="button">${UIStrings.text.signOut}</button></nav></div>
  <p class="muted" id="modelCoverage">${UIStrings.text.modelCoverage}</p>
  <div class="tabs" role="group" aria-label="${UIStrings.text.dashboard}">
    <button class="tab active" data-tab="tokens" aria-pressed="true">${UIStrings.text.tokenUsage}</button>
    <button class="tab" data-tab="cost" aria-pressed="false">${UIStrings.text.costUsd}</button>
  </div>

  <p class="hint">${UIStrings.text.codexCostNotice}</p>
  <details id="filterPanel" class="filter-panel" open><summary>${UIStrings.text.dashboardFilters}<span id="mobileFilterSummary"></span></summary><section class="filters" aria-label="${UIStrings.text.dashboardFilters}">
    <div class="field">
      <label for="source">${UIStrings.text.telemetrySource}</label>
      <select id="source">
        <option value="">${UIStrings.text.allSources}</option>
        <option value="claude">${UIStrings.text.claude}</option>
        <option value="codex">${UIStrings.text.codex}</option>
      </select>
    </div>
    <div class="field">
      <label for="projects">${UIStrings.text.projectsFilter}</label>
      <select id="projects" multiple></select>
      <button id="clearProjects" type="button">${UIStrings.text.allProjects}</button>
    </div>
    <div class="field"><label for="preset">${UIStrings.text.dateRange}</label><select id="preset"><option value="24">${UIStrings.text.range24h}</option><option value="168" selected>${UIStrings.text.range7d}</option><option value="720">${UIStrings.text.range30d}</option><option value="custom">${UIStrings.text.custom}</option><option value="all">${UIStrings.text.allTime}</option></select></div>
    <div class="field">
      <label for="start">${UIStrings.text.start}</label>
      <input id="start" type="datetime-local" />
    </div>
    <div class="field">
      <label for="end">${UIStrings.text.end}</label>
      <input id="end" type="datetime-local" />
    </div>
    <div class="field">
      <label for="bucket">${UIStrings.text.bucket}</label>
      <select id="bucket">
        <option value="hour">${UIStrings.text.hour}</option>
        <option value="day" selected>${UIStrings.text.day}</option>
        <option value="week">${UIStrings.text.week}</option>
      </select>
    </div>
    <button id="apply">${UIStrings.text.apply}</button>
    <p id="activeFilters" class="active-filters"></p>
  </section></details>

  <div class="status-line"><div id="status" role="status" aria-live="polite"></div><button id="retry" type="button" hidden>${UIStrings.text.retry}</button></div>
  <section id="kpis" class="kpis" aria-label="${UIStrings.text.usageSummary}">
    <div class="card"><span>${UIStrings.text.totalTokens}</span><strong id="kpiTokens">—</strong><small>${UIStrings.text.selectedRange}</small></div>
    <div class="card"><span>${UIStrings.text.reportedCost}</span><strong id="kpiCost">—</strong><small id="costHint">${UIStrings.text.costCoverage}</small></div>
    <div class="card"><span>${UIStrings.text.projectSessions}</span><strong id="kpiSessions">—</strong><small>${UIStrings.text.sessionsHint}</small></div>
    <div class="card"><span>${UIStrings.text.periodChange}</span><strong id="kpiChange">—</strong><small id="changeHint">${UIStrings.text.previousPeriod}</small></div>
  </section>
  <section id="empty" class="card" hidden><h2>${UIStrings.text.noRangeData}</h2><p>${UIStrings.text.emptyRangeHint}</p><p id="exportHint"></p></section>

  <div id="pane-tokens" class="tab-pane active">
    <div class="card">
      <h2>${UIStrings.text.tokensOverTime}</h2><div id="legend" class="legend" role="group" aria-label="${UIStrings.text.tokenSeries}"></div><div class="chart-wrap"><canvas id="chart" role="img" aria-label="${UIStrings.text.tokensOverTime}"></canvas></div>
    </div>

    <div class="card">
      <div class="table-toolbar"><h2>${UIStrings.text.projects}</h2>
        <button id="clearTableFilters" type="button">${UIStrings.text.clearFilters}</button>
      </div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="${UIStrings.text.tokenUsage}"><table id="table">
        <thead>
          <tr>
            <th data-key="project_name">${UIStrings.text.project}</th>
            <th data-key="input_tokens">${UIStrings.text.input}</th>
            <th data-key="output_tokens">${UIStrings.text.output}</th>
            <th data-key="cache_read_tokens">${UIStrings.text.cacheRead}</th>
            <th data-key="cache_write_tokens">${UIStrings.text.cacheWrite}</th>
            <th data-key="total_tokens" class="sorted">${UIStrings.text.totalTokens}</th>
            <th data-key="sessions">${UIStrings.text.sessions}</th>
            <th data-key="last_active">${UIStrings.text.lastActive}</th>
          </tr>
          <tr class="filter-row">
            <td><input class="filter-input" type="text" data-key="project_name" data-filter="text" placeholder="${UIStrings.text.filter}" /></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="input_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="input_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="output_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="output_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="cache_read_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="cache_read_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="cache_write_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="cache_write_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="total_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="total_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="sessions" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="sessions" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="date" data-key="last_active" data-filter="from" /><input class="filter-input" type="date" data-key="last_active" data-filter="to" /></div></td>
          </tr>
        </thead>
        <tbody></tbody>
      </table></div>
    </div>
  </div>

  <div id="pane-cost" class="tab-pane">
    <div class="chart-toggle">
      <button class="active" data-mode="bar" aria-pressed="true">${UIStrings.text.byProject}</button>
      <button data-mode="line" aria-pressed="false">${UIStrings.text.trend}</button>
    </div>

    <div class="card">
      <h2>${UIStrings.text.costUsd}</h2><div id="costLegend" class="legend" role="group" aria-label="${UIStrings.text.costUsd}"></div><div class="chart-wrap"><canvas id="costChart" role="img" aria-label="${UIStrings.text.costUsd}"></canvas></div>
    </div>

    <div class="card">
      <div class="table-toolbar"><h2>${UIStrings.text.projects}</h2>
        <button id="clearCostFilters" type="button">${UIStrings.text.clearFilters}</button>
      </div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="${UIStrings.text.costUsd}"><table id="costTable">
        <thead>
          <tr>
            <th data-key="project_name">${UIStrings.text.project}</th>
            <th data-key="total_cost_usd" class="sorted">${UIStrings.text.totalCostUsd}</th>
            <th data-key="total_tokens">${UIStrings.text.totalTokens}</th>
            <th data-key="cost_per_1k_tokens">${UIStrings.text.costPer1kTokens}</th>
            <th data-key="sessions">${UIStrings.text.sessions}</th>
            <th data-key="last_active">${UIStrings.text.lastActive}</th>
          </tr>
          <tr class="filter-row">
            <td><input class="filter-input" type="text" data-key="project_name" data-filter="text" placeholder="${UIStrings.text.filter}" /></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="total_cost_usd" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="total_cost_usd" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="total_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="total_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="cost_per_1k_tokens" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="cost_per_1k_tokens" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="sessions" data-filter="min" placeholder="${UIStrings.text.min}" /><input class="filter-input" type="number" data-key="sessions" data-filter="max" placeholder="${UIStrings.text.max}" /></div></td>
            <td><div class="range"><input class="filter-input" type="date" data-key="last_active" data-filter="from" /><input class="filter-input" type="date" data-key="last_active" data-filter="to" /></div></td>
          </tr>
        </thead>
        <tbody></tbody>
      </table></div>
    </div>
  </div>

</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
(function () {
  ${UIStrings.browserScript()}
  const tenantSelect = document.getElementById('tenant');
  let activeTenant = '';
  let csrf = '';
  let controller = new AbortController();
  const sourceSelect = document.getElementById('source');
  const sourceByTab = { tokens: '', cost: '' };
  const projectsSelect = document.getElementById('projects');
  const selectedProjectNames = new Set();
  const startInput = document.getElementById('start');
  const endInput = document.getElementById('end');
  const bucketSelect = document.getElementById('bucket');
  const applyButton = document.getElementById('apply');
  const statusEl = document.getElementById('status');
  const tableBody = document.querySelector('#table tbody');
  const tableHead = document.querySelector('#table thead');
  const costTableBody = document.querySelector('#costTable tbody');
  const costTableHead = document.querySelector('#costTable thead');

  let chart = null;
  let tableRows = [];
  const tokenSort = { key: 'total_tokens', dir: -1 };
  const tokenFilters = {};
  const TOKEN_COLUMNS = [
    { key: 'project_name', type: 'text' },
    { key: 'input_tokens', type: 'number' },
    { key: 'output_tokens', type: 'number' },
    { key: 'cache_read_tokens', type: 'number' },
    { key: 'cache_write_tokens', type: 'number' },
    { key: 'total_tokens', type: 'number' },
    { key: 'sessions', type: 'number' },
    { key: 'last_active', type: 'date' },
  ];

  let activeTab = 'tokens';
  let requestVersion = 0;
  const rangeByTab = { tokens: null, cost: null };
  let costChart = null;
  let costChartMode = 'bar';
  let costRows = [];
  let costSeries = [];
  const costSort = { key: 'total_cost_usd', dir: -1 };
  const costFilters = {};
  const COST_COLUMNS = [
    { key: 'project_name', type: 'text' },
    { key: 'total_cost_usd', type: 'number' },
    { key: 'total_tokens', type: 'number' },
    { key: 'cost_per_1k_tokens', type: 'number' },
    { key: 'sessions', type: 'number' },
    { key: 'last_active', type: 'date' },
  ];

  const PROJECT_COLORS = ['#FF6A1F', '#FFB627', '#3B82F6', '#8B93A1'];
  function colorFor(index) {
    return PROJECT_COLORS[index % PROJECT_COLORS.length];
  }

  const hiddenSeries = new Set();
  let tokenBuckets = [];
  const seriesKeys = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
  const presetByTab = { tokens: '168', cost: 'all' };
  const compact = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const themeButton = document.getElementById('theme');
  const systemTheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  let manualTheme = false;
  try { manualTheme = ['light', 'dark'].includes(localStorage.getItem('burnrate-theme')); } catch { /* Optional preference. */ }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.textContent = theme === 'dark' ? UI.lightTheme : UI.darkTheme;
    themeButton.setAttribute('aria-label', themeButton.textContent);
    if (chart) { chart.options = chartOptions(true); if (chart.update) chart.update(); }
    if (costChart) { costChart.options = chartOptions(false); if (costChart.update) costChart.update(); }
  }
  themeButton.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    manualTheme = true;
    try { localStorage.setItem('burnrate-theme', theme); } catch { /* Optional preference. */ }
    setTheme(theme);
  });
  if (systemTheme) systemTheme.addEventListener('change', e => { if (!manualTheme) setTheme(e.matches ? 'light' : 'dark'); });
  setTheme(document.documentElement.dataset.theme || 'dark');

  function chartOptions(stacked) {
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--ink').trim();
    const muted = style.getPropertyValue('--muted').trim();
    const border = style.getPropertyValue('--border').trim();
    const mono = { family: 'JetBrains Mono, monospace', size: 11 };
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false, labels: { color: ink, font: { family: 'Inter' } } },
        tooltip: { backgroundColor: style.getPropertyValue('--surface-200').trim(), titleColor: ink, bodyColor: ink,
          borderColor: border, borderWidth: 1, bodyFont: mono, padding: 12,
          callbacks: { title: items => stacked && items.length ? new Date(tokenBuckets[items[0].dataIndex]).toLocaleString() : items[0]?.label, label: ctx => ctx.dataset.label + ': ' + (stacked ? Number(ctx.parsed.y).toLocaleString() : formatUsd(ctx.parsed.y)) } },
      },
      scales: {
        x: { stacked, grid: { display: false }, ticks: { color: muted, font: mono, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { stacked, beginAtZero: true, border: { display: false }, grid: { color: border }, ticks: { color: muted, font: mono, callback: value => stacked ? compact(value) : formatUsd(value) } },
      },
    };
  }
  function renderLegend() {
    const legend = document.getElementById('legend'); legend.innerHTML = '';
    chart.data?.datasets.forEach((dataset, index) => {
      const button = document.createElement('button'); button.type = 'button';
      const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.backgroundColor = dataset.backgroundColor;
      button.appendChild(swatch); button.appendChild(document.createTextNode(dataset.label));
      button.setAttribute('aria-pressed', String(!hiddenSeries.has(seriesKeys[index])));
      button.addEventListener('click', () => {
        const key = seriesKeys[index]; if (hiddenSeries.has(key)) hiddenSeries.delete(key); else hiddenSeries.add(key);
        chart.setDatasetVisibility(index, !hiddenSeries.has(key)); chart.update(); renderLegend();
      });
      legend.appendChild(button);
    });
  }
  function projectShare(row, rows) { const total = sum(rows, 'total_tokens'); return total ? Math.min(100, Math.max(0, Number(row.total_tokens) / total * 100)) : 0; }
  function bindProject(tr, name) {
    tr.addEventListener('click', e => {
      if (e.target.closest('input')) return;
      selectedProjectNames.clear(); selectedProjectNames.add(name);
      for (const option of projectsSelect.options) option.selected = option.value === name;
      refreshProjectsAndLoad();
    });
  }
  function clearDashboard(resetUpdated = false) {
    document.body.classList.remove('loading', 'failed');
    document.querySelector('main').setAttribute('aria-busy', 'false');
    for (const id of ['kpiTokens','kpiCost','kpiSessions','kpiChange']) { const el = document.getElementById(id); el.textContent = UI.missingValue; el.removeAttribute('title'); el.removeAttribute('aria-label'); }
    document.getElementById('empty').hidden = true;
    document.getElementById('retry').hidden = true;
    if (resetUpdated) document.getElementById('updated').textContent = UI.notUpdated;
    document.getElementById('activeFilters').textContent = '';
    document.getElementById('mobileFilterSummary').textContent = '';
    document.getElementById('changeHint').textContent = UI.previousPeriod;
    document.getElementById('costHint').textContent = UI.costCoverage;
  }
  function showError(message) {
    document.body.classList.remove('loading'); document.body.classList.add('failed');
    document.querySelector('main').setAttribute('aria-busy', 'false');
    statusEl.textContent = message; document.getElementById('retry').hidden = false;
  }
  function setFigure(id, value, formatter = compact) {
    const element = document.getElementById(id); element.textContent = formatter(value); element.title = Number(value).toLocaleString(); element.setAttribute('aria-label', element.title);
  }
  function updateSummary(tokens, cost, previous, optionalErrors) {
    const total = sum(tokens, 'total_tokens');
    setFigure('kpiTokens', total); setFigure('kpiSessions', sum(tokens, 'sessions'));
    const dollars = cost ? sum(cost, 'total_cost_usd') : 0;
    document.getElementById('kpiCost').textContent = dollars > 0 ? (dollars >= 1000 ? '$' + compact(dollars) : formatUsd(dollars)) : UI.missingValue;
    document.getElementById('kpiCost').title = dollars > 0 ? String(dollars) : UI.costCoverage;
    document.getElementById('costHint').textContent = cost ? UI.costCoverage : UI.costUnavailable;
    const baseline = previous ? sum(previous, 'total_tokens') : 0;
    document.getElementById('kpiChange').textContent = previous && baseline ? ((total - baseline) / baseline * 100).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1, signDisplay: 'exceptZero' }) + '%' : previous && total === 0 ? '0%' : UI.missingValue;
    document.getElementById('changeHint').textContent = previous && (baseline || total === 0) ? UI.previousPeriod : previous && total > 0 ? UI.noBaseline : UI.comparisonUnavailable;
    document.getElementById('empty').hidden = activeTab === 'tokens' ? tokens.length > 0 : Boolean(cost && cost.length > 0);
    document.getElementById('exportHint').textContent = sourceSelect.value === 'codex' ? UI.codexEmptyHint : UI.claudeEmptyHint;
    statusEl.textContent = optionalErrors.length ? optionalErrors.join(' ') : '';
    document.getElementById('retry').hidden = optionalErrors.length === 0;
    const updated = new Date(); document.getElementById('updated').textContent = uiText(UI.lastUpdated, { time: updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  }
  document.getElementById('preset').addEventListener('change', e => {
    const preset = e.target.value;
    if (preset === 'custom') { startInput.focus(); return; }
    if (preset === 'all') { startInput.value = ''; endInput.value = ''; }
    else { const end = new Date(); endInput.value = toLocalInputValue(end); startInput.value = toLocalInputValue(new Date(end.getTime() - Number(preset) * 3600000)); }
    refreshProjectsAndLoad();
  });

  function formatUsd(n) {
    const num = Number(n);
    return '$' + (num < 1 ? num.toFixed(4) : num.toFixed(2));
  }

  function toLocalInputValue(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function setDefaultRange() {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    startInput.value = toLocalInputValue(start);
    endInput.value = toLocalInputValue(end);
  }

  function rememberProjectSelection() {
    selectedProjectNames.clear();
    for (const option of projectsSelect.selectedOptions) selectedProjectNames.add(option.value);
  }

  projectsSelect.addEventListener('change', () => { rememberProjectSelection(); refreshProjectsAndLoad(); });
  document.getElementById('clearProjects').addEventListener('click', () => {
    selectedProjectNames.clear();
    for (const option of projectsSelect.options) option.selected = false;
    refreshProjectsAndLoad();
  });

  function selectedProjects() {
    return Array.from(selectedProjectNames);
  }

  function buildQuery(extra) {
    const params = new URLSearchParams();
    if (sourceSelect.value) params.set('source', sourceSelect.value);
    const projects = selectedProjects();
    if (projects.length > 0) params.set('projects', projects.join(','));
    if (startInput.value) params.set('start', new Date(startInput.value).toISOString());
    if (endInput.value) params.set('end', new Date(endInput.value).toISOString());
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params.toString();
  }

  async function fetchJson(url) {
    const scoped = url.startsWith('/api/token-usage/') || url.startsWith('/api/cost/');
    const target = scoped ? '/api/tenants/' + encodeURIComponent(activeTenant) + url.slice(4) : url;
    const res = await fetch(target, { signal: controller.signal });
    if (res.status === 401) { location.assign('/sign-in'); throw new Error(UI.signInRequired); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || uiText(UI.requestFailed, { status: res.status }));
    }
    return res.json();
  }

  async function loadProjects(version) {
    const { projects } = await fetchJson('/api/token-usage/projects?' + new URLSearchParams({ source: sourceSelect.value }));
    if (version !== requestVersion) return;
    // Read after the request: users can edit the current list while it loads.
    rememberProjectSelection();
    const available = new Set(projects);
    projectsSelect.innerHTML = '';
    // Keep selected names visible even when this source has no data for them.
    // Removing them would turn an empty intersection into an all-project query.
    for (const name of new Set([...projects, ...selectedProjectNames])) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = available.has(name) ? name : uiText(UI.noSourceData, { name });
      opt.selected = selectedProjectNames.has(name);
      projectsSelect.appendChild(opt);
    }
  }

  function formatBucket(value) { const date = new Date(value); return bucketSelect.value === 'hour' ? date.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : date.toLocaleDateString([], {month:'short',day:'numeric'}); }
  function renderChart(series) {
    tokenBuckets = series.map(row => row.bucket);
    const labels = tokenBuckets.map(formatBucket);
    const datasets = [
      { label: UI.input, key: 'input_tokens', color: '#FF6A1F' },
      { label: UI.output, key: 'output_tokens', color: '#FFB627' },
      { label: UI.cacheRead, key: 'cache_read_tokens', color: '#3B82F6' },
      { label: UI.cacheCreation, key: 'cache_write_tokens', color: '#8B93A1' },
    ].map((d) => ({
      label: d.label,
      data: series.map((row) => Number(row[d.key])),
      backgroundColor: d.color,
      stack: 'tokens',
      hidden: hiddenSeries.has(d.key),
    }));

    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('chart'), {
      type: 'bar',
      data: { labels, datasets },
      options: chartOptions(true),
    });
    renderLegend();
  }

  function rowMatchesFilters(row, filters, columns) {
    for (const col of columns) {
      const f = filters[col.key];
      if (!f) continue;
      if (col.type === 'text') {
        if (f.text && !String(row[col.key]).toLowerCase().includes(f.text.toLowerCase())) return false;
      } else if (col.type === 'number') {
        const v = Number(row[col.key]);
        if (f.min !== undefined && f.min !== '' && v < Number(f.min)) return false;
        if (f.max !== undefined && f.max !== '' && v > Number(f.max)) return false;
      } else if (col.type === 'date') {
        const v = row[col.key] ? new Date(row[col.key]) : null;
        if (f.from) {
          if (!v || v < new Date(f.from)) return false;
        }
        if (f.to) {
          const to = new Date(f.to);
          to.setHours(23, 59, 59, 999);
          if (!v || v > to) return false;
        }
      }
    }
    return true;
  }

  function applyFilters(rows, filters, columns) {
    return rows.filter((row) => rowMatchesFilters(row, filters, columns));
  }

  function sortRows(rows, sort) {
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      return av > bv ? sort.dir : -sort.dir;
    });
  }

  function updateSortHeader(head, sort) {
    head.querySelectorAll('tr:first-child th').forEach((th) => {
      const isSorted = th.dataset.key === sort.key;
      th.classList.toggle('sorted', isSorted);
      const arrow = isSorted ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
      th.setAttribute('aria-sort', isSorted ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
      th.querySelector('button').textContent = th.dataset.label + arrow;
    });
  }

  function attachSort(head, sort, render) {
    head.querySelectorAll('tr:first-child th').forEach((th) => {
      th.dataset.label = th.textContent;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = th.textContent; th.textContent = ''; th.appendChild(button);
    });
    head.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th || !th.dataset.key || !e.target.closest('button')) return;
      sort.dir = th.dataset.key === sort.key ? -sort.dir : -1;
      sort.key = th.dataset.key;
      render();
    });
  }

  function attachFilterRow(head, filters, render) {
    const filterRow = head.querySelector('tr.filter-row');
    filterRow.querySelectorAll('input').forEach(input => { const column = head.querySelector('th[data-key="' + input.dataset.key + '"]'); input.setAttribute('aria-label', column.dataset.label + ': ' + (input.placeholder || input.dataset.filter)); });
    let debounceTimer = null;
    filterRow.addEventListener('input', (e) => {
      const input = e.target.closest('input');
      if (!input) return;
      filters[input.dataset.key] = filters[input.dataset.key] || {};
      filters[input.dataset.key][input.dataset.filter] = input.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(render, 150);
    });
    return filterRow;
  }

  function clearFilters(filterRow, filters, render) {
    filterRow.querySelectorAll('input').forEach((input) => { input.value = ''; });
    Object.keys(filters).forEach((key) => delete filters[key]);
    render();
  }

  function escapeHtml(value) { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; }

  function renderTable() {
    const filtered = applyFilters(tableRows, tokenFilters, TOKEN_COLUMNS);
    const sorted = sortRows(filtered, tokenSort);
    tableBody.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const lastActive = row.last_active ? new Date(row.last_active).toLocaleString() : UI.missingValue;
      tr.innerHTML =
        '<td><button type="button" class="project-link">' + escapeHtml(row.project_name) + '</button><span class="share" aria-hidden="true"><i style="width:' + projectShare(row, tableRows) + '%"></i></span></td>' +
        '<td>' + Number(row.input_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.output_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.cache_read_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.cache_write_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.total_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.sessions).toLocaleString() + '</td>' +
        '<td>' + lastActive + '</td>';
      bindProject(tr, row.project_name);
      tableBody.appendChild(tr);
    }
    updateSortHeader(tableHead, tokenSort);
  }

  attachSort(tableHead, tokenSort, renderTable);
  const tableFilterRow = attachFilterRow(tableHead, tokenFilters, renderTable);
  document.getElementById('clearTableFilters').addEventListener('click', () => clearFilters(tableFilterRow, tokenFilters, renderTable));

  function renderCostBarChart() {
    if (costChart) costChart.destroy();
    costChart = new Chart(document.getElementById('costChart'), {
      type: 'bar',
      data: {
        labels: costRows.map((r) => r.project_name),
        datasets: [{
          label: UI.totalCostUsd,
          data: costRows.map((r) => Number(r.total_cost_usd)),
          backgroundColor: costRows.map((_, i) => colorFor(i)),
        }],
      },
      options: chartOptions(false),
    });
  }

  function renderCostLineChart() {
    const projects = [...new Set(costSeries.map((r) => r.project_name))];
    const buckets = [...new Set(costSeries.map((r) => r.bucket))].sort();
    const datasets = projects.map((name, i) => ({
      label: name,
      data: buckets.map((b) => {
        const row = costSeries.find((r) => r.project_name === name && r.bucket === b);
        return row ? Number(row.cumulative_cost_usd) : null;
      }),
      borderColor: colorFor(i),
      fill: false,
    }));
    if (costChart) costChart.destroy();
    costChart = new Chart(document.getElementById('costChart'), {
      type: 'line',
      data: { labels: buckets.map(formatBucket), datasets },
      options: chartOptions(false),
    });
  }

  function renderCostChart() {
    if (costChartMode === 'bar') renderCostBarChart(); else renderCostLineChart();
    const legend = document.getElementById('costLegend'); legend.innerHTML = '';
    costChart.data?.datasets.forEach((dataset, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = dataset.label;
      button.setAttribute('aria-pressed', 'true');
      button.addEventListener('click', () => { const visible = button.getAttribute('aria-pressed') !== 'true'; button.setAttribute('aria-pressed', String(visible)); costChart.setDatasetVisibility(index, visible); costChart.update(); });
      legend.appendChild(button);
    });
  }

  function renderCostTable() {
    const filtered = applyFilters(costRows, costFilters, COST_COLUMNS);
    const sorted = sortRows(filtered, costSort);
    costTableBody.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const lastActive = row.last_active ? new Date(row.last_active).toLocaleString() : UI.missingValue;
      tr.innerHTML =
        '<td><button type="button" class="project-link">' + escapeHtml(row.project_name) + '</button><span class="share" aria-hidden="true"><i style="width:' + projectShare(row, costRows) + '%"></i></span></td>' +
        '<td>' + formatUsd(row.total_cost_usd) + '</td>' +
        '<td>' + Number(row.total_tokens).toLocaleString() + '</td>' +
        '<td>' + formatUsd(row.cost_per_1k_tokens) + '</td>' +
        '<td>' + Number(row.sessions).toLocaleString() + '</td>' +
        '<td>' + lastActive + '</td>';
      bindProject(tr, row.project_name);
      costTableBody.appendChild(tr);
    }
    updateSortHeader(costTableHead, costSort);
  }

  attachSort(costTableHead, costSort, renderCostTable);
  const costFilterRow = attachFilterRow(costTableHead, costFilters, renderCostTable);
  document.getElementById('clearCostFilters').addEventListener('click', () => clearFilters(costFilterRow, costFilters, renderCostTable));

  document.querySelectorAll('.chart-toggle button').forEach((b) => {
    b.addEventListener('click', () => {
      costChartMode = b.dataset.mode;
      document.querySelectorAll('.chart-toggle button').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      renderCostChart();
    });
  });

  function switchTab(tab) {
    if (tab === activeTab) return;
    sourceByTab[activeTab] = sourceSelect.value;
    presetByTab[activeTab] = document.getElementById('preset').value;
    rangeByTab[activeTab] = { start: startInput.value, end: endInput.value };
    activeTab = tab;
    sourceSelect.value = sourceByTab[tab];
    if (rangeByTab[tab]) {
      startInput.value = rangeByTab[tab].start;
      endInput.value = rangeByTab[tab].end;
    } else if (tab === 'tokens') {
      setDefaultRange();
    } else {
      startInput.value = '';
      endInput.value = '';
    }
    document.querySelector('h1').textContent = tab === 'tokens' ? UI.tokenUsage : UI.costUsd;
    document.querySelectorAll('.tab').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-pressed', String(b.dataset.tab === tab)); });
    document.getElementById('pane-tokens').classList.toggle('active', tab === 'tokens');
    document.getElementById('pane-cost').classList.toggle('active', tab === 'cost');
    document.getElementById('preset').value = presetByTab[tab];
    refreshProjectsAndLoad();
  }

  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  async function load(version) {
    const bucket = bucketSelect.value;
    const query = buildQuery();
    const tab = activeTab;
    const start = startInput.value ? new Date(startInput.value) : null;
    const end = endInput.value ? new Date(endInput.value) : null;
    const previousQuery = new URLSearchParams(query);
    if (start && end) { previousQuery.set('end', new Date(start.getTime() - 1).toISOString()); previousQuery.set('start', new Date(2 * start.getTime() - end.getTime() - 1).toISOString()); }
    // Capture all requests before awaiting; no request may inherit a later tenant's signal or filters.
    const requests = [
      fetchJson('/api/' + (tab === 'tokens' ? 'token-usage' : 'cost') + '/series?' + buildQuery({ bucket })),
      fetchJson('/api/token-usage/table?' + query),
      fetchJson('/api/cost/table?' + query),
      start && end ? fetchJson('/api/token-usage/table?' + previousQuery) : Promise.resolve(null),
    ];
    const results = await Promise.allSettled(requests);
    if (version !== requestVersion) return;
    const primaryTable = tab === 'tokens' ? results[1] : results[2];
    if (results[0].status === 'rejected' || primaryTable.status === 'rejected') {
      const failure = results[0].status === 'rejected' ? results[0].reason : primaryTable.reason;
      showError(uiText(UI.error, { error: failure.message })); return;
    }
    const optionalErrors = [];
    const tokens = results[1].status === 'fulfilled' ? results[1].value.rows : [];
    const costs = results[2].status === 'fulfilled' ? results[2].value.rows : null;
    const previous = results[3].status === 'fulfilled' && results[3].value ? results[3].value.rows : null;
    if (results[1].status === 'rejected') optionalErrors.push(UI.tokensUnavailable);
    if (results[2].status === 'rejected') optionalErrors.push(UI.costUnavailable);
    if (results[3].status === 'rejected') optionalErrors.push(UI.comparisonUnavailable);
    try {
      if (tab === 'tokens') { tableRows = tokens; renderTable(); renderChart(results[0].value.series); }
      else { costRows = costs; costSeries = results[0].value.series; renderCostTable(); renderCostChart(); }
      updateSummary(tokens, costs, previous, optionalErrors);
      if (results[1].status === 'rejected') {
        document.getElementById('kpiTokens').textContent = UI.missingValue;
        document.getElementById('kpiSessions').textContent = UI.missingValue;
        document.getElementById('kpiChange').textContent = UI.missingValue;
        for (const id of ['kpiTokens', 'kpiSessions']) { document.getElementById(id).removeAttribute('aria-label'); document.getElementById(id).removeAttribute('title'); }
      }
    } catch (error) { showError(uiText(UI.error, { error: error.message })); }
    finally { document.body.classList.remove('loading'); document.querySelector('main').setAttribute('aria-busy', 'false'); }
  }

  async function refreshProjectsAndLoad() {
    const version = ++requestVersion;
    controller.abort(); controller = new AbortController();
    clearDashboard();
    if (!activeTenant) { statusEl.textContent = UI.chooseOrganization; return; }
    const start = startInput.value ? new Date(startInput.value).getTime() : null;
    const end = endInput.value ? new Date(endInput.value).getTime() : null;
    if (!startInput.validity.valid || !endInput.validity.valid || (start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end)) || (start !== null && end !== null && start >= end)) {
      showError(UI.invalidDateRange); return;
    }
    document.body.classList.add('loading'); document.querySelector('main').setAttribute('aria-busy', 'true');
    statusEl.textContent = UI.loading;
    document.getElementById('activeFilters').textContent = [selectedProjects().join(', ') || UI.allProjects, sourceSelect.selectedOptions[0].textContent, startInput.value || UI.allTime, endInput.value || UI.now, bucketSelect.selectedOptions[0].textContent].join(' / ');
    document.getElementById('mobileFilterSummary').textContent = document.getElementById('activeFilters').textContent;
    try {
      await loadProjects(version);
      if (version !== requestVersion) return;
      await load(version);
    } catch (err) { if (version === requestVersion) showError(uiText(UI.loadFailed, { resource: UI.projects, error: err.message })); }
  }

  sourceSelect.addEventListener('change', () => {
    sourceByTab[activeTab] = sourceSelect.value;
    refreshProjectsAndLoad();
  });
  applyButton.addEventListener('click', refreshProjectsAndLoad);
  document.getElementById('retry').addEventListener('click', () => { if (activeTenant) refreshProjectsAndLoad(); else initialize(); });
  [startInput, endInput, bucketSelect].forEach(input => input.addEventListener('change', () => { if (input !== bucketSelect) document.getElementById('preset').value = 'custom'; refreshProjectsAndLoad(); }));

  if (typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches) document.getElementById('filterPanel').open = false;
  applyButton.addEventListener('click', () => { if (typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches) document.getElementById('filterPanel').open = false; });
  setDefaultRange();
  tenantSelect.addEventListener('change', () => {
    activeTenant = tenantSelect.value;
    clearDashboard(true);
    try { localStorage.setItem('burnrate-tenant', activeTenant); } catch { /* Remembering a tenant is optional. */ }
    ++requestVersion; controller.abort(); controller = new AbortController();
    selectedProjectNames.clear(); projectsSelect.innerHTML = '';
    tableRows = []; costRows = []; costSeries = [];
    tableBody.innerHTML = ''; costTableBody.innerHTML = ''; statusEl.textContent = '';
    if (chart) { chart.destroy(); chart = null; }
    if (costChart) { costChart.destroy(); costChart = null; }
    refreshProjectsAndLoad();
  });
  document.getElementById('signout').addEventListener('click', async () => {
    try {
      const res = await fetch('/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' });
      if (!res.ok) throw new Error(UI.signOutFailed);
      clearDashboard(); ++requestVersion; controller.abort(); tableBody.innerHTML = ''; costTableBody.innerHTML = '';
      if (chart) chart.destroy(); if (costChart) costChart.destroy();
      try { localStorage.removeItem('burnrate-tenant'); } catch { /* Optional remembered preference. */ }
      location.assign('/sign-in');
    } catch (error) { statusEl.textContent = error.message; }
  });
  async function initialize() {
    try {
      const session = await fetchJson('/api/session'); csrf = session.csrf;
      if (!session.signedIn) { location.assign('/sign-in'); return; }
      const { tenants } = await fetchJson('/api/tenants');
      if (!tenants.length) { statusEl.textContent = UI.noOrganizations; return; }
      let remembered = null;
      try { remembered = localStorage.getItem('burnrate-tenant'); } catch { /* Optional preference. */ }
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = UI.chooseOrganization;
      tenantSelect.innerHTML = ''; tenantSelect.appendChild(placeholder);
      for (const tenant of tenants) { const option = document.createElement('option'); option.value = tenant.id; option.textContent = tenant.name; tenantSelect.appendChild(option); }
      activeTenant = tenants.some(t => t.id === remembered) ? remembered : tenants.length === 1 ? tenants[0].id : '';
      tenantSelect.value = activeTenant;
      if (!activeTenant) statusEl.textContent = UI.chooseOrganization;
      else refreshProjectsAndLoad();
    } catch (error) { showError(uiText(UI.loadFailed, { resource: UI.organizations, error: error.message })); }
  }
  initialize();
})();
</script>
</body>
</html>
`;
