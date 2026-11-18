const paths = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  standings: 'M8 21h8m-4-4v4M7 4h10v6a5 5 0 0 1-10 0zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4',
  calendar: 'M3 5h18v16H3zM7 3v4m10-4v4M3 10h18m-14 4h3m4 0h3m-10 3h3',
  race: 'M3 4v18M3 5l5-2 5 2 5-2 3 1v11l-3-1-5 2-5-2-5 2M8 3v11m5-9v11m5-13v11',
  records: 'M3 20h18M5 17v-4h3v4m3 0V9h3v8m3 0V4h3v13',
  forecast: 'M3 19h18M4 15l5-5 4 2 6-7m-5 0h5v5',
  guide: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-10h.01',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  team: 'M3 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2zm6-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 3h1a3 3 0 0 1 3 3v3h-3m-2-9a3 3 0 0 0 0-6'
};

export function icon(id) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[id]}"/></svg>`;
}

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const e = value => String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
export const display = value => value === undefined || value === null || value === '' ? '—' : e(value);
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const date = (value, long = false) => Number.isFinite(Date.parse(value)) ? (long ? longDateFormat : dateFormat).format(new Date(value)) : '—';
export const roundLabel = number => `R${String(number).padStart(2, '0')}`;
export const decimals = (value, count = 1) => Number.isFinite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: count, minimumFractionDigits: count }) : '—';
export const pointTotal = value => Number.isFinite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: 3 }) : '—';
export function lapTime(value) {
  if (!Number.isFinite(value)) return '—';
  const milliseconds = Math.round(value * 1000);
  return `${Math.floor(milliseconds / 60_000)}:${((milliseconds % 60_000) / 1000).toFixed(3).padStart(6, '0')}`;
}
export const palette = ['#ff5770', '#5adbc4', '#ffb46b', '#a995f5', '#6aaaff', '#f3de70'];
const teamColors = {
  mclaren: '#ffac62', mercedes: '#59dfcb', red_bull: '#82a4ff', ferrari: '#ff6076',
  williams: '#71b8ff', aston_martin: '#68dfad', alpine: '#e9a2ed', sauber: '#b4df63',
  haas: '#cbccd7', rb: '#ada6ff', racing_bulls: '#ada6ff', audi: '#e6d5ce', cadillac: '#ddd29f'
};
export const teamColor = (id, index = 0) => teamColors[id] ?? palette[index % palette.length];
export const dot = color => `<i class="dot" style="--swatch:${color}" aria-hidden="true"></i>`;

export const empty = (message, retry) => `<div class="panel empty" role="status"><span>${e(message)}</span>${retry ? `<button class="button" data-retry="${retry}">Try again</button>` : ''}</div>`;
export const pageTitle = (title, description) => `<header class="page-title"><h1>${e(title)}</h1><p>${e(description)}</p></header>`;
export const panelHead = (title, description = '', actions = '') => `<div class="panel-head"><div><h2>${e(title)}</h2>${description ? `<p>${e(description)}</p>` : ''}</div>${actions}</div>`;
export const tag = (label, variant = '') => `<span class="tag ${variant}">${e(label)}</span>`;
export function segments(key, value, options, label) {
  return `<div class="segmented" role="group" aria-label="${e(label)}">${options.map(([id, name]) =>
    `<button type="button" data-control="${key}" data-value="${e(id)}" aria-pressed="${id === value}">${e(name)}</button>`).join('')}</div>`;
}
export function select(key, label, value, options) {
  return `<label for="${key}">${e(label)} <select id="${key}" name="${key}" aria-label="${e(label)}" data-select="${key}">${options.map(([id, name]) =>
    `<option value="${e(id)}"${String(id) === String(value) ? ' selected' : ''}>${e(name)}</option>`).join('')}</select></label>`;
}

export function table(headers, rows, caption = '') {
  return `<div class="table-wrap"><table aria-label="${e(caption || 'Data table')}"><thead><tr>${headers.map(heading => {
    const numeric = Array.isArray(heading);
    return `<th scope="col"${numeric ? ' class="num"' : ''}>${e(numeric ? heading[0] : heading)}</th>`;
  }).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) =>
    `<td${Array.isArray(headers[index]) ? ' class="num"' : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function ticks(min, max) {
  const raw = (max - min) / 4 || 1;
  const unit = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(value => value * unit).find(value => value >= raw);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => start + index * step);
}

export function chart({ label, labels, series, zero = false, format = pointTotal, unit = '', dataHeading = 'Round' }) {
  const values = series.flatMap(line => line.values.filter(Number.isFinite));
  if (!values.length) return empty('No points to plot for this selection.');
  const tickValues = ticks(zero ? 0 : Math.min(...values) * .998, Math.max(...values) * 1.002);
  const low = tickValues[0];
  const high = tickValues.at(-1);
  const start = 53;
  const end = 625;
  const top = 12;
  const bottom = 212;
  const x = index => start + (end - start) * index / Math.max(1, labels.length - 1);
  const y = value => bottom - (bottom - top) * (value - low) / (high - low || 1);
  const labelStep = Math.max(1, Math.ceil((labels.length - 1) / 7));
  const shown = labels.map((entry, index) => ({ entry, index })).filter(({ index }) => index === labels.length - 1 || index % labelStep === 0 && index <= labels.length - 1 - labelStep);
  const readable = (entry, index) => `${entry.detail ?? entry.short} · ${series.map(line => `${line.name} ${format(line.values[index])}${unit && Number.isFinite(line.values[index]) ? unit : ''}`).join(' · ')}`;
  return `<div class="chart-block">
    <div class="legend">${series.map(line => `<span>${dot(line.color)}${e(line.name)}</span>`).join('')}</div>
    <svg class="chart" viewBox="0 0 640 241" aria-label="${e(label)}">
      <title>${e(label)}</title>
      ${tickValues.map(tick => `<line class="gridline" x1="${start}" x2="${end}" y1="${y(tick)}" y2="${y(tick)}"/><text x="46" y="${y(tick) + 4}" text-anchor="end">${e(format(tick))}</text>`).join('')}
      ${shown.map(({ entry, index }) => `<text x="${x(index)}" y="234" text-anchor="middle">${e(entry.short)}</text>`).join('')}
      ${series.map(line => {
        let previous = false;
        const path = line.values.map((value, index) => {
          if (!Number.isFinite(value)) { previous = false; return ''; }
          const coordinates = `${previous ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
          previous = true;
          return coordinates;
        }).join(' ');
        return `<path d="${path}" fill="none" stroke="${line.color}" stroke-width="2.4" vector-effect="non-scaling-stroke"/>${line.values.map((value, index) => Number.isFinite(value) && (index === line.values.length - 1 || !Number.isFinite(line.values[index - 1]) && !Number.isFinite(line.values[index + 1]))
          ? `<circle class="chart-marker" cx="${x(index)}" cy="${y(value)}" r="3.5" stroke="${line.color}"/>` : '').join('')}`;
      }).join('')}
      ${labels.map((entry, index) => {
        const width = Math.min(24, (end - start) / Math.max(1, labels.length - 1));
        const readout = e(readable(entry, index));
        return `<rect data-chart-hit="${readout}" tabindex="${index === 0 ? 0 : -1}" role="img" aria-label="${readout}" x="${x(index) - width / 2}" y="${top}" width="${width}" height="${bottom - top}"><title>${readout}</title></rect>`;
      }).join('')}
    </svg>
    <p class="chart-readout" aria-hidden="true">Hover or use arrow keys to inspect the chart.</p>
    <details class="data-table"><summary>View chart data</summary>${table([dataHeading, ...series.map(line => [line.name])], labels.map((entry, index) => [e(entry.detail ?? entry.short), ...series.map(line => e(format(line.values[index])))]), label)}</details>
  </div>`;
}

export function download(name, rows) {
  const csv = rows.map(row => row.map(value => {
    const raw = String(value ?? '');
    const safe = typeof value === 'string' && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
