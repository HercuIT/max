export const tokenUsageDashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Token Usage Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js"></script>
<style>
  :root {
    color-scheme: light dark;
    --fg: #1a1a1a;
    --bg: #ffffff;
    --muted: #666666;
    --border: #e0e0e0;
    --accent: #5b5bd6;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e8e8e8; --bg: #121212; --muted: #a0a0a0; --border: #333333; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  p.subtitle { color: var(--muted); margin: 0 0 20px; font-size: 0.9rem; }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-end;
    margin-bottom: 20px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 0.75rem; color: var(--muted); }
  select, input, button {
    font-size: 0.9rem;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }
  select[multiple] { min-width: 180px; height: 90px; }
  button {
    background: var(--accent);
    color: #fff;
    border: none;
    cursor: pointer;
    padding: 8px 16px;
    font-weight: 600;
  }
  button:hover { opacity: 0.9; }
  .card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 20px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th:first-child, td:first-child { text-align: left; }
  th { cursor: pointer; user-select: none; color: var(--muted); font-weight: 600; }
  th.sorted { color: var(--fg); }
  #status { color: var(--muted); font-size: 0.85rem; margin-bottom: 12px; min-height: 1.2em; }
  canvas { max-height: 360px; }
</style>
</head>
<body>
  <h1>Token Usage Dashboard</h1>
  <p class="subtitle">Per-project Claude Code token consumption. See specs/token-usage-dashboard.md.</p>

  <div class="filters">
    <div class="field">
      <label for="projects">Projects (empty = all)</label>
      <select id="projects" multiple></select>
    </div>
    <div class="field">
      <label for="start">Start</label>
      <input id="start" type="datetime-local" />
    </div>
    <div class="field">
      <label for="end">End</label>
      <input id="end" type="datetime-local" />
    </div>
    <div class="field">
      <label for="bucket">Bucket</label>
      <select id="bucket">
        <option value="hour">Hour</option>
        <option value="day" selected>Day</option>
        <option value="week">Week</option>
      </select>
    </div>
    <button id="apply">Apply</button>
  </div>

  <div id="status"></div>

  <div class="card">
    <canvas id="chart"></canvas>
  </div>

  <div class="card">
    <table id="table">
      <thead>
        <tr>
          <th data-key="project_name">Project</th>
          <th data-key="input_tokens">Input</th>
          <th data-key="output_tokens">Output</th>
          <th data-key="cache_read_tokens">Cache read</th>
          <th data-key="cache_write_tokens">Cache write</th>
          <th data-key="total_tokens" class="sorted">Total tokens</th>
          <th data-key="sessions">Sessions</th>
          <th data-key="last_active">Last active</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

<script>
(function () {
  const projectsSelect = document.getElementById('projects');
  const startInput = document.getElementById('start');
  const endInput = document.getElementById('end');
  const bucketSelect = document.getElementById('bucket');
  const applyButton = document.getElementById('apply');
  const statusEl = document.getElementById('status');
  const tableBody = document.querySelector('#table tbody');
  const tableHead = document.querySelector('#table thead');

  let chart = null;
  let tableRows = [];
  let sortKey = 'total_tokens';
  let sortDir = -1;

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

  function selectedProjects() {
    return Array.from(projectsSelect.selectedOptions).map((o) => o.value);
  }

  function buildQuery(extra) {
    const params = new URLSearchParams();
    const projects = selectedProjects();
    if (projects.length > 0) params.set('projects', projects.join(','));
    if (startInput.value) params.set('start', new Date(startInput.value).toISOString());
    if (endInput.value) params.set('end', new Date(endInput.value).toISOString());
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params.toString();
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || ('Request failed: ' + res.status));
    }
    return res.json();
  }

  async function loadProjects() {
    const { projects } = await fetchJson('/api/token-usage/projects');
    projectsSelect.innerHTML = '';
    for (const name of projects) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      projectsSelect.appendChild(opt);
    }
  }

  function renderChart(series) {
    const labels = series.map((row) => new Date(row.bucket).toLocaleString());
    const datasets = [
      { label: 'Input', key: 'input_tokens', color: '#5b5bd6' },
      { label: 'Output', key: 'output_tokens', color: '#d65b9d' },
      { label: 'Cache read', key: 'cache_read_tokens', color: '#5bd6c0' },
      { label: 'Cache write', key: 'cache_write_tokens', color: '#d6c05b' },
    ].map((d) => ({
      label: d.label,
      data: series.map((row) => Number(row[d.key])),
      backgroundColor: d.color,
      stack: 'tokens',
    }));

    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('chart'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true },
        },
      },
    });
  }

  function renderTable() {
    const sorted = [...tableRows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      return av > bv ? sortDir : -sortDir;
    });
    tableBody.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const lastActive = row.last_active ? new Date(row.last_active).toLocaleString() : '\\u2014';
      tr.innerHTML =
        '<td>' + row.project_name + '</td>' +
        '<td>' + Number(row.input_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.output_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.cache_read_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.cache_write_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.total_tokens).toLocaleString() + '</td>' +
        '<td>' + Number(row.sessions).toLocaleString() + '</td>' +
        '<td>' + lastActive + '</td>';
      tableBody.appendChild(tr);
    }
    tableHead.querySelectorAll('th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.key === sortKey);
    });
  }

  tableHead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const key = th.dataset.key;
    sortDir = key === sortKey ? -sortDir : -1;
    sortKey = key;
    renderTable();
  });

  async function load() {
    statusEl.textContent = 'Loading...';
    try {
      const bucket = bucketSelect.value;
      const [seriesRes, tableRes] = await Promise.all([
        fetchJson('/api/token-usage/series?' + buildQuery({ bucket })),
        fetchJson('/api/token-usage/table?' + buildQuery()),
      ]);
      renderChart(seriesRes.series);
      tableRows = tableRes.rows;
      renderTable();
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
  }

  applyButton.addEventListener('click', load);

  setDefaultRange();
  loadProjects().finally(load);
})();
</script>
</body>
</html>
`;
