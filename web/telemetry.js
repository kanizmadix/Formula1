import { JOLPICA, OPENF1, json } from './data.js';
import { display, dot, e, empty, lapTime, palette, panelHead, select, table } from './ui.js';

const maxLapSeconds = 600;
const maxGapSeconds = 1;
const slots = ['first', 'second'];
const channels = [
  { key: 'speed', label: 'Speed', unit: 'km/h' },
  { key: 'throttle', label: 'Throttle', unit: '%' },
  { key: 'brake', label: 'Brake', discrete: true },
  { key: 'gear', label: 'Gear', discrete: true }
];

function integer(value, minimum = 1) {
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : null;
}

function timestamp(value) {
  return typeof value === 'string' && /T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}

function lapWindow(lap) {
  const driver = integer(lap?.driver_number, 0);
  const lapNumber = integer(lap?.lap_number);
  const start = timestamp(lap?.date_start);
  const duration = lap?.lap_duration;
  if (driver === null || lapNumber === null || !Number.isFinite(start)
      || !Number.isFinite(duration) || duration < .001 || duration > maxLapSeconds) return null;
  return { driver, lapNumber, start, end: start + Math.round(duration * 1000), duration };
}

function usableLaps(driverLaps) {
  return [...new Map((driverLaps ?? []).filter(lapWindow).map(lap => [Number(lap.lap_number), lap])).values()];
}

// Returns a lap number from one driver's raw OpenF1 lap array.
export function defaultTelemetryLap(driverLaps) {
  const choices = usableLaps(driverLaps).sort((a, b) =>
    Number(a.is_pit_out_lap === true) - Number(b.is_pit_out_lap === true)
    || a.lap_duration - b.lap_duration || a.lap_number - b.lap_number);
  return choices.length ? Number(choices[0].lap_number) : null;
}

function boundedValue(value, maximum) {
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}

function lapSamples(rows, session, window) {
  const { driver, start, end } = window;
  const byTime = new Map();
  for (const row of rows) {
    const time = timestamp(row?.date);
    if (!Number.isFinite(time) || time < start || time >= end
        || integer(row.session_key) !== session || integer(row.driver_number, 0) !== driver) continue;
    const sample = {
      elapsed: (time - start) / 1000,
      speed: boundedValue(row.speed, 500),
      throttle: boundedValue(row.throttle, 100),
      brake: row.brake === 0 || row.brake === 100 ? row.brake : null,
      gear: Number.isInteger(row.n_gear) ? boundedValue(row.n_gear, 8) : null
    };
    const existing = byTime.get(time);
    if (existing) {
      for (const { key } of channels) existing[key] ??= sample[key];
    } else {
      byTime.set(time, sample);
    }
  }
  return [...byTime.values()].sort((a, b) => a.elapsed - b.elapsed);
}

async function fetchLap(session, window) {
  const { driver, lapNumber, start, end, duration } = window;
  const url = `${OPENF1}car_data?session_key=${session}&driver_number=${driver}`
    + `&date%3E=${new Date(start).toISOString()}&date%3C${new Date(end).toISOString()}`;
  const rows = await json(url, { ttl: 0, retries: 0 });
  if (!Array.isArray(rows)) throw new Error('OpenF1 returned an unexpected telemetry response.');
  return { driver, lapNumber, duration, samples: lapSamples(rows, session, window) };
}

/**
 * Accepts a numeric archived Race session key and [firstRawLap, secondRawLap].
 * Slots may be null. Returns { source, sessionKey, series } in the same order.
 */
export async function loadTelemetry(sessionKey, lapSelections) {
  const session = integer(sessionKey);
  if (session === null) throw new Error('An archived OpenF1 session is required.');
  const attempts = await Promise.allSettled(slots.map((_, index) => {
    const lap = lapSelections?.[index];
    if (lap == null) return null;
    const window = lapWindow(lap);
    if (!window || (lap.session_key != null && integer(lap.session_key) !== session)) {
      return { driver: integer(lap.driver_number, 0), lapNumber: integer(lap.lap_number),
        samples: [], error: 'This lap has no usable timing window for the selected session.' };
    }
    return fetchLap(session, window);
  }));
  const failure = attempts.find(result => result.status === 'rejected');
  if (failure && !attempts.some(result => result.value?.duration)) throw failure.reason;
  return {
    source: 'OpenF1',
    sessionKey: session,
    series: attempts.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const lap = lapSelections[index];
      return { driver: Number(lap.driver_number), lapNumber: Number(lap.lap_number),
        duration: lap.lap_duration, samples: [], error: result.reason?.message || 'OpenF1 could not load this lap.' };
    })
  };
}

function telemetryControls(drivers, laps, selectedLaps) {
  const fields = slots.map((slot, index) => {
    const driver = drivers[index];
    if (driver?.number == null) return '';
    const choices = usableLaps(laps?.[driver.number]).sort((a, b) => a.lap_number - b.lap_number);
    const options = choices.map(lap =>
      [Number(lap.lap_number), `Lap ${lap.lap_number} · ${lapTime(lap.lap_duration)}${lap.is_pit_out_lap ? ' · Pit out' : ''}`]);
    const selected = integer(selectedLaps[index]);
    if (!options.some(([number]) => number === selected)) {
      options.unshift([selected ?? '', selected ? `Lap ${selected} · Timing unavailable` : (choices.length ? 'Choose a lap' : 'No timed laps')]);
    }
    return select(`telemetry-${slot}-lap`, `${driver.code || driver.name || `#${driver.number}`} lap`, selected ?? '', options);
  }).join('');
  return fields ? `<div class="control-row">${fields}</div>` : '';
}

function trace(samples, key, discrete, x, y) {
  const commands = [];
  const markers = [];
  const connects = (first, second) => first?.[key] != null && second?.[key] != null
    && second.elapsed <= first.elapsed + maxGapSeconds;
  for (const [index, sample] of samples.entries()) {
    if (sample[key] == null) continue;
    const px = x(sample.elapsed).toFixed(2);
    const py = y(sample[key]).toFixed(2);
    if (connects(samples[index - 1], sample)) {
      commands.push(discrete ? `H${px}V${py}` : `L${px},${py}`);
    } else {
      commands.push(`M${px},${py}`);
      if (!connects(sample, samples[index + 1])) markers.push([px, py]);
    }
  }
  return { path: commands.join(' '), markers };
}

function telemetryChart(channel, series, duration) {
  const { key, label, unit, discrete } = channel;
  let ticks = [0, 25, 50, 75, 100];
  if (key === 'speed') {
    const peak = Math.max(0, ...series.flatMap(line => line.samples.map(sample => sample.speed ?? 0)));
    const step = 25 * Math.max(1, Math.ceil(peak / 100));
    ticks = [0, step, step * 2, step * 3, step * 4];
  } else if (key === 'brake') {
    ticks = [0, 100];
  } else if (key === 'gear') {
    ticks = [0, 2, 4, 6, 8];
  }
  const x = seconds => 48 + 572 * seconds / duration;
  const y = value => 150 - 135 * value / ticks.at(-1);
  const title = unit ? `${label} (${unit})` : label;
  const timeTicks = Array.from({ length: 7 }, (_, index) => index * duration / 6);
  return `<section class="panel">${panelHead(title)}
    ${series.some(line => line.samples.some(sample => sample[key] != null)) ? `
    <svg class="chart" viewBox="0 0 640 195" role="img" aria-label="${e(label)} by elapsed lap time">
      ${ticks.map(value => `<line class="gridline" x1="48" x2="620" y1="${y(value)}" y2="${y(value)}"/>
        <text x="42" y="${y(value) + 4}" text-anchor="end">${key === 'brake' ? (value ? 'On' : 'Off') : value}</text>`).join('')}
      ${timeTicks.map(seconds => `<text x="${x(seconds)}" y="169" text-anchor="middle">${Number(seconds.toPrecision(3))}</text>`).join('')}
      <text x="334" y="189" text-anchor="middle">Elapsed lap time (s)</text>
      ${series.map(line => {
        const { path, markers } = trace(line.samples, key, discrete, x, y);
        return `<path d="${path}" fill="none" stroke="${line.color}" stroke-width="2" vector-effect="non-scaling-stroke"${line.dashed ? ' stroke-dasharray="5 3"' : ''}/>
          ${markers.map(([px, py]) => `<circle class="chart-marker" cx="${px}" cy="${py}" r="3" stroke="${line.color}"/>`).join('')}`;
      }).join('')}
    </svg>` : '<p class="subtle">No usable samples for this channel.</p>'}
  </section>`;
}

function coverage(line) {
  if (line.error) return line.error;
  const captured = line.samples.filter(sample => channels.some(({ key }) => sample[key] != null));
  if (!captured.length) return 'No usable samples in this lap window.';
  const gaps = captured[0].elapsed > maxGapSeconds
    || line.duration > captured.at(-1).elapsed + maxGapSeconds
    || captured.some((sample, index) => index > 0 && sample.elapsed > captured[index - 1].elapsed + maxGapSeconds);
  const incomplete = channels.filter(({ key }) => line.samples.some(sample => sample[key] == null));
  const notes = [
    `${captured.length} samples from ${captured[0].elapsed.toFixed(2)} to ${captured.at(-1).elapsed.toFixed(2)} s`,
    gaps && 'recording gaps',
    incomplete.length > 0 && `missing values in ${incomplete.map(channel => channel.label.toLowerCase()).join(', ')}`
  ];
  return notes.filter(Boolean).join(' · ');
}

function telemetryExport(line, sessionKey) {
  const filename = `telemetry-${sessionKey}-car-${line.driver}-lap-${line.lapNumber}.csv`;
  const rows = [
    ['Elapsed lap time (s)', 'Speed (km/h)', 'Throttle (%)', 'Brake (0 off, 100 on)', 'Gear (number)'],
    ...line.samples.map(({ elapsed, speed, throttle, brake, gear }) => [elapsed, speed, throttle, brake, gear])
  ];
  return `<button type="button" class="secondary" data-chart-csv="${e(JSON.stringify({ filename, rows }))}">Download CSV · ${e(line.label)}</button>`;
}

/**
 * State uses { loading, error, data }; drivers and selectedLaps are positional
 * pairs. Laps is an object mapping driver number to arrays of raw lap records.
 * Select changes emit telemetry-first-lap / telemetry-second-lap via data-select.
 */
export function telemetryView(state, drivers = [], laps, selectedLaps = []) {
  const controls = telemetryControls(drivers, laps, selectedLaps);
  if (state?.error) return `${controls}${empty(state.error, 'telemetry')}`;
  if (state?.loading || !state) return `${controls}${empty('Loading archived race telemetry…')}`;
  const series = (state.data?.series ?? []).flatMap((line, index) => {
    const driver = drivers[index];
    if (!driver || !line || line.driver !== integer(driver.number, 0)
        || line.lapNumber !== integer(selectedLaps[index])) return [];
    return [{ ...line, label: `${driver.name || driver.code || `#${line.driver}`} · Lap ${line.lapNumber}`,
      color: palette[index], dashed: index === 1 }];
  });
  if (!series.length) {
    const available = drivers.some(driver => driver?.number != null && usableLaps(laps?.[driver.number]).length > 0);
    return `${controls}${empty(state.unavailable || (available
      ? 'Choose a timed lap for a selected driver.'
      : 'The OpenF1 archive has no usable timed laps for the selected drivers.'), available ? '' : 'timing')}`;
  }
  const hasSamples = series.some(line => line.samples.some(sample => channels.some(({ key }) => sample[key] != null)));
  const duration = Math.max(...series.map(line => line.duration ?? 0));
  return `${controls}<div class="stack">
    <section class="panel">
      ${panelHead('Lap telemetry', 'OpenF1 · Each lap starts at its own approximate lap start. Gaps over one second break the traces.')}
      <div class="legend">${series.map(line =>
        `<span>${dot(line.color)}${e(line.label)} · ${e(coverage(line))}</span>`).join('')}</div>
      <div class="control-row">${series.filter(line => line.samples.length).map(line => telemetryExport(line, state.data.sessionKey)).join('')}
        ${series.some(line => line.error || !line.samples.length) ? '<button type="button" class="button" data-retry="telemetry">Try again</button>' : ''}
      </div>
    </section>
    ${hasSamples ? `<div class="split">${channels.map(channel => telemetryChart(channel, series, duration)).join('')}</div>
    <details class="panel data-table"><summary>View recorded samples</summary>${series.filter(line => line.samples.length).map(line =>
      `<h3>${e(line.label)}</h3>${table([['Elapsed (s)'], ['Speed (km/h)'], ['Throttle (%)'], 'Brake', ['Gear']],
        line.samples.map(sample => [sample.elapsed.toFixed(3), display(sample.speed), display(sample.throttle),
          sample.brake == null ? '—' : sample.brake ? 'On' : 'Off', display(sample.gear)]), line.label)}`).join('')}</details>`
    : empty('OpenF1 has no usable telemetry samples for the selected laps.')}
  </div>`;
}

export async function loadQualifying(year, race) {
  const season = integer(year);
  const round = integer(race?.round);
  if (season === null || round === null) throw new Error('A season and race round are required.');
  const response = await json(`${JOLPICA}${season}/${round}/qualifying/?limit=100&offset=0`, { ttl: 0 });
  const data = response?.MRData;
  const races = data?.RaceTable?.Races;
  if (!Array.isArray(races)) throw new Error('Jolpica returned an unexpected qualifying response.');
  const event = races.find(row => Number(row?.season) === season && Number(row?.round) === round);
  if (event && !Array.isArray(event.QualifyingResults)) throw new Error('Jolpica returned incomplete qualifying data.');
  const raw = event?.QualifyingResults ?? [];
  const results = raw.filter(row => row?.Driver?.driverId).map(row => ({
    id: row.Driver.driverId,
    number: integer(row.number, 0),
    name: [row.Driver.givenName, row.Driver.familyName].filter(Boolean).join(' ') || row.Driver.driverId,
    team: row.Constructor?.name,
    position: integer(row.position),
    q1: row.Q1, q2: row.Q2, q3: row.Q3
  })).sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  return { source: 'Jolpica F1', results, partial: results.length < raw.length || Number(data.total) > raw.length };
}

function movement(from, to) {
  if (from === null || to === null) return '—';
  const change = from - to;
  return change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0';
}

function qualifyingRows(qualifying, results) {
  const joined = qualifying.map(entry => {
    const matches = results.filter(result => result.id === entry.id);
    const raceResult = matches.length === 1 ? matches[0]
      : matches.find(result => integer(result.number, 0) === entry.number && entry.number !== null);
    return { entry, raceResult };
  });
  return [...joined, ...results.filter(raceResult => !joined.some(row => row.raceResult === raceResult))
    .map(raceResult => ({ raceResult }))].map(({ entry, raceResult }) => {
    const grid = integer(raceResult?.grid, 0);
    const finish = integer(raceResult?.classification);
    return [
      display(entry?.name ?? raceResult?.name), display(entry?.team ?? raceResult?.team),
      display(entry?.position), display(entry?.q1), display(entry?.q2), display(entry?.q3),
      grid === 0 ? 'No grid slot (0)' : display(grid),
      display(finish ?? raceResult?.classification), display(raceResult?.status),
      movement(entry?.position ?? null, finish), movement(grid === 0 ? null : grid, finish)
    ];
  });
}

/** State uses { loading, error, data }; race.results contains normalized Jolpica results. */
export function qualifyingView(state, race) {
  const results = race?.results ?? [];
  const qualifying = state?.data?.results ?? [];
  let notice = '';
  if (!state || state.loading) notice = empty('Loading qualifying results…');
  else if (state.error) notice = empty(state.error, 'qualifying');
  else if (!qualifying.length) notice = empty('Jolpica has no qualifying results for this round.', 'qualifying');
  else if (state.data.partial) notice = '<p class="callout">Jolpica returned partial qualifying results.</p>';
  const rows = qualifyingRows(qualifying, results);
  return `<div class="stack">${notice}${rows.length ? `<section class="panel">
    ${panelHead('Qualifying and race positions', 'Jolpica F1 · Positive changes are places gained. Changes require a classified finish and a recorded qualifying or grid position.')}
    ${table(['Driver', 'Constructor', ['Qual.'], ['Q1'], ['Q2'], ['Q3'], 'Grid', 'Finish', 'Race status',
      ['Qual. → finish'], ['Grid → finish']], rows, 'Qualifying results and race position changes')}
  </section>` : ''}</div>`;
}
