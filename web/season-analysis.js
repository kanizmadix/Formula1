import { json } from './data.js';
import { median } from './metrics.js';
import { date, decimals, e, empty, lapTime, pageTitle, panelHead, pointTotal, roundLabel, select, table } from './ui.js';

const archivePath = './data/season-analysis/';
const unspecified = 'Reason not specified';
const dayMs = 86_400_000;
const positive = value => Number.isFinite(value) && value > 0;
const specificReason = value => /^(?:retired|did not finish|dnf|unknown)?$/i.test(value) ? unspecified : value;

function resultLap(value) {
  const match = /^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(value ?? '');
  if (!match || (match[1] && Number(match[2]) >= 60)) return null;
  const duration = ((Number(match[1] ?? 0) * 60) + Number(match[2])) * 1000
    + Number((match[3] ?? '').padEnd(3, '0'));
  return positive(duration) ? duration : null;
}

function resultOutcome(row) {
  const status = row.status?.trim() ?? '';
  const classification = String(row.classification ?? '').toUpperCase();
  const completedLaps = Number(row.laps) > 0;
  const nonStart = /^(?:did not (?:start|qualify|prequalify|pre-qualify)|withdrawn|withdrew|dns|dnq|dnpq)$/i.test(status);
  const disqualified = classification === 'D' || /^disqualified$/i.test(status);
  const finished = /^(?:finished|lapped|\+\d+ laps?)$/i.test(status);
  const retired = classification === 'R' && !finished && !nonStart && !disqualified;
  const started = !nonStart && (completedLaps || (!disqualified && (retired || finished || /^\d+$/.test(classification))));
  return {
    started, won: started && !disqualified && row.rank === 1,
    retirement: retired ? specificReason(status) : null
  };
}

function combineRace(race, archivedRace) {
  const timingByDriver = new Map((archivedRace?.drivers ?? []).map(row => [row.id, row]));
  const results = race.results ?? [];
  const rows = results.length ? results.map(result => {
    const recorded = timingByDriver.get(result.id);
    const official = resultLap(result.fastest);
    return {
      ...resultOutcome(result),
      ...recorded,
      id: result.id, name: result.name, team: result.team, teamId: result.teamId,
      fastestLap: official ?? recorded?.fastestLap ?? null,
      fastestSource: official ? 'results' : recorded?.fastestLap ? 'timing' : null
    };
  }) : (archivedRace?.drivers ?? []).map(row => ({
    ...row, fastestSource: row.fastestLap ? 'timing' : null
  }));
  const fastestLaps = rows.map(row => row.fastestLap).filter(positive);
  const benchmark = fastestLaps.length ? Math.min(...fastestLaps) : null;
  return {
    round: race.round, date: race.date, name: race.name, circuit: race.circuit,
    circuitId: race.circuitId, archived: Boolean(archivedRace), rows, benchmark
  };
}

export function makeSeasonAnalysis(season, archive = null) {
  const year = Number(season?.year ?? season);
  const validArchive = archive?.version === 1 && archive.year === year && Array.isArray(archive.races) ? archive : null;
  const schedule = season?.races;
  const races = schedule?.length ? schedule : validArchive?.races ?? [];
  const byRound = new Map((validArchive?.races ?? []).map(race => [race.round, race]));
  return {
    year, asOf: validArchive?.asOf ?? null, archiveAvailable: Boolean(validArchive),
    hasSchedule: Boolean(schedule?.length),
    races: races.map(race => {
      const candidate = byRound.get(race.round);
      // The dump uses the event date, while the compatibility API can use the UTC start date.
      const match = candidate?.circuitId === race.circuitId &&
        Math.abs(Date.parse(candidate?.date) - Date.parse(race.date)) <= dayMs;
      return combineRace(race, match ? candidate : null);
    })
  };
}

export async function loadSeasonAnalysis(season) {
  const year = Number(season?.year ?? season);
  if (!Number.isInteger(year) || year < 2018 || year > 9999) return makeSeasonAnalysis(season);
  try {
    const archive = await json(`${archivePath}${year}.json`, { retries: 0 });
    return makeSeasonAnalysis(season, archive);
  } catch {
    return makeSeasonAnalysis(season);
  }
}

export async function loadWinlessRecords() {
  try {
    const record = await json(`${archivePath}winless.json`, { retries: 0 });
    return record?.version === 1 && Array.isArray(record.rows) && record.rows.length &&
      Number.isFinite(Date.parse(record.lastRace)) ? record : null;
  } catch {
    return null;
  }
}

function filterOptions(analysis) {
  const drivers = new Map();
  const teams = new Map();
  const circuits = new Map();
  for (const race of analysis.races) {
    if (race.circuitId) circuits.set(race.circuitId, race.circuit || race.circuitId);
    for (const row of race.rows) {
      if (row.id) drivers.set(row.id, row.name || row.id);
      if (row.teamId) teams.set(row.teamId, row.team || row.teamId);
    }
  }
  const sorted = map => [...map].sort((a, b) => a[1].localeCompare(b[1], 'en'));
  return { driver: sorted(drivers), team: sorted(teams), circuit: sorted(circuits) };
}

function addSample(groups, id, name, row, benchmark) {
  if (!id) return;
  if (!groups.has(id)) {
    groups.set(id, {
      id, name, laps: 0, fastestLap: null, medianGaps: [], bestGaps: [], pitCount: 0, laneDurations: []
    });
  }
  const group = groups.get(id);
  group.laps += row.lapsRecorded;
  if (positive(row.fastestLap)) group.fastestLap = Math.min(group.fastestLap ?? Infinity, row.fastestLap);
  if (positive(benchmark) && positive(row.medianLap)) group.medianGaps.push((row.medianLap / benchmark - 1) * 100);
  if (positive(benchmark) && positive(row.fastestLap)) group.bestGaps.push((row.fastestLap / benchmark - 1) * 100);
  group.pitCount += row.pitCount;
  group.laneDurations.push(...row.pitLane);
}

function groupSummary(groups) {
  return [...groups.values()].map(group => ({
    id: group.id, name: group.name || group.id,
    laps: group.laps, lapSamples: group.medianGaps.length, medianPace: median(group.medianGaps),
    fastestLap: group.fastestLap, fastestSamples: group.bestGaps.length, fastestPace: median(group.bestGaps),
    pitCount: group.pitCount, pitSamples: group.laneDurations.length, medianPitLane: median(group.laneDurations)
  })).sort((a, b) => (a.medianPace ?? a.fastestPace ?? Infinity) - (b.medianPace ?? b.fastestPace ?? Infinity) ||
    a.name.localeCompare(b.name, 'en'));
}

export function summarizeSeasonAnalysis(analysis, filters = {}) {
  const options = filterOptions(analysis);
  const selection = Object.fromEntries(Object.entries(options).map(([key, values]) =>
    [key, values.some(([id]) => id === filters[key]) ? filters[key] : '']));
  const drivers = new Map();
  const teams = new Map();
  const reasons = new Map();
  const starts = new Map();
  const allWinners = new Set(analysis.races.flatMap(race => race.rows.filter(row => row.won).map(row => row.id)));
  const coverage = [];
  for (const race of analysis.races) {
    if (selection.circuit && selection.circuit !== race.circuitId) continue;
    const rows = race.rows.filter(row => (!selection.driver || row.id === selection.driver) &&
      (!selection.team || row.teamId === selection.team));
    if (!rows.length) continue;
    const counts = {
      round: race.round, name: race.name, archived: race.archived,
      starts: 0, lapEntries: 0, laps: 0, bestLaps: 0, classificationBestLaps: 0,
      pitCount: 0, pitSamples: 0, retirements: 0, detailedRetirements: 0
    };
    for (const raw of rows) {
      const hasTiming = race.archived && Object.hasOwn(raw, 'medianLap');
      const row = {
        ...raw, lapsRecorded: hasTiming && positive(raw.laps) ? raw.laps : 0,
        pitCount: positive(raw.pitCount) ? raw.pitCount : 0,
        pitLane: Array.isArray(raw.pitLane) ? raw.pitLane.filter(positive) : []
      };
      if (row.started) {
        counts.starts++;
        if (!starts.has(row.id)) starts.set(row.id, { name: row.name || row.id, starts: 0 });
        starts.get(row.id).starts++;
      }
      if (row.lapsRecorded) counts.lapEntries++;
      if (positive(row.fastestLap)) counts.bestLaps++;
      if (row.fastestSource === 'results') counts.classificationBestLaps++;
      counts.laps += row.lapsRecorded;
      counts.pitCount += row.pitCount;
      counts.pitSamples += row.pitLane.length;
      if (row.retirement) {
        const reason = specificReason(row.retirement);
        counts.retirements++;
        if (reason !== unspecified) counts.detailedRetirements++;
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      if (!row.lapsRecorded && !positive(row.fastestLap) && !row.pitCount) continue;
      addSample(drivers, row.id, row.name, row, race.benchmark);
      addSample(teams, row.teamId, row.team, row, race.benchmark);
    }
    coverage.push(counts);
  }
  const byCount = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en');
  return {
    options, selection, coverage, drivers: groupSummary(drivers), teams: groupSummary(teams),
    retirements: [...reasons].sort(byCount),
    winless: [...starts].filter(([id]) => !allWinners.has(id)).map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name, 'en'))
  };
}

function coverageView(analysis, summary) {
  const { coverage } = summary;
  const racesWithResults = analysis.races.filter(race => race.rows.length).length;
  const schedule = analysis.hasSchedule ? `${racesWithResults} of ${analysis.races.length} scheduled Grands Prix have results.`
    : `${racesWithResults} Grands Prix available in the timing archive.`;
  const count = field => coverage.filter(race => race[field] > 0).length;
  const overview = coverage.length
    ? `Race selection: ${coverage.length} with results, ${count('laps')} with recorded laps, ${count('bestLaps')} with fastest laps and ${count('pitSamples')} with pit-lane durations.`
    : 'No results match this selection.';
  const source = analysis.archiveAvailable
    ? `Source: Jolpica F1${analysis.asOf ? ` archive published ${date(analysis.asOf, true)}` : ' bulk archive'}. The free dump is published with a delay.`
    : analysis.year < 2018 ? 'The packaged timing archive begins in 2018. Classified fastest laps appear where available.'
      : 'The packaged timing archive is unavailable for this season. Classified fastest laps appear where available.';
  return `<section class="panel">
    ${panelHead('Timing coverage', `${schedule} ${overview}`)}
    <p class="subtle">${e(source)}</p>
    ${coverage.length ? `<details class="data-table"><summary>Coverage by Grand Prix</summary>${table(
      ['Grand Prix', 'Timing archive', ['Timed laps'], ['Drivers with lap samples'], ['Fastest laps'], ['Timed pit entries']],
      coverage.map(row => [
        `${e(roundLabel(row.round))} · ${e(row.name)}`, row.archived ? 'Available' : 'Unavailable',
        pointTotal(row.laps), `${pointTotal(row.lapEntries)} / ${pointTotal(row.starts)}`,
        `${pointTotal(row.bestLaps)}${row.classificationBestLaps ? `<small>${pointTotal(row.classificationBestLaps)} from results</small>` : ''}`,
        `${pointTotal(row.pitSamples)} / ${pointTotal(row.pitCount)}`
      ]),
      'Grand Prix timing coverage'
    )}</details>` : ''}
  </section>`;
}

const gap = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${decimals(value, 2)}%` : '—';
const sample = (value, count) => count ? `<strong>${value}</strong><small>${pointTotal(count)} samples</small>` : '—';

function comparisonView(title, rows, circuitSelected) {
  return `<section class="panel">
    ${panelHead(title)}
    ${rows.length ? table(
      [title, ['Typical lap gap'], ['Fastest lap gap'], ...(circuitSelected ? [['Quickest lap']] : []),
        ['Recorded laps'], ['Recorded pit entries'], ['Median pit-lane time']],
      rows.map(row => [
        `<strong>${e(row.name)}</strong>`, sample(gap(row.medianPace), row.lapSamples),
        sample(gap(row.fastestPace), row.fastestSamples),
        ...(circuitSelected ? [lapTime(row.fastestLap === null ? null : row.fastestLap / 1000)] : []),
        row.laps ? pointTotal(row.laps) : '—', row.pitCount ? pointTotal(row.pitCount) : '—',
        sample(row.medianPitLane === null ? '—' : `${decimals(row.medianPitLane / 1000, 3)} s`, row.pitSamples)
      ]), `${title} season timing comparison`
    ) : empty('No recorded timing for this selection.')}
  </section>`;
}

export function seasonAnalysisView(analysis, filters = {}) {
  const { year } = analysis;
  const summary = summarizeSeasonAnalysis(analysis, filters);
  const { options, selection, coverage } = summary;
  const hasLaps = coverage.some(race => race.bestLaps > 0);
  const hasPits = coverage.some(race => race.pitCount > 0);
  return `${pageTitle('Season analysis', `Compare recorded Grand Prix lap pace and pit stops across ${year}.`)}
    <div class="control-row">
      ${select('driver', 'Driver', selection.driver, [['', 'All drivers'], ...options.driver])}
      ${select('team', 'Team', selection.team, [['', 'All teams'], ...options.team])}
      ${select('circuit', 'Circuit', selection.circuit, [['', 'All circuits'], ...options.circuit])}
    </div>
    <div class="stack">
      ${coverageView(analysis, summary)}
      ${hasLaps || hasPits ? `<section class="panel">
        ${panelHead('How to read the comparisons')}
        ${hasLaps ? '<p class="subtle">Lap gaps are relative to the fastest available lap in the same Grand Prix. Typical pace uses each driver’s median recorded lap, including timed pit and slow laps. Fastest-lap gaps use each driver’s best lap from the results or timing archive. Each driver in each race contributes one sample to a gap median.</p>' : ''}
        ${hasPits ? '<p class="subtle">Pit-lane times include entry and exit and may include red-flag delays. Pit-entry counts include records with missing durations. Times vary with pit-lane layout.</p>' : ''}
      </section>` : ''}
      ${comparisonView('Drivers', summary.drivers, selection.circuit)}
      ${comparisonView('Teams', summary.teams, selection.circuit)}
    </div>`;
}

export function seasonArchiveRecordsView(analysis, { winless, ...filters } = {}) {
  const summary = analysis && summarizeSeasonAnalysis(analysis, filters);
  const coverage = summary?.coverage ?? [];
  const total = coverage.reduce((sum, row) => sum + row.retirements, 0);
  const specified = coverage.reduce((sum, row) => sum + row.detailedRetirements, 0);
  const seasonStarts = summary?.winless.slice(0, 25) ?? [];
  const careerStarts = winless?.rows ?? [];
  const startsTitle = careerStarts.length ? 'Most career starts without a win' : 'Season starts without a win';
  const startsCaption = careerStarts.length
    ? `Jolpica championship races from ${date(winless.firstRace, true)} through ${date(winless.lastRace, true)}. Counts one start per driver and race. Excludes non-starters and disqualifications without a recorded lap.`
    : analysis ? `Drivers with zero wins in the available ${analysis.year} Grand Prix results. Starts are counted in the selection.`
      : 'Waiting for Grand Prix results.';
  return `<div class="split">
    <section class="panel">
      ${panelHead(startsTitle, startsCaption)}
      ${careerStarts.length || seasonStarts.length ? table(['Driver', ['Starts']], (careerStarts.length ? careerStarts : seasonStarts)
        .map(row => [e(row.name), pointTotal(row.starts)]), startsTitle) : empty('No winless drivers with recorded starts.')}
    </section>
    <section class="panel">
      ${panelHead('Reported retirement reasons', analysis
        ? `${analysis.year} Grand Prix results · ${specified} of ${total} recorded retirements have a reported reason across ${coverage.length} races with results. Source: Jolpica F1.`
        : 'Waiting for Grand Prix results.')}
      ${summary?.retirements.length ? table(['Reported reason', ['Retirements']], summary.retirements
        .map(([reason, count]) => [e(reason), pointTotal(count)]), 'Reported retirement reasons')
        : empty('No recorded retirements for this selection.')}
    </section>
  </div>`;
}
