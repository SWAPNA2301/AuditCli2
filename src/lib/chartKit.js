/**
 * Shared vanilla-JS/SVG chart kit, embedded as a raw JS string into both the
 * live dashboard (dashboardTemplate.js) and the static report (report.js) so
 * the two never drift. No charting library, no build step, no CDN — every
 * mark is drawn as plain SVG so both pages stay fully self-contained.
 *
 * Color usage follows the dataviz skill's validated light-surface steps
 * (this app uses a white/green/black professional theme): status colors
 * for severity (state), a green accent for plain-magnitude bars, and the
 * fixed categorical order for comparing distinct entities (competitor
 * sites). See dataviz skill references/palette.md.
 */
const CHART_KIT_JS = `
const CHART_COLOR_LIGHT = {
  status: { high: '#dc2626', medium: '#b45309', low: '#15803d' },
  accentGreen: '#15803d',
  categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#c98500'],
  track: '#e2e6e2',
  grid: '#e2e6e2',
  textSecondary: '#374033',
  textMuted: '#5b625b',
};
const CHART_COLOR_DARK = {
  status: { high: '#f87171', medium: '#eab308', low: '#4ade80' },
  accentGreen: '#4ade80',
  categorical: ['#60a5fa', '#fb923c', '#2dd4bf', '#facc15'],
  track: '#2a322a',
  grid: '#333d33',
  textSecondary: '#d5dad2',
  textMuted: '#9aa298',
};
// Read live (not cached) so charts redraw in the right palette after a
// theme toggle without needing chartKit.js itself to know about the toggle.
Object.defineProperty(window, 'CHART_COLOR', {
  get() { return document.documentElement.getAttribute('data-theme') === 'dark' ? CHART_COLOR_DARK : CHART_COLOR_LIGHT; },
});

function chSvgOpen(width, height) {
  // preserveAspectRatio="none": height is always fixed to the viewBox height
  // (1:1 on the y-axis) across every chart here, so this only lets the
  // x-axis stretch to the real container width instead of the default
  // "meet" behavior, which centers/letterboxes when the container's aspect
  // ratio doesn't match the viewBox — that was clipping value labels that
  // sit at the right edge (text-anchor="end") off the visible card.
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" preserveAspectRatio="none" role="img" style="display:block;font-family:inherit;">';
}
function chEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function chFmt(n) { return typeof n === 'number' ? n.toLocaleString() : n; }

// Every hoverable mark carries data-tip text + the ch-hoverable class; a
// single delegated listener (attached once, lazily) shows/moves/hides the
// shared tooltip div. Delegation means freshly re-rendered chart markup
// (innerHTML swaps) is hoverable immediately with no per-render rebinding.
let chTooltipBound = false;
function chBindTooltips() {
  if (chTooltipBound) return;
  chTooltipBound = true;
  const tip = document.getElementById('ch-tooltip');
  if (!tip) return;
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest && e.target.closest('.ch-hoverable');
    if (!target) return;
    tip.textContent = target.getAttribute('data-tip') || '';
    tip.classList.add('show');
  });
  document.addEventListener('mousemove', (e) => {
    if (!tip.classList.contains('show')) return;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  });
  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest && e.target.closest('.ch-hoverable');
    if (!target) return;
    tip.classList.remove('show');
  });
}
function chHoverAttrs(tipText) {
  return 'class="ch-hoverable" data-tip="' + chEsc(tipText) + '"';
}

/**
 * Meter: a single ratio against a limit (e.g. performance score / 100).
 * Fill color bands by value (good/warning/critical); track is a flat
 * neutral so the fill state reads at a glance.
 */
function renderMeter(containerId, { value, max = 100, label = '' }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pct = Math.max(0, Math.min(1, value / max));
  // Band on the ratio, not the raw value — meters here are used with both a
  // 0-100 scale (scores) and small counts (e.g. 5 of 5 grounded findings),
  // and a raw-value threshold wrongly painted "5/5" as critical.
  const scaled = pct * 100;
  const band = scaled >= 80 ? 'good' : scaled >= 50 ? 'fair' : 'at risk';
  const color = scaled >= 80 ? CHART_COLOR.status.low : scaled >= 50 ? CHART_COLOR.status.medium : CHART_COLOR.status.high;
  // Value sits in its own header row, never over the bar — a colored
  // number on a same-colored fill is invisible where they'd overlap.
  const w = 400, h = 56, barH = 20, barY = 34, barW = w;
  const fillW = Math.round(barW * pct);
  let svg = chSvgOpen(w, h);
  svg += '<text x="0" y="15" font-size="13" fill="' + CHART_COLOR.textSecondary + '">' + chEsc(label) + '</text>';
  svg += '<text x="' + w + '" y="15" text-anchor="end" font-size="16" font-weight="800" fill="' + color + '">' + value + '<tspan font-size="12" font-weight="600" fill="' + CHART_COLOR.textMuted + '">/' + max + '</tspan></text>';
  svg += '<rect x="0" y="' + barY + '" width="' + barW + '" height="' + barH + '" rx="5" fill="' + CHART_COLOR.track + '"></rect>';
  svg += '<rect ' + chHoverAttrs(label + ': ' + value + '/' + max + ' (' + band + ')') + ' x="0" y="' + barY + '" width="' + fillW + '" height="' + barH + '" rx="5" fill="' + color + '"></rect>';
  svg += '</svg>';
  el.innerHTML = svg;
  chBindTooltips();
}

/**
 * Severity bar: part-to-whole on a single horizontal stacked bar, status
 * colors (state), 2px surface gaps between segments, legend with counts.
 */
function renderSeverityBar(containerId, counts) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const segments = [
    { key: 'high', label: 'High', value: counts.high || 0, color: CHART_COLOR.status.high },
    { key: 'medium', label: 'Medium', value: counts.medium || 0, color: CHART_COLOR.status.medium },
    { key: 'low', label: 'Low', value: counts.low || 0, color: CHART_COLOR.status.low },
  ];
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const w = 640, h = 34, gap = 2;
  let svg = chSvgOpen(w, h);
  if (total === 0) {
    svg += '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="4" fill="' + CHART_COLOR.track + '"></rect>';
    svg += '<text x="' + (w/2) + '" y="' + (h/2+4) + '" text-anchor="middle" font-size="12" fill="' + CHART_COLOR.textMuted + '">No issues found</text>';
  } else {
    let x = 0;
    segments.forEach((seg, i) => {
      if (seg.value === 0) return;
      const segW = (seg.value / total) * w - (i < segments.length - 1 ? gap : 0);
      const w2 = Math.max(segW, 0);
      const pct = Math.round((seg.value / total) * 100);
      svg += '<rect ' + chHoverAttrs(seg.label + ': ' + seg.value + ' issue' + (seg.value === 1 ? '' : 's') + ' (' + pct + '%)') + ' x="' + x + '" y="0" width="' + w2 + '" height="' + h + '" rx="4" fill="' + seg.color + '"></rect>';
      if (w2 > 34) {
        svg += '<text style="pointer-events:none;" x="' + (x + w2/2) + '" y="' + (h/2+4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#ffffff">' + seg.value + '</text>';
      }
      x += segW + gap;
    });
  }
  svg += '</svg>';

  const legend = segments.map(seg =>
    '<span class="chart-legend-item"><span class="chart-swatch" style="background:' + seg.color + '"></span>' + seg.label + ': ' + seg.value + '</span>'
  ).join('');

  el.innerHTML = svg + '<div class="chart-legend">' + legend + '</div>';
  chBindTooltips();
}

/**
 * Horizontal bar chart for comparing magnitude across categories (issue
 * types). Single accent hue (sequential job, but length carries magnitude
 * so one flat hue is correct — no need for a multi-step ramp). Sorted
 * descending, value labeled at each bar's tip, folds the tail into "Other"
 * past 7 categories.
 */
function renderBarChart(containerId, items, { hue = CHART_COLOR.accentGreen, foldAt = 7 } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  let shown = sorted.slice(0, foldAt);
  const rest = sorted.slice(foldAt);
  if (rest.length) {
    shown = shown.concat([{ label: rest.length + ' other type' + (rest.length > 1 ? 's' : ''), value: rest.reduce((s, r) => s + r.value, 0) }]);
  }
  if (!shown.length) {
    el.innerHTML = '<div class="chart-empty">No data.</div>';
    return;
  }

  const rowH = 28, barH = 16, labelW = 200, w = 640, chartW = w - labelW - 46;
  const maxVal = Math.max(...shown.map(i => i.value), 1);
  const h = shown.length * rowH + 8;

  let svg = chSvgOpen(w, h);
  shown.forEach((item, i) => {
    const y = i * rowH + 6;
    const barW = Math.max((item.value / maxVal) * chartW, 2);
    svg += '<text style="pointer-events:none;" x="' + (labelW - 10) + '" y="' + (y + barH - 3) + '" text-anchor="end" font-size="12" fill="' + CHART_COLOR.textSecondary + '">' + chEsc(truncateLabel(item.label, 26)) + '</text>';
    svg += '<rect ' + chHoverAttrs(item.label + ': ' + chFmt(item.value)) + ' x="' + labelW + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="4" fill="' + hue + '"></rect>';
    svg += '<text style="pointer-events:none;" x="' + (labelW + barW + 8) + '" y="' + (y + barH - 3) + '" font-size="12" font-weight="600" fill="' + CHART_COLOR.textSecondary + '">' + chFmt(item.value) + '</text>';
  });
  svg += '</svg>';
  el.innerHTML = svg;
  chBindTooltips();
}

/**
 * Vertical bar chart comparing one metric across distinct entities (a site
 * vs its competitors) — categorical color, fixed order (target always the
 * first slot), legend + direct labels since identity (which bar is which
 * site) matters as much as magnitude here.
 */
function renderEntityBarChart(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="chart-empty">No data.</div>'; return; }

  const w = 640, h = 200, barW = 56, gap = 24, baseY = h - 34;
  const maxVal = Math.max(...items.map(i => i.value), 1);
  const totalW = items.length * barW + (items.length - 1) * gap;
  const startX = Math.max(0, (w - totalW) / 2);

  let svg = chSvgOpen(w, h);
  svg += '<line x1="0" y1="' + baseY + '" x2="' + w + '" y2="' + baseY + '" stroke="' + CHART_COLOR.grid + '" stroke-width="1"></line>';
  items.forEach((item, i) => {
    const x = startX + i * (barW + gap);
    const barH = Math.max((item.value / maxVal) * (baseY - 20), 2);
    const y = baseY - barH;
    const color = CHART_COLOR.categorical[i % CHART_COLOR.categorical.length];
    svg += '<rect ' + chHoverAttrs(item.label + ': ' + chFmt(item.value)) + ' x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="4" fill="' + color + '"></rect>';
    svg += '<text style="pointer-events:none;" x="' + (x + barW/2) + '" y="' + (y - 8) + '" text-anchor="middle" font-size="13" font-weight="700" fill="' + CHART_COLOR.textSecondary + '">' + chFmt(item.value) + '</text>';
    svg += '<text style="pointer-events:none;" x="' + (x + barW/2) + '" y="' + (baseY + 18) + '" text-anchor="middle" font-size="11" fill="' + CHART_COLOR.textMuted + '">' + chEsc(truncateLabel(item.label, 12)) + '</text>';
  });
  svg += '</svg>';
  el.innerHTML = svg;
  chBindTooltips();
}

function truncateLabel(str, len) {
  const s = String(str ?? '');
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}
`;

module.exports = { CHART_KIT_JS };
