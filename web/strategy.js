import { open } from './data.js';
import { median } from './metrics.js';
import { chart, decimals, display, dot, e, empty, lapTime, palette, panelHead, table } from './ui.js';

const compounds = {
  SOFT: '#ff5d74', MEDIUM: '#f1d36b', HARD: '#ececf2',
  INTERMEDIATE: '#58dba0', WET: '#6ba9ff', UNKNOWN: '#8f8e9b'
};
const pitColor = '#ffb278';
const flagColor = '#c29bff';
const hasLap = value => Number.isInteger(value) && value > 0;
const positive = value => Number.isFinite(value) && value > 0;

export async function loadStrategyContext(sessionKey) {
  const filter = { session_key: sessionKey };
  const [control, weather] = await Promise.allSettled([
    open('race_control', filter), open('weather', filter)
  ]);
  return {
    control: control.value ?? [],
    weather: weather.value ?? [],
    missing: [
      control.status === 'rejected' && 'race control',
      weather.status === 'rejected' && 'weather'
    ].filter(Boolean)
  };
}

export function strategyComparison(drivers, timing, raceControl = []) {
  const byNumber = new Map(drivers.map(driver => [driver.number, {
    ...driver, laps: new Map(), stints: [], pits: []
  }]));
  for (const entry of timing.laps) {
    if (hasLap(entry.lap) && positive(entry.seconds)) byNumber.get(entry.number)?.laps.set(entry.lap, entry.seconds);
  }
  for (const stint of timing.stints) {
    if (hasLap(stint.first) && hasLap(stint.last) && stint.last >= stint.first) byNumber.get(stint.number)?.stints.push(stint);
  }
  for (const pit of timing.pits) {
    if (hasLap(pit.lap)) byNumber.get(pit.number)?.pits.push(pit);
  }
  const rows = Array.from(byNumber.values(), driver => ({
    ...driver,
    stints: driver.stints.sort((a, b) => a.first - b.first),
    pits: driver.pits.sort((a, b) => a.lap - b.lap)
  }));
  const length = Math.max(0, ...rows.flatMap(row => [
    ...row.laps.keys(), ...row.pits.map(pit => pit.lap), ...row.stints.map(stint => stint.last)
  ]));
  const laps = Array.from({ length }, (_, i) => i + 1);
  const [first, second] = rows;
  const delta = second ? laps.map(lap => first.laps.has(lap) && second.laps.has(lap)
    ? first.laps.get(lap) - second.laps.get(lap) : null) : [];
  const flags = raceControl.filter(item => /safety\s*car/i.test(item.category ?? '') ||
    item.flag === 'RED' || /(?:VIRTUAL )?SAFETY CAR|RED FLAG/i.test(item.message ?? ''))
    .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return { rows, laps, delta, flags };
}

const niceTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(11, 19) : '—';
const compoundName = value => value?.toUpperCase() || 'UNKNOWN';

function timeline({ rows, laps, flags }) {
  const count = laps.length;
  if (!count) return empty('No lap-numbered timing or strategy records for this comparison.');
  const left = 60;
  const right = 633;
  const width = (right - left) / count;
  const x = lap => left + (lap - 1) * width;
  const height = 44 + rows.length * 34;
  const flagged = new Map();
  for (const flag of flags) {
    if (!hasLap(flag.lap_number) || flag.lap_number > count) continue;
    const list = flagged.get(flag.lap_number) ?? [];
    list.push(flag.message ?? flag.category ?? flag.flag);
    flagged.set(flag.lap_number, list);
  }
  const tick = Math.max(1, Math.ceil(count / 7));
  const labels = laps.filter(lap => lap === count || (lap - 1) % tick === 0 && lap <= count - tick * .6);
  const usedCompounds = [...new Set(rows.flatMap(row => row.stints.map(stint => compoundName(stint.compound))))];
  return `<div class="legend">${usedCompounds.map(label => `<span>${dot(compounds[label] ?? compounds.UNKNOWN)}${e(label)}</span>`).join('')}
    <span>${dot(pitColor)} Pit visit</span>${flagged.size ? `<span>${dot(flagColor)} Race control event</span>` : ''}</div>
    <svg class="strategy-timeline" viewBox="0 0 640 ${height}" role="img" aria-label="Tyre stints and pit visits by race lap">
      <title>Race strategy timeline. A table below provides the underlying events.</title>
      ${[...flagged].map(([lap, messages]) => `<line x1="${x(lap) + width / 2}" x2="${x(lap) + width / 2}" y1="9" y2="${height - 25}" stroke="${flagColor}" stroke-dasharray="3 3" opacity=".7"><title>${e(`Lap ${lap}: ${messages.join(' · ')}`)}</title></line>`).join('')}
      ${rows.map((row, index) => {
        const y = 25 + index * 34;
        return `<text x="0" y="${y + 4}" class="strategy-driver">${e(row.code)}</text>
        <line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="14"/>
        ${row.stints.map(stint => {
          const label = compoundName(stint.compound);
          return `<rect x="${x(stint.first)}" y="${y - 7}" width="${Math.max(0, (stint.last - stint.first + 1) * width - 1)}" height="14" rx="2" fill="${compounds[label] ?? compounds.UNKNOWN}" opacity=".85"><title>${e(`${row.code} · ${label} · laps ${stint.first}–${stint.last}`)}</title></rect>`;
        }).join('')}
        ${row.pits.map(pit => `<circle cx="${x(pit.lap) + width / 2}" cy="${y}" r="4.5" stroke="#101014" stroke-width="1.5" fill="${pitColor}"><title>${e(`${row.code} pit visit · lap ${pit.lap}`)}</title></circle>`).join('')}`;
      }).join('')}
      ${labels.map(lap => `<text x="${x(lap) + width / 2}" y="${height - 7}" text-anchor="middle">${lap}</text>`).join('')}
    </svg>`;
}

function eventTables({ rows, flags }, weather) {
  const stints = rows.flatMap(row => row.stints.map(stint => [
    e(row.code), e(compoundName(stint.compound)), display(stint.first), display(stint.last), display(stint.age)
  ]));
  const pits = rows.flatMap(row => row.pits.map(pit => [
    e(row.code), display(pit.lap), decimals(pit.lane, 3), decimals(pit.stop, 3)
  ]));
  const recorded = weather.filter(item => Number.isFinite(Date.parse(item.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const rain = recorded.some(item => item.rainfall === true || item.rainfall === 1);
  const dry = recorded.some(item => item.rainfall === false || item.rainfall === 0);
  return `<div class="split">
    <section class="panel">${panelHead('Tyre stints', 'Recorded race-lap boundaries')}
      ${stints.length ? table(['Driver', 'Compound', ['Start lap'], ['End lap'], ['Tyre age']], stints, 'Compared tyre stints') : empty('No archived tyre stints for these drivers.')}
    </section>
    <section class="panel">${panelHead('Pit windows', 'Lane transit and stationary time are separate measures')}
      ${pits.length ? table(['Driver', ['Lap'], ['Lane (s)'], ['Stationary (s)']], pits, 'Compared pit windows') : empty('No pit visits recorded for these drivers.')}
    </section>
    <section class="panel">${panelHead('Race control', 'Safety-car and red-flag messages in session order')}
      ${flags.length ? `<div class="strategy-scroll">${table([['Lap'], 'UTC', 'Message'], flags.map(flag => [
        display(flag.lap_number), niceTime(flag.date), display(flag.message ?? flag.category)
      ]), 'Race control events')}</div>` : empty('No safety-car or red-flag messages in the available archive.')}
    </section>
    <section class="panel">${panelHead('Track weather', recorded.length ? `${recorded.length} available UTC samples · ${rain ? 'Rain recorded' : dry ? 'No rain flagged in available samples' : 'Rainfall status unavailable'}` : '')}
      ${recorded.length ? `<div class="strategy-scroll">${table(['UTC', ['Track °C'], ['Air °C'], ['Humidity %'], 'Rain'], recorded.map(item => [
        niceTime(item.date), decimals(item.track_temperature), decimals(item.air_temperature), decimals(item.humidity),
        item.rainfall == null ? '—' : item.rainfall ? 'Yes' : 'No'
      ]), 'Track weather samples')}</div>` : empty('No archived weather samples for this race.')}
    </section>
  </div>`;
}

export function strategyView(timingState, contextState, drivers) {
  if (!timingState || timingState.loading) return empty('Loading Race Strategy Lab…');
  if (timingState.error) return empty(timingState.error, 'timing');
  const timing = timingState.data;
  if (!timing) return empty('Waiting for a matching archived race session.', 'timing');
  if (!drivers.length) return empty('Choose a driver with recorded race timing.');
  const context = contextState?.data ?? { control: [], weather: [], missing: [] };
  const comparison = strategyComparison(drivers, timing, context.control);
  const { rows, laps, delta } = comparison;
  const matched = delta.filter(Number.isFinite);
  const labels = laps.map(lap => ({ short: String(lap), detail: `Lap ${lap}` }));
  const series = rows.map((row, i) => ({ name: row.code, color: palette[i], values: laps.map(lap => row.laps.get(lap) ?? null) }));
  const unavailable = [...timing.missing, ...context.missing];
  const contextNotice = contextState?.loading ? '<p class="subtle" role="status">Loading weather and race control…</p>'
    : contextState?.error ? empty(contextState.error, 'strategy') : '';
  const middle = median(matched);
  return `<div class="stack">
    ${unavailable.length ? `<p class="callout">Unavailable from the archive: ${e(unavailable.join(', '))}. <button class="secondary" type="button" data-retry="strategy">Retry data</button></p>` : ''}
    <section class="panel">${panelHead('Race Strategy Lab', 'Compare tyres, pit visits and lap pace on the same race-lap scale.')}
      ${timeline(comparison)}
    </section>
    <section class="panel">${panelHead('Lap pace comparison', 'Recorded laps exclude pit-out laps. Traffic, pit-in laps, and race neutralisations can affect pace.')}
      ${chart({ label: 'Race strategy lap pace', labels, series, format: lapTime, dataHeading: 'Lap', exportUnit: 's' })}
    </section>
    ${matched.length ? `<section class="panel">${panelHead('Matched-lap pace delta', `${rows[0].code} minus ${rows[1].code} · ${matched.length} shared timed laps · median ${middle > 0 ? '+' : ''}${decimals(middle, 3)} s`)}
      ${chart({ label: 'Matched-lap pace delta', labels, series: [{ name: `${rows[0].code} − ${rows[1].code}`, color: palette[1], values: delta }], format: value => decimals(value, 3), unit: ' s', dataHeading: 'Lap', exportUnit: 's' })}
    </section>` : ''}
    ${contextNotice}${eventTables(comparison, context.weather)}
    <p class="data-stamp">OpenF1 race session ${e(timing.sessionKey)}${timing.pitSource ? ` · Pit timing fallback ${e(timing.pitSource)}` : ''}</p>
  </div>`;
}
