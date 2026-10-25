export const tokenUsageDashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HercuIT Burnrate — Token Usage</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  :root {
    color-scheme: light dark;
    --fg: #111318;
    --bg: #ffffff;
    --muted: #5B606B;
    --border: #e0e0e0;
    --accent: #FF6A1F;
    --accent-strong: #E5341B;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #F3F1EE; --bg: #111318; --muted: #9BA1AD; --border: #333333; }
    .logo-light { display: none; }
    .logo-dark { display: block; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  }
  .logo { display: block; height: 32px; width: auto; margin-bottom: 8px; }
  .logo-dark { display: none; }
  p.subtitle { color: var(--muted); margin: 0 0 20px; font-size: 0.9rem; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
  .tab {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    font-weight: 600;
  }
  .tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  .chart-toggle { display: flex; gap: 8px; margin-bottom: 12px; }
  .chart-toggle button {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    font-weight: 600;
    padding: 6px 12px;
  }
  .chart-toggle button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
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
  button:hover { background: var(--accent-strong); }
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
  tr.filter-row td { padding: 4px 10px; border-bottom: 1px solid var(--border); }
  .filter-input { width: 100%; box-sizing: border-box; font-size: 0.78rem; padding: 4px 6px; }
  .range { display: flex; gap: 4px; }
  .range input { width: 50%; }
  .table-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
  .table-toolbar button { background: transparent; color: var(--muted); border: 1px solid var(--border); font-weight: 600; padding: 4px 10px; font-size: 0.78rem; }
  .table-toolbar button:hover { background: var(--border); color: var(--fg); }
  #status { color: var(--muted); font-size: 0.85rem; margin-bottom: 12px; min-height: 1.2em; }
  canvas { max-height: 360px; }
</style>
</head>
<body>
  <svg class="logo logo-light" viewBox="16 0 256 64" role="img" aria-label="HercuIT Burnrate"><defs>
    <linearGradient id="fl" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#E5341B"/>
      <stop offset="0.55" stop-color="#FF6A1F"/>
      <stop offset="1" stop-color="#FFB627"/>
    </linearGradient>
  </defs>
  <path d="M33 4c1.5 9 13 15.5 13 31.5C46 50 40.5 60 32 60S18 51.5 18 39.5c0-8 4-12.5 6.5-18 .8 5 2.6 7.6 5 8.6C28.4 20.5 30 12 33 4z" fill="url(#fl)"/>
  <path d="M24.5 47.5l6-6.5 4 4 6.5-8.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="41" cy="36.5" r="2.6" fill="#fff"/>
<path d="M58.898 42.0V23.8H61.706V31.6H69.35V23.8H72.158V42.0H69.35V34.148H61.706V42.0Z M81.648 42.364Q79.698 42.364 78.24199999999999 41.545Q76.78599999999999 40.726 75.96699999999998 39.230999999999995Q75.148 37.736 75.148 35.76V35.448Q75.148 33.446 75.954 31.951Q76.75999999999999 30.456000000000003 78.20299999999999 29.637Q79.64599999999999 28.818 81.544 28.818Q83.38999999999999 28.818 84.78099999999999 29.637Q86.172 30.456000000000003 86.952 31.912000000000003Q87.732 33.368 87.732 35.318V36.332H77.87799999999999Q77.92999999999999 38.022 79.00899999999999 39.022999999999996Q80.088 40.024 81.69999999999999 40.024Q83.208 40.024 83.975 39.348Q84.74199999999999 38.672 85.15799999999999 37.788L87.368 38.932Q87.00399999999999 39.66 86.315 40.465999999999994Q85.62599999999999 41.272 84.50799999999998 41.818Q83.38999999999999 42.364 81.648 42.364ZM77.904 34.278H85.002Q84.898 32.822 83.96199999999999 32.003Q83.026 31.184 81.51799999999999 31.184Q80.00999999999999 31.184 79.06099999999999 32.003Q78.112 32.822 77.904 34.278Z M90.696 42.0V29.182000000000002H93.322V30.69H93.738Q94.05 29.884 94.739 29.507Q95.428 29.130000000000003 96.442 29.130000000000003H97.976V31.548000000000002H96.338Q95.038 31.548000000000002 94.20599999999999 32.263000000000005Q93.374 32.978 93.374 34.46V42.0Z M106.452 42.364Q104.606 42.364 103.11099999999999 41.584Q101.61599999999999 40.804 100.74499999999999 39.322Q99.874 37.84 99.874 35.76V35.422Q99.874 33.342 100.74499999999999 31.872999999999998Q101.61599999999999 30.404 103.11099999999999 29.611Q104.606 28.818 106.452 28.818Q108.29799999999999 28.818 109.59799999999998 29.494Q110.898 30.17 111.691 31.288Q112.484 32.406 112.71799999999999 33.758L110.118 34.304Q109.98799999999999 33.446 109.57199999999999 32.744Q109.15599999999999 32.042 108.40199999999999 31.626Q107.648 31.21 106.50399999999999 31.21Q105.386 31.21 104.48899999999999 31.717000000000002Q103.59199999999998 32.224000000000004 103.07199999999999 33.173Q102.55199999999999 34.122 102.55199999999999 35.474000000000004V35.708Q102.55199999999999 37.06 103.07199999999999 38.022000000000006Q103.59199999999998 38.984 104.48899999999999 39.478Q105.386 39.972 106.50399999999999 39.972Q108.19399999999999 39.972 109.07799999999999 39.101Q109.96199999999999 38.23 110.196 36.878L112.79599999999999 37.476Q112.484 38.802 111.691 39.92Q110.898 41.038 109.59799999999998 41.70099999999999Q108.29799999999999 42.364 106.452 42.364Z M120.544 42.234Q119.088 42.234 117.94399999999999 41.584Q116.8 40.934 116.15 39.738Q115.5 38.542 115.5 36.878V29.182000000000002H118.178V36.696Q118.178 38.36 119.00999999999999 39.153Q119.842 39.946 121.324 39.946Q122.96199999999999 39.946 123.963 38.840999999999994Q124.964 37.736 124.964 35.656V29.182000000000002H127.642V42.0H125.01599999999999V40.076H124.6Q124.23599999999999 40.856 123.29999999999998 41.545Q122.36399999999999 42.234 120.544 42.234Z M131.256 42.0V23.8H134.064V42.0Z M141.942 42.0V26.348H136.352V23.8H150.34V26.348H144.75V42.0Z" fill="#5B606B"/><path d="M159.926 42.0V38.984H162.31799999999998V26.816000000000003H159.926V23.8H169.286Q170.95 23.8 172.185 24.359Q173.42 24.918 174.10899999999998 25.945Q174.798 26.972 174.798 28.402V28.662Q174.798 29.91 174.32999999999998 30.703000000000003Q173.862 31.496000000000002 173.225 31.925Q172.588 32.354 172.016 32.536V33.004Q172.588 33.16 173.264 33.589Q173.94 34.018 174.421 34.824Q174.902 35.63 174.902 36.93V37.19Q174.902 38.698 174.2 39.777Q173.498 40.856 172.26299999999998 41.428Q171.028 42.0 169.39 42.0ZM165.75 38.88H168.974Q170.09199999999998 38.88 170.781 38.334Q171.47 37.788 171.47 36.774V36.514Q171.47 35.5 170.79399999999998 34.954Q170.118 34.408 168.974 34.408H165.75ZM165.75 31.288H168.922Q169.988 31.288 170.677 30.741999999999997Q171.36599999999999 30.195999999999998 171.36599999999999 29.234V28.974Q171.36599999999999 27.986 170.69 27.453000000000003Q170.01399999999998 26.92 168.922 26.92H165.75Z M182.468 42.208Q180.95999999999998 42.208 179.82899999999998 41.519Q178.69799999999998 40.83 178.07399999999998 39.608000000000004Q177.45 38.386 177.45 36.8V29.104H180.72599999999997V36.54Q180.72599999999997 37.996 181.44099999999997 38.724000000000004Q182.15599999999998 39.452 183.48199999999997 39.452Q184.98999999999998 39.452 185.82199999999997 38.451Q186.65399999999997 37.45 186.65399999999997 35.656V29.104H189.92999999999998V42.0H186.706V40.31H186.23799999999997Q185.926 40.96 185.06799999999998 41.584Q184.20999999999998 42.208 182.468 42.208Z M193.30999999999997 42.0V29.104H196.534V30.560000000000002H197.00199999999998Q197.28799999999998 29.78 197.95099999999996 29.416Q198.61399999999998 29.052 199.498 29.052H201.058V31.964H199.44599999999997Q198.19799999999998 31.964 197.392 32.626999999999995Q196.58599999999998 33.29 196.58599999999998 34.668V42.0Z M203.34599999999998 42.0V29.104H206.57V30.794H207.03799999999998Q207.35 30.118000000000002 208.20799999999997 29.507Q209.06599999999997 28.896 210.808 28.896Q212.31599999999997 28.896 213.44699999999997 29.585Q214.57799999999997 30.274 215.202 31.483Q215.826 32.692 215.826 34.304V42.0H212.54999999999998V34.564Q212.54999999999998 33.108000000000004 211.83499999999998 32.38Q211.11999999999998 31.652 209.79399999999998 31.652Q208.28599999999997 31.652 207.45399999999998 32.653Q206.62199999999999 33.653999999999996 206.62199999999999 35.448V42.0Z M219.10199999999998 42.0V29.104H222.326V30.560000000000002H222.79399999999998Q223.07999999999998 29.78 223.743 29.416Q224.40599999999998 29.052 225.29 29.052H226.85V31.964H225.23799999999997Q223.98999999999998 31.964 223.18399999999997 32.626999999999995Q222.378 33.29 222.378 34.668V42.0Z M233.142 42.364Q231.76399999999998 42.364 230.67199999999997 41.882999999999996Q229.57999999999998 41.402 228.94299999999998 40.479Q228.30599999999998 39.556 228.30599999999998 38.23Q228.30599999999998 36.903999999999996 228.94299999999998 36.007Q229.57999999999998 35.11 230.71099999999998 34.655Q231.84199999999998 34.2 233.29799999999997 34.2H236.83399999999997V33.472Q236.83399999999997 32.562 236.262 31.977Q235.69 31.392000000000003 234.44199999999998 31.392000000000003Q233.21999999999997 31.392000000000003 232.62199999999996 31.951Q232.02399999999997 32.51 231.84199999999998 33.394L228.826 32.38Q229.13799999999998 31.392000000000003 229.827 30.573Q230.516 29.754 231.673 29.247Q232.82999999999998 28.740000000000002 234.49399999999997 28.740000000000002Q237.04199999999997 28.740000000000002 238.52399999999997 30.014000000000003Q240.00599999999997 31.288 240.00599999999997 33.706V38.516Q240.00599999999997 39.296 240.73399999999998 39.296H241.77399999999997V42.0H239.58999999999997Q238.628 42.0 238.004 41.532Q237.38 41.064 237.38 40.284V40.258H236.886Q236.78199999999998 40.57 236.41799999999998 41.077Q236.05399999999997 41.584 235.27399999999997 41.974000000000004Q234.49399999999997 42.364 233.142 42.364ZM233.71399999999997 39.712Q235.09199999999998 39.712 235.96299999999997 38.945Q236.83399999999997 38.178 236.83399999999997 36.903999999999996V36.644H233.53199999999998Q232.62199999999999 36.644 232.10199999999998 37.034Q231.582 37.424 231.582 38.126Q231.582 38.828 232.128 39.27Q232.67399999999998 39.712 233.71399999999997 39.712Z M248.84599999999998 42.0Q247.57199999999997 42.0 246.779 41.207Q245.986 40.414 245.986 39.088V31.808H242.76199999999997V29.104H245.986V25.1H249.26199999999997V29.104H252.79799999999997V31.808H249.26199999999997V38.516Q249.26199999999997 39.296 249.98999999999998 39.296H252.486V42.0Z M261.378 42.364Q259.454 42.364 257.985 41.545Q256.51599999999996 40.726 255.69699999999997 39.230999999999995Q254.878 37.736 254.878 35.708V35.396Q254.878 33.368 255.684 31.873Q256.49 30.378 257.946 29.559Q259.402 28.740000000000002 261.32599999999996 28.740000000000002Q263.224 28.740000000000002 264.628 29.585Q266.032 30.43 266.812 31.925Q267.592 33.42 267.592 35.396V36.514H258.20599999999996Q258.258 37.84 259.19399999999996 38.672Q260.13 39.504 261.48199999999997 39.504Q262.86 39.504 263.51 38.906Q264.15999999999997 38.308 264.498 37.58L267.176 38.984Q266.812 39.66 266.123 40.453Q265.43399999999997 41.246 264.28999999999996 41.805Q263.146 42.364 261.378 42.364ZM258.23199999999997 34.07H264.264Q264.15999999999997 32.952 263.36699999999996 32.275999999999996Q262.574 31.6 261.3 31.6Q259.974 31.6 259.19399999999996 32.275999999999996Q258.414 32.952 258.23199999999997 34.07Z" fill="#111318"/></svg>
  <svg class="logo logo-dark" viewBox="16 0 256 64" role="img" aria-label="HercuIT Burnrate"><defs>
    <linearGradient id="fld" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#E5341B"/>
      <stop offset="0.55" stop-color="#FF6A1F"/>
      <stop offset="1" stop-color="#FFB627"/>
    </linearGradient>
  </defs>
  <path d="M33 4c1.5 9 13 15.5 13 31.5C46 50 40.5 60 32 60S18 51.5 18 39.5c0-8 4-12.5 6.5-18 .8 5 2.6 7.6 5 8.6C28.4 20.5 30 12 33 4z" fill="url(#fld)"/>
  <path d="M24.5 47.5l6-6.5 4 4 6.5-8.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="41" cy="36.5" r="2.6" fill="#fff"/>
<path d="M58.898 42.0V23.8H61.706V31.6H69.35V23.8H72.158V42.0H69.35V34.148H61.706V42.0Z M81.648 42.364Q79.698 42.364 78.24199999999999 41.545Q76.78599999999999 40.726 75.96699999999998 39.230999999999995Q75.148 37.736 75.148 35.76V35.448Q75.148 33.446 75.954 31.951Q76.75999999999999 30.456000000000003 78.20299999999999 29.637Q79.64599999999999 28.818 81.544 28.818Q83.38999999999999 28.818 84.78099999999999 29.637Q86.172 30.456000000000003 86.952 31.912000000000003Q87.732 33.368 87.732 35.318V36.332H77.87799999999999Q77.92999999999999 38.022 79.00899999999999 39.022999999999996Q80.088 40.024 81.69999999999999 40.024Q83.208 40.024 83.975 39.348Q84.74199999999999 38.672 85.15799999999999 37.788L87.368 38.932Q87.00399999999999 39.66 86.315 40.465999999999994Q85.62599999999999 41.272 84.50799999999998 41.818Q83.38999999999999 42.364 81.648 42.364ZM77.904 34.278H85.002Q84.898 32.822 83.96199999999999 32.003Q83.026 31.184 81.51799999999999 31.184Q80.00999999999999 31.184 79.06099999999999 32.003Q78.112 32.822 77.904 34.278Z M90.696 42.0V29.182000000000002H93.322V30.69H93.738Q94.05 29.884 94.739 29.507Q95.428 29.130000000000003 96.442 29.130000000000003H97.976V31.548000000000002H96.338Q95.038 31.548000000000002 94.20599999999999 32.263000000000005Q93.374 32.978 93.374 34.46V42.0Z M106.452 42.364Q104.606 42.364 103.11099999999999 41.584Q101.61599999999999 40.804 100.74499999999999 39.322Q99.874 37.84 99.874 35.76V35.422Q99.874 33.342 100.74499999999999 31.872999999999998Q101.61599999999999 30.404 103.11099999999999 29.611Q104.606 28.818 106.452 28.818Q108.29799999999999 28.818 109.59799999999998 29.494Q110.898 30.17 111.691 31.288Q112.484 32.406 112.71799999999999 33.758L110.118 34.304Q109.98799999999999 33.446 109.57199999999999 32.744Q109.15599999999999 32.042 108.40199999999999 31.626Q107.648 31.21 106.50399999999999 31.21Q105.386 31.21 104.48899999999999 31.717000000000002Q103.59199999999998 32.224000000000004 103.07199999999999 33.173Q102.55199999999999 34.122 102.55199999999999 35.474000000000004V35.708Q102.55199999999999 37.06 103.07199999999999 38.022000000000006Q103.59199999999998 38.984 104.48899999999999 39.478Q105.386 39.972 106.50399999999999 39.972Q108.19399999999999 39.972 109.07799999999999 39.101Q109.96199999999999 38.23 110.196 36.878L112.79599999999999 37.476Q112.484 38.802 111.691 39.92Q110.898 41.038 109.59799999999998 41.70099999999999Q108.29799999999999 42.364 106.452 42.364Z M120.544 42.234Q119.088 42.234 117.94399999999999 41.584Q116.8 40.934 116.15 39.738Q115.5 38.542 115.5 36.878V29.182000000000002H118.178V36.696Q118.178 38.36 119.00999999999999 39.153Q119.842 39.946 121.324 39.946Q122.96199999999999 39.946 123.963 38.840999999999994Q124.964 37.736 124.964 35.656V29.182000000000002H127.642V42.0H125.01599999999999V40.076H124.6Q124.23599999999999 40.856 123.29999999999998 41.545Q122.36399999999999 42.234 120.544 42.234Z M131.256 42.0V23.8H134.064V42.0Z M141.942 42.0V26.348H136.352V23.8H150.34V26.348H144.75V42.0Z" fill="#9BA1AD"/><path d="M159.926 42.0V38.984H162.31799999999998V26.816000000000003H159.926V23.8H169.286Q170.95 23.8 172.185 24.359Q173.42 24.918 174.10899999999998 25.945Q174.798 26.972 174.798 28.402V28.662Q174.798 29.91 174.32999999999998 30.703000000000003Q173.862 31.496000000000002 173.225 31.925Q172.588 32.354 172.016 32.536V33.004Q172.588 33.16 173.264 33.589Q173.94 34.018 174.421 34.824Q174.902 35.63 174.902 36.93V37.19Q174.902 38.698 174.2 39.777Q173.498 40.856 172.26299999999998 41.428Q171.028 42.0 169.39 42.0ZM165.75 38.88H168.974Q170.09199999999998 38.88 170.781 38.334Q171.47 37.788 171.47 36.774V36.514Q171.47 35.5 170.79399999999998 34.954Q170.118 34.408 168.974 34.408H165.75ZM165.75 31.288H168.922Q169.988 31.288 170.677 30.741999999999997Q171.36599999999999 30.195999999999998 171.36599999999999 29.234V28.974Q171.36599999999999 27.986 170.69 27.453000000000003Q170.01399999999998 26.92 168.922 26.92H165.75Z M182.468 42.208Q180.95999999999998 42.208 179.82899999999998 41.519Q178.69799999999998 40.83 178.07399999999998 39.608000000000004Q177.45 38.386 177.45 36.8V29.104H180.72599999999997V36.54Q180.72599999999997 37.996 181.44099999999997 38.724000000000004Q182.15599999999998 39.452 183.48199999999997 39.452Q184.98999999999998 39.452 185.82199999999997 38.451Q186.65399999999997 37.45 186.65399999999997 35.656V29.104H189.92999999999998V42.0H186.706V40.31H186.23799999999997Q185.926 40.96 185.06799999999998 41.584Q184.20999999999998 42.208 182.468 42.208Z M193.30999999999997 42.0V29.104H196.534V30.560000000000002H197.00199999999998Q197.28799999999998 29.78 197.95099999999996 29.416Q198.61399999999998 29.052 199.498 29.052H201.058V31.964H199.44599999999997Q198.19799999999998 31.964 197.392 32.626999999999995Q196.58599999999998 33.29 196.58599999999998 34.668V42.0Z M203.34599999999998 42.0V29.104H206.57V30.794H207.03799999999998Q207.35 30.118000000000002 208.20799999999997 29.507Q209.06599999999997 28.896 210.808 28.896Q212.31599999999997 28.896 213.44699999999997 29.585Q214.57799999999997 30.274 215.202 31.483Q215.826 32.692 215.826 34.304V42.0H212.54999999999998V34.564Q212.54999999999998 33.108000000000004 211.83499999999998 32.38Q211.11999999999998 31.652 209.79399999999998 31.652Q208.28599999999997 31.652 207.45399999999998 32.653Q206.62199999999999 33.653999999999996 206.62199999999999 35.448V42.0Z M219.10199999999998 42.0V29.104H222.326V30.560000000000002H222.79399999999998Q223.07999999999998 29.78 223.743 29.416Q224.40599999999998 29.052 225.29 29.052H226.85V31.964H225.23799999999997Q223.98999999999998 31.964 223.18399999999997 32.626999999999995Q222.378 33.29 222.378 34.668V42.0Z M233.142 42.364Q231.76399999999998 42.364 230.67199999999997 41.882999999999996Q229.57999999999998 41.402 228.94299999999998 40.479Q228.30599999999998 39.556 228.30599999999998 38.23Q228.30599999999998 36.903999999999996 228.94299999999998 36.007Q229.57999999999998 35.11 230.71099999999998 34.655Q231.84199999999998 34.2 233.29799999999997 34.2H236.83399999999997V33.472Q236.83399999999997 32.562 236.262 31.977Q235.69 31.392000000000003 234.44199999999998 31.392000000000003Q233.21999999999997 31.392000000000003 232.62199999999996 31.951Q232.02399999999997 32.51 231.84199999999998 33.394L228.826 32.38Q229.13799999999998 31.392000000000003 229.827 30.573Q230.516 29.754 231.673 29.247Q232.82999999999998 28.740000000000002 234.49399999999997 28.740000000000002Q237.04199999999997 28.740000000000002 238.52399999999997 30.014000000000003Q240.00599999999997 31.288 240.00599999999997 33.706V38.516Q240.00599999999997 39.296 240.73399999999998 39.296H241.77399999999997V42.0H239.58999999999997Q238.628 42.0 238.004 41.532Q237.38 41.064 237.38 40.284V40.258H236.886Q236.78199999999998 40.57 236.41799999999998 41.077Q236.05399999999997 41.584 235.27399999999997 41.974000000000004Q234.49399999999997 42.364 233.142 42.364ZM233.71399999999997 39.712Q235.09199999999998 39.712 235.96299999999997 38.945Q236.83399999999997 38.178 236.83399999999997 36.903999999999996V36.644H233.53199999999998Q232.62199999999999 36.644 232.10199999999998 37.034Q231.582 37.424 231.582 38.126Q231.582 38.828 232.128 39.27Q232.67399999999998 39.712 233.71399999999997 39.712Z M248.84599999999998 42.0Q247.57199999999997 42.0 246.779 41.207Q245.986 40.414 245.986 39.088V31.808H242.76199999999997V29.104H245.986V25.1H249.26199999999997V29.104H252.79799999999997V31.808H249.26199999999997V38.516Q249.26199999999997 39.296 249.98999999999998 39.296H252.486V42.0Z M261.378 42.364Q259.454 42.364 257.985 41.545Q256.51599999999996 40.726 255.69699999999997 39.230999999999995Q254.878 37.736 254.878 35.708V35.396Q254.878 33.368 255.684 31.873Q256.49 30.378 257.946 29.559Q259.402 28.740000000000002 261.32599999999996 28.740000000000002Q263.224 28.740000000000002 264.628 29.585Q266.032 30.43 266.812 31.925Q267.592 33.42 267.592 35.396V36.514H258.20599999999996Q258.258 37.84 259.19399999999996 38.672Q260.13 39.504 261.48199999999997 39.504Q262.86 39.504 263.51 38.906Q264.15999999999997 38.308 264.498 37.58L267.176 38.984Q266.812 39.66 266.123 40.453Q265.43399999999997 41.246 264.28999999999996 41.805Q263.146 42.364 261.378 42.364ZM258.23199999999997 34.07H264.264Q264.15999999999997 32.952 263.36699999999996 32.275999999999996Q262.574 31.6 261.3 31.6Q259.974 31.6 259.19399999999996 32.275999999999996Q258.414 32.952 258.23199999999997 34.07Z" fill="#F3F1EE"/></svg>
  <p class="subtitle">Per-project Claude Code token consumption and spend. See specs/token-usage-dashboard.md and specs/usd-per-project-dashboard.md.</p>

  <div class="tabs">
    <button class="tab active" data-tab="tokens">Token Usage</button>
    <button class="tab" data-tab="cost">Cost (USD)</button>
  </div>

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

  <div id="pane-tokens" class="tab-pane active">
    <div class="card">
      <canvas id="chart"></canvas>
    </div>

    <div class="card">
      <div class="table-toolbar">
        <button id="clearTableFilters" type="button">Clear filters</button>
      </div>
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
          <tr class="filter-row">
            <td><input class="filter-input" type="text" data-key="project_name" data-filter="text" placeholder="Filter..." /></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="input_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="input_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="output_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="output_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="cache_read_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="cache_read_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="cache_write_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="cache_write_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="total_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="total_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="sessions" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="sessions" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="date" data-key="last_active" data-filter="from" /><input class="filter-input" type="date" data-key="last_active" data-filter="to" /></div></td>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <div id="pane-cost" class="tab-pane">
    <div class="chart-toggle">
      <button class="active" data-mode="bar">By project</button>
      <button data-mode="line">Trend</button>
    </div>

    <div class="card">
      <canvas id="costChart"></canvas>
    </div>

    <div class="card">
      <div class="table-toolbar">
        <button id="clearCostFilters" type="button">Clear filters</button>
      </div>
      <table id="costTable">
        <thead>
          <tr>
            <th data-key="project_name">Project</th>
            <th data-key="total_cost_usd" class="sorted">Total cost (USD)</th>
            <th data-key="total_tokens">Total tokens</th>
            <th data-key="cost_per_1k_tokens">Cost per 1K tokens</th>
            <th data-key="sessions">Sessions</th>
            <th data-key="last_active">Last active</th>
          </tr>
          <tr class="filter-row">
            <td><input class="filter-input" type="text" data-key="project_name" data-filter="text" placeholder="Filter..." /></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="total_cost_usd" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="total_cost_usd" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="total_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="total_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="cost_per_1k_tokens" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="cost_per_1k_tokens" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="number" data-key="sessions" data-filter="min" placeholder="Min" /><input class="filter-input" type="number" data-key="sessions" data-filter="max" placeholder="Max" /></div></td>
            <td><div class="range"><input class="filter-input" type="date" data-key="last_active" data-filter="from" /><input class="filter-input" type="date" data-key="last_active" data-filter="to" /></div></td>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
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

  const PROJECT_COLORS = ['#FF6A1F', '#5b5bd6', '#d65b9d', '#5bd6c0', '#d6c05b', '#E5341B', '#FFB627', '#9bb1ad'];
  function colorFor(index) {
    return PROJECT_COLORS[index % PROJECT_COLORS.length];
  }

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
      th.textContent = th.dataset.label + arrow;
    });
  }

  function attachSort(head, sort, render) {
    head.querySelectorAll('tr:first-child th').forEach((th) => {
      th.dataset.label = th.textContent;
    });
    head.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      sort.dir = th.dataset.key === sort.key ? -sort.dir : -1;
      sort.key = th.dataset.key;
      render();
    });
  }

  function attachFilterRow(head, filters, render) {
    const filterRow = head.querySelector('tr.filter-row');
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

  function renderTable() {
    const filtered = applyFilters(tableRows, tokenFilters, TOKEN_COLUMNS);
    const sorted = sortRows(filtered, tokenSort);
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
          label: 'Total cost (USD)',
          data: costRows.map((r) => Number(r.total_cost_usd)),
          backgroundColor: costRows.map((_, i) => colorFor(i)),
        }],
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } },
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
      data: { labels: buckets.map((b) => new Date(b).toLocaleString()), datasets },
      options: { responsive: true, scales: { y: { beginAtZero: true } } },
    });
  }

  function renderCostChart() {
    if (costChartMode === 'bar') renderCostBarChart();
    else renderCostLineChart();
  }

  function renderCostTable() {
    const filtered = applyFilters(costRows, costFilters, COST_COLUMNS);
    const sorted = sortRows(filtered, costSort);
    costTableBody.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const lastActive = row.last_active ? new Date(row.last_active).toLocaleString() : '\\u2014';
      tr.innerHTML =
        '<td>' + row.project_name + '</td>' +
        '<td>' + formatUsd(row.total_cost_usd) + '</td>' +
        '<td>' + Number(row.total_tokens).toLocaleString() + '</td>' +
        '<td>' + formatUsd(row.cost_per_1k_tokens) + '</td>' +
        '<td>' + Number(row.sessions).toLocaleString() + '</td>' +
        '<td>' + lastActive + '</td>';
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
      document.querySelectorAll('.chart-toggle button').forEach((x) => x.classList.toggle('active', x === b));
      renderCostChart();
    });
  });

  function switchTab(tab) {
    if (tab === activeTab) return;
    rangeByTab[activeTab] = { start: startInput.value, end: endInput.value };
    activeTab = tab;
    if (rangeByTab[tab]) {
      startInput.value = rangeByTab[tab].start;
      endInput.value = rangeByTab[tab].end;
    } else if (tab === 'tokens') {
      setDefaultRange();
    } else {
      startInput.value = '';
      endInput.value = '';
    }
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('pane-tokens').classList.toggle('active', tab === 'tokens');
    document.getElementById('pane-cost').classList.toggle('active', tab === 'cost');
    load();
  }

  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  async function load() {
    statusEl.textContent = 'Loading...';
    try {
      const bucket = bucketSelect.value;
      if (activeTab === 'tokens') {
        const [seriesRes, tableRes] = await Promise.all([
          fetchJson('/api/token-usage/series?' + buildQuery({ bucket })),
          fetchJson('/api/token-usage/table?' + buildQuery()),
        ]);
        renderChart(seriesRes.series);
        tableRows = tableRes.rows;
        renderTable();
      } else {
        const [tableRes, seriesRes] = await Promise.all([
          fetchJson('/api/cost/table?' + buildQuery()),
          fetchJson('/api/cost/series?' + buildQuery({ bucket })),
        ]);
        costRows = tableRes.rows;
        costSeries = seriesRes.series;
        renderCostChart();
        renderCostTable();
      }
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
