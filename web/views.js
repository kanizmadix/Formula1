import { utcRaceTime } from './data.js';
import { projectionInterval } from './forecast-validation.js';
import { byAge, completed, cumulative, leaders, median, model, racePoints } from './metrics.js';
import {
  chart, date, decimals, display, dot, e, empty, icon, lapTime, pageTitle,
  panelHead, palette, pointTotal, roundLabel, segments, select, table, tag, teamColor
} from './ui.js';

export const modes = [['drivers', 'Drivers'], ['teams', 'Constructors']];
export const raceTabs = [
  ['results', 'Results', 'race'], ['strategy', 'Strategy Lab', 'tyre'], ['telemetry', 'Telemetry', 'telemetry'],
  ['timing', 'Laps & pits', 'pit'], ['qualifying', 'Qualifying', 'qualifying'], ['circuit', 'Circuit', 'pin']
];
const raceLink = (year, race, tab = 'results') => `#race/${year}/${race.round}/${tab}`;
const podium = race => race?.results.find(row => row.classification === '1');
const status = (race, next) => race.results.length ? tag('Final', 'complete')
  : race.round === next?.round ? tag('Next race', 'next') : tag(utcRaceTime(race) < Date.now() ? 'Awaiting results' : 'Scheduled');
const raceLabel = race => `${roundLabel(race.round)} · ${race.name}`;
const keyTime = race => `${date(race.date)}${race.at ? ` · ${e(race.at.slice(0, 5))} UTC` : ''}`;
const rank = value => `<span class="rank${String(value) === '1' ? ' first' : ''}">${display(value)}</span>`;
const name = (text, description) => `<strong>${display(text)}</strong>${description ? `<small>${e(description)}</small>` : ''}`;
const formatUpdated = value => `${date(value, true)} · ${new Date(value).toISOString().slice(11, 16)} UTC`;
const nextRace = season => season.races.find(race => !race.results.length && utcRaceTime(race) > Date.now());
const dateStamp = (season, cached) => `<p class="data-stamp"><span class="live-dot" aria-hidden="true"></span> Jolpica F1 · ${cached ? 'Snapshot' : 'Fetched'} ${formatUpdated(season.fetchedAt)}</p>`;
const positionTable = (rows, kind, full = false) => {
  const teams = kind === 'teams';
  return table(['Pos', teams ? 'Constructor' : 'Driver', ...(full ? ['Nationality', ['Wins']] : []), ['Pts']], rows.map(row => [
    rank(row.rank),
    `${dot(teamColor(teams ? row.id : row.teamId, row.rank - 1))}&nbsp; ${name(row.name, teams ? '' : row.team)}`,
    ...(full ? [display(row.country), pointTotal(row.wins)] : []),
    `<strong>${pointTotal(row.points)}</strong>`
  ]), `${teams ? 'Constructor' : 'Driver'} standings`);
};

function stat(title, value, description, glyph) {
  return `<article class="stat"><div class="stat-top"><span class="metric-label">${e(title)}</span>${icon(glyph)}</div><strong>${display(value)}</strong><small>${e(description)}</small></article>`;
}

function kpi(title, value, detail) {
  return `<div class="kpi"><span class="metric-label">${e(title)}</span><strong>${display(value)}</strong><span class="meta">${e(detail)}</span></div>`;
}

function raceCard(season, race, next) {
  return `<a class="race-card" href="${raceLink(season.year, race)}">
    <span class="race-card-top"><span>${roundLabel(race.round)} · ${date(race.date).toUpperCase()}</span>${status(race, next)}</span>
    <strong>${e(race.name)}</strong><span class="meta">${e(race.city)}, ${e(race.country)}</span>
    ${podium(race) ? `<span class="row-note">${e(podium(race).name)} · Winner</span>` : ''}
  </a>`;
}

function trajectories(season, mode, selections = []) {
  const races = completed(season);
  const teams = mode === 'teams';
  const rows = season[mode];
  const selected = selections.length ? selections.flatMap(id => rows.find(row => row.id === id) ?? []) : rows.slice(0, 3);
  const series = selected.map((row, index) => ({
    name: teams ? row.name : row.code,
    color: palette[index % palette.length],
    values: cumulative(racePoints(races, row.id, teams))
  }));
  return chart({
    label: 'Cumulative Grand Prix and sprint points',
    labels: races.map(race => ({ short: roundLabel(race.round), detail: raceLabel(race) })),
    zero: true, series
  });
}

export function overview(season, mode, cached) {
  const finished = completed(season);
  const last = finished.at(-1);
  const next = nextRace(season);
  const driver = season.drivers[0];
  const team = season.teams[0];
  const focus = last || next || season.races[0];
  const cards = next ? season.races.slice(season.races.indexOf(next), season.races.indexOf(next) + 3) : season.races.slice(-3).reverse();
  return `<section class="hero">
    <div class="start-lights" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<span style="--lamp:${i}"></span>`).join('')}</div>
    <div class="hero-inner"><span class="eyebrow">${season.year} FORMULA 1 SEASON</span><h1>Race <span>Lab</span></h1>
      <p>Explore the championship, compare lap pace, and see how pit strategy shaped each race.</p>
      <div class="inline-controls"><a class="button" href="${raceLink(season.year, focus)}">Explore ${last ? 'latest results' : 'race weekend'} ${icon('arrow')}</a>
      ${last && season.year >= 2023 ? `<a class="secondary" href="${raceLink(season.year, last, 'strategy')}">Strategy Lab</a>` : ''}</div>
    </div>
  </section>
  <div class="stats">
    ${stat('Rounds complete', `${finished.length} / ${season.races.length}`, 'Grand Prix results published', 'race')}
    ${stat('Leading driver', driver?.name, driver ? `${pointTotal(driver.points)} PTS · ${driver.team ?? 'Driver standings'}` : 'Standings pending', 'standings')}
    ${stat('Leading constructor', team?.name, team ? `${pointTotal(team.points)} PTS` : season.year < 1958 ? 'Championship began in 1958' : 'Standings pending', 'team')}
    ${stat(next ? 'Next race' : 'Last race', (next || last)?.city, next ? `${date(next.date)} · ${next.country}` : last ? `${date(last.date)} · ${last.country}` : 'Calendar pending', 'pin')}
  </div>
  <div class="dash-grid">
    <section class="panel">
      ${panelHead('Championship trajectory', 'Cumulative points awarded in races and sprints', segments('mode', mode, modes, 'Championship'))}
      ${trajectories(season, mode)}
      <p class="subtle">Standings show the official totals, including championship adjustments.</p>
    </section>
    <div class="stack">
      <section class="panel">
        ${panelHead(mode === 'teams' ? 'Constructor standings' : 'Driver standings', season[mode].length ? `Published after round ${mode === 'teams' ? season.teamRound : season.driverRound}` : '', '<a class="text-link" href="#standings">Full table ↗</a>')}
        ${season[mode].length ? positionTable(season[mode].slice(0, 5), mode) : empty('Standings are unavailable for this season.')}
      </section>
      ${last ? `<section class="panel">
        ${panelHead('Latest result', `${roundLabel(last.round)} · ${date(last.date)}`)}
        <a class="link-row" href="${raceLink(season.year, last)}"><span><strong>${e(last.name)}</strong><span class="meta">${display(podium(last)?.name)} · Winner</span></span>${icon('arrow')}</a>
      </section>` : ''}
    </div>
  </div>
  <div class="section-title"><h2>${next ? 'Upcoming weekends' : 'Latest weekends'}</h2><a href="#calendar">Full calendar ↗</a></div>
  <div class="weekend">${cards.map(race => raceCard(season, race, next)).join('')}</div>
  ${dateStamp(season, cached)}`;
}

export function standings(season, mode, compare, cached) {
  const rows = season[mode];
  const options = rows.map(row => [row.id, row.name]);
  return `${pageTitle('Standings', `Driver and constructor championship tables for ${season.year}, with race-by-race points comparisons.`)}
  <div class="control-row">${segments('mode', mode, modes, 'Championship')}</div>
  ${rows.length ? `<div class="dash-grid">
    <section class="panel">${panelHead(mode === 'teams' ? 'Constructors' : 'Drivers', `Published after round ${mode === 'teams' ? season.teamRound : season.driverRound}`, '<button type="button" class="secondary" data-download="standings">Download CSV</button>')}${positionTable(rows, mode, true)}</section>
    <section class="panel">${panelHead('Compare points', 'Race and sprint points awarded by round')}
    <div class="control-row">
      ${select('standings-first', 'First', compare[0], options)}
      ${select('standings-second', 'Second', compare[1], [['', 'None'], ...options])}
      <button class="secondary" type="button" data-share>Copy comparison link</button>
      <span class="meta" data-share-status role="status"></span>
    </div>
    ${trajectories(season, mode, compare)}
    <p class="subtle">Official totals can differ due to championship adjustments.</p></section>
  </div>` : empty(mode === 'teams' && season.year < 1958 ? 'The constructors’ championship began in 1958.' : 'Standings are unavailable for this season.')}
  ${dateStamp(season, cached)}`;
}

export function calendar(season, filter, cached) {
  const next = nextRace(season);
  const groups = [['all', 'All races'], ['complete', 'Final'], ['pending', 'Pending']];
  const races = season.races.filter(race => filter === 'all' || Boolean(race.results.length) === (filter === 'complete'));
  return `${pageTitle('Race calendar', `${season.races.length} scheduled Grands Prix in ${season.year}. Open a weekend to see its circuit, sessions and results.`)}
  <div class="control-row">${segments('calendar-filter', filter, groups, 'Race status')}</div>
  ${races.length ? `<div class="weekend">${races.map(race => raceCard(season, race, next)).join('')}</div>` : empty('No races match this filter.')}
  ${dateStamp(season, cached)}`;
}

function classification(race, sprint, year) {
  const rows = sprint ? race.sprint : race.results;
  if (!rows.length) return empty(sprint ? 'Sprint results are unavailable for this weekend.' : 'The provider has yet to publish a race classification.');
  const winner = rows.find(row => row.classification === '1');
  const fastest = sprint ? null : rows.find(row => row.fastestRank === 1);
  return `<div class="kpi-strip">
    ${kpi('Winner', winner?.name, winner?.team ?? '')}
    ${kpi('Winning time', winner?.time, winner?.laps ? `${winner.laps} laps` : '')}
    ${fastest ? kpi('Fastest lap', fastest.fastest, fastest.name) : ''}
  </div>
  <section class="panel">${panelHead(sprint ? 'Sprint classification' : 'Grand Prix classification', '', '<button type="button" class="secondary" data-download="results">Download CSV</button>')}
    ${table(['Pos', 'Driver', 'Constructor', ['Grid'], ['Laps'], 'Time / status', ['Pts']], rows.map(row => [
      rank(row.classification), name(row.name, row.code), display(row.team), row.grid === 0 ? '—' : display(row.grid),
      display(row.laps), display(row.time || row.status), pointTotal(row.points)
    ]), `${year} ${race.name} ${sprint ? 'sprint' : 'race'} results`)}
  </section>`;
}

function circuit(race) {
  const location = race.lat !== null && race.lon !== null;
  const weekend = [...race.sessions, { name: 'Race', date: race.date, at: race.at }].sort((a, b) =>
    `${a.date}T${a.at ?? ''}`.localeCompare(`${b.date}T${b.at ?? ''}`));
  const coordinates = location ? `${race.lat},${race.lon}` : '';
  return `<div class="split">
    <section class="panel">${panelHead(race.circuit, `${race.city}, ${race.country}`)}
      ${location ? `<p class="subtle">${e(coordinates)}</p><a class="text-link" href="https://www.openstreetmap.org/?mlat=${race.lat}&amp;mlon=${race.lon}#map=14/${race.lat}/${race.lon}" target="_blank" rel="noopener noreferrer">Open circuit location ↗</a>` : '<p class="subtle">Circuit coordinates are unavailable.</p>'}
    </section>
    <section class="panel">${panelHead('Weekend schedule', 'Times shown in UTC when available')}
      ${table(['Session', 'Date & time'], weekend.map(session => [e(session.name), keyTime(session)]), 'Session schedule')}
    </section>
  </div>`;
}

export function driverComparison(race, pair) {
  const options = race.results.filter(row => row.number !== null).map(row => [row.id, row.name]);
  if (!options.length) return '';
  return `<div class="control-row driver-comparison">${select('timing-first', 'First driver', pair[0], options)}
    ${select('timing-second', 'Compare with', pair[1], [['', 'None'], ...options])}
    <button class="secondary" type="button" data-share>Copy comparison link</button>
    <span class="meta" data-share-status role="status"></span></div>`;
}

export function raceView(season, race, tab, sprint, timing, pair, pitMetric, lab = '') {
  if (!race) return empty('Choose a race from the calendar.');
  return `${pageTitle('Race analysis', 'Results, circuit details, and recorded race timing.')}
  <div class="control-row">
    ${select('race-picker', 'Grand Prix', race.round, season.races.map(row => [row.round, raceLabel(row)]))}
    ${segments('race-tab', tab, raceTabs, 'Race analysis')}
  </div>
  <div class="focus-banner"><span class="eyebrow">${season.year} · ${roundLabel(race.round)}</span><h2>${e(race.name)}</h2><p class="meta">${e(race.circuit)} · ${e(race.country)} · ${keyTime(race)}</p></div>
  ${lab || (tab === 'circuit' ? circuit(race)
    : tab === 'timing' ? timingView(season, race, timing, pair, pitMetric)
    : `${race.sprint.length ? `<div class="control-row">${segments('result-kind', sprint ? 'sprint' : 'race', [['race', 'Grand Prix'], ['sprint', 'Sprint']], 'Session results')}</div>` : ''}${classification(race, sprint, season.year)}`)}`;
}

function timingView(season, race, state, pair, pitMetric) {
  if (!race.results.length) return empty('Timing becomes available after a race has finished and the provider has published its data.');
  if (season.year < 1996) return empty('Jolpica’s per-lap timing archive begins in 1996.');
  const controls = driverComparison(race, pair);
  if (!state || state.loading) return `${controls}${empty('Loading archived race timing…')}`;
  if (state.error) return `${controls}${empty(state.error, 'timing')}`;
  const data = state.data;
  if (!data) return `${controls}${empty('Race timing is still being processed or there is no matching archive session.', 'timing')}`;
  const selected = pair.flatMap((id, index) => {
    const row = race.results.find(result => result.id === id);
    return row?.number != null && pair.indexOf(id) === index ? [row] : [];
  });
  const lapIndex = new Map();
  for (const lap of data.laps) {
    if (selected.some(row => row.number === lap.number) && lap.lap > 0) {
      if (!lapIndex.has(lap.number)) lapIndex.set(lap.number, new Map());
      lapIndex.get(lap.number).set(lap.lap, lap.seconds);
    }
  }
  const count = Math.max(0, ...[...lapIndex.values()].flatMap(map => [...map.keys()]));
  const labels = Array.from({ length: count }, (_, index) => ({ short: String(index + 1), detail: `Lap ${index + 1}` }));
  const lines = selected.map((row, index) => ({
    name: row.code, color: palette[index], values: labels.map((_, lap) => lapIndex.get(row.number)?.get(lap + 1) ?? null)
  }));
  const lane = data.pits.some(pit => pit.lane > 0);
  const stationary = data.pits.some(pit => pit.stop > 0);
  const metric = stationary && (pitMetric === 'stop' || !lane) ? 'stop' : 'lane';
  const pitRows = data.pits.filter(pit => pit[metric] > 0).sort((a, b) => a[metric] - b[metric]);
  const lookup = number => race.results.find(row => row.number === number);
  const stints = selected.flatMap(driver => data.stints.filter(stint => stint.number === driver.number)
    .sort((a, b) => a.first - b.first).map(stint => ({ ...stint, driver: driver.code })));
  const compounds = { SOFT: '#ff5d74', MEDIUM: '#f1d36b', HARD: '#ececf2', INTERMEDIATE: '#58dba0', WET: '#6ba9ff' };
  return `${controls}
  ${data.missing.length ? `<p class="callout">Unavailable from ${e(data.source)}: ${e(data.missing.join(', '))}. <button type="button" class="secondary" data-retry="timing">Retry</button></p>` : ''}
  <div class="kpi-strip">${lines.map(line => {
    const values = line.values.filter(Number.isFinite);
    return kpi(`${line.name} median lap`, lapTime(median(values)), `${values.length} timed laps`);
  }).join('')}</div>
  <div class="dash-grid">
    <section class="panel">
      ${panelHead('Lap pace', data.source === 'OpenF1' ? 'Recorded laps with pit-out laps excluded' : 'Recorded laps from Jolpica, including pit laps')}
      ${chart({ label: 'Lap time comparison', labels, series: lines, format: lapTime, dataHeading: 'Lap', exportUnit: 's' })}
    </section>
    <section class="panel">
      ${panelHead('Pit stops', metric === 'stop' ? 'Stationary time' : data.pitSource ? 'Pit-lane time · Jolpica F1' : 'Time spent in the pit lane',
        lane && stationary ? segments('pit-metric', metric, [['lane', 'Pit lane'], ['stop', 'Stationary']], 'Pit timing') : '')}
      ${pitRows.length ? `<div class="pit-results">${table(['Driver', ['Lap'], ['Seconds']], pitRows.map(pit => [
        display(lookup(pit.number)?.name ?? (pit.number != null ? `#${pit.number}` : null)), display(pit.lap),
        `<strong>${decimals(pit[metric], 3)}</strong>`
      ]), 'Pit stop durations')}</div>` : empty('No pit timing for this race.')}
    </section>
  </div>
  ${stints.length ? `<div class="section-title"><h2>Tyre stints</h2></div><section class="panel">${table(
    ['Driver', 'Compound', ['First lap'], ['Last lap'], ['Tyre age at start']],
    stints.map(stint => [e(stint.driver), `<span class="compound">${dot(compounds[stint.compound] || '#a6a5b4')}${display(stint.compound)}</span>`,
      display(stint.first), display(stint.last), stint.age != null ? `${e(stint.age)} laps` : '—']), 'Tyre stints'
  )}</section>` : ''}
  <p class="data-stamp">${e(data.source)}${data.sessionKey ? ` · Race session ${e(data.sessionKey)}` : ' · Historical timing'}</p>`;
}

function ageText(days) {
  const value = days / 365.2425;
  return `${decimals(value, 2)} years`;
}

export function recordsView(state) {
  if (!state || state.loading) return `${pageTitle('Historical records', 'Grand Prix wins and winner ages across the championship archive.')}${empty('Loading historical winners…')}`;
  if (state.error) return `${pageTitle('Historical records', 'Grand Prix wins and winner ages across the championship archive.')}${empty(state.error, 'records')}`;
  const { data } = state;
  const ages = byAge(data.wins);
  const youngest = ages[0];
  const oldest = ages.at(-1);
  const [top] = leaders(data.wins, 'driver');
  const years = data.wins.map(row => row.year);
  return `${pageTitle('Historical records', `Grand Prix winning entries in the Jolpica archive, ${Math.min(...years)}–${Math.max(...years)}.`)}
  <div class="kpi-strip">
    ${kpi('Most driver wins', top?.name, top ? `${top.wins} winning entries` : '')}
    ${kpi('Youngest winner', youngest?.driver, youngest ? `${ageText(youngest.days)} · ${youngest.year} ${youngest.event}` : '')}
    ${kpi('Oldest winner', oldest?.driver, oldest ? `${ageText(oldest.days)} · ${oldest.year} ${oldest.event}` : '')}
  </div>
  <div class="split">
    ${[['driver', 'Drivers'], ['team', 'Constructors']].map(([key, title]) => `<section class="panel">${panelHead(`${title} by Grand Prix wins`, 'Top 12 by winning entries')}${table(['Rank', title === 'Drivers' ? 'Driver' : 'Constructor', ['Wins']], leaders(data.wins, key).slice(0, 12).map((row, index) => [
      rank(index + 1), name(row.name), pointTotal(row.wins)
    ]), `${title} by Grand Prix wins`)}</section>`).join('')}
  </div>
  <p class="data-stamp">Jolpica F1 · Snapshot ${formatUpdated(data.fetchedAt)} · Shared wins count once per winning entry.</p>`;
}

export function forecast(season, mode, cutoff, validation) {
  const rounds = completed(season);
  const prediction = model(season, mode === 'teams', cutoff);
  const controls = `<div class="control-row">${segments('mode', mode, modes, 'Championship')}
    ${rounds.length >= 3 ? select('forecast-round', 'As of round', cutoff, rounds.slice(2).toReversed().map(race => [race.round, raceLabel(race)])) : ''}
  </div>`;
  const base = mode === 'teams' && season.year < 1958 ? null : prediction;
  const range = base ? projectionInterval(validation, { estimate: 0, remaining: base.rest, year: season.year }) : null;
  return `${pageTitle('Forecast lab', 'Revisit the original college project’s linear regression model using a historical cutoff or the latest completed round.')}
  ${controls}
  ${base ? `<div class="kpi-strip">
    ${kpi('Remaining weekends', prediction.rest, 'Based on the published calendar')}
    ${kpi('Regression error', prediction.mae.length ? `${decimals(prediction.mae[0])} pts` : '—', 'Mean absolute error per weekend')}
    ${kpi('Baseline error', prediction.mae.length ? `${decimals(prediction.mae[1])} pts` : '—', 'Recent mean points per weekend')}
  </div>
  <section class="panel">
    ${panelHead('Season-end points estimate', prediction.useOfficial ? 'Starting points from official standings at the cutoff' : 'Starting points from published race and sprint results at the cutoff')}
    ${table(['Rank', mode === 'teams' ? 'Constructor' : 'Driver', ['Starting pts'], ['Pts per weekend'], ['Estimated total'], ...(range ? [['Historical range (pts)']] : [])], prediction.rows.map((row, index) => [
      rank(index + 1), name(row.name), pointTotal(row.earned), decimals(row.pace), `<strong>${decimals(row.estimate)}</strong>`,
      ...(range ? [`${decimals(Math.max(0, row.estimate + range.lowerError))} to ${decimals(Math.max(0, row.estimate + range.upperError))}`] : [])
    ]), 'Projected championship points')}
    ${range ? `<p class="subtle">Historical range applies the 10th and 90th percentile errors from ${range.sample} earlier forecasts with the same number of weekends left.</p>` : ''}
  </section>
  <p class="subtle data-stamp">Fits a line to cumulative points over up to six recent weekends. Adds that scoring pace for each remaining weekend. The rolling backtest uses ${prediction.sample} entrant-weekend forecasts, each trained only on earlier rounds after the entrant first scored. Projections assume a steady scoring pace.</p>` : empty(mode === 'teams' && season.year < 1958 ? 'The constructors’ championship began in 1958.' : 'At least three completed rounds are needed for a projection.')}`;
}

const glossary = [
  ['Championship points', 'Drivers and constructors earn points from race and sprint classifications. Scoring rules changed over the decades. The standings use totals published by Jolpica for the selected season.'],
  ['Qualifying and the grid', 'Qualifying sets a starting order, which penalties and pit-lane starts can change. Race results show the starting grid and the finishing classification separately.'],
  ['Lap pace', 'Lap time is elapsed time for one circuit lap. Fuel, traffic, weather, tyres, yellow flags and pit activity all affect it. The lap chart compares drivers within a single race.'],
  ['Pit stops', 'Pit-lane time measures the transit through the pit lane. Stationary time measures how long the car is stopped. OpenF1 started publishing stationary stop durations at the 2024 United States Grand Prix.'],
  ['Tyre stints', 'A stint shows consecutive laps run on a set of tyres. Compound and starting tyre age help explain changes in pace as the stint progresses.'],
  ['Flags and safety', 'Yellow flags signal a hazard. Red flags suspend a session. The safety car slows the field when needed, and the halo protects the driver’s head.'],
  ['Telemetry', 'Race engineers use sensors to record signals such as throttle, speed, braking, and gear selection. Lap and sector timings summarize how that performance translates to the stopwatch.'],
  ['DRS', 'The Drag Reduction System opened a flap in the rear wing on designated straights during the 2011–2025 era. Using it reduced drag and increased straight-line speed.']
];

export function guide() {
  return `${pageTitle('About & data', 'Race Lab modernizes a final-year Formula 1 data science project.')}
  <div class="guide-grid">${glossary.map(([title, description]) => `<section class="panel term"><h2>${e(title)}</h2><p>${e(description)}</p></section>`).join('')}</div>
  <div class="section-title"><h2>Sources & methodology</h2></div>
  <div class="guide-grid">
    <section class="panel term"><h2>Jolpica F1</h2><p>Public calendars, classifications, championship standings, winner records, and older timing. The app uses dated snapshots for recent seasons and fetches earlier seasons on demand.</p><a href="https://github.com/jolpica/jolpica-f1">Jolpica documentation ↗</a></section>
    <section class="panel term"><h2>OpenF1</h2><p>Free archived timing provides lap pace, pit stops and tyre stints from 2023. Live session access is a paid OpenF1 service.</p><a href="https://openf1.org/docs/">OpenF1 documentation ↗</a></section>
    <section class="panel term"><h2>Original project</h2><p>Race Lab is an independent educational project. The original Streamlit project is available in Git history.</p><a href="https://github.com/kanizmadix/Formula1/tree/c541a38">Original college project ↗</a></section>
  </div>`;
}
