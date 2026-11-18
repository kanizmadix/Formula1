import { trendPace } from './metrics.js';
import { decimals, e, panelHead, table } from './ui.js';

// Publication dates matter when a cancellation changed the number of races left.
const PUBLISHED_CALENDARS = {
  2021: [
    { rounds: 23, source: 'https://corp.formula1.com/formula-one-update-on-2021-calendar/' },
    { from: '2021-08-28', rounds: 22, source: 'https://www.formula1.com/en/latest/article/breaking-formula-1-announces-revised-22-race-calendar-for-2021.6OaQqLr4jrU5Ia2va3sjkv' }
  ],
  2022: [
    { rounds: 23, source: 'https://www.formula1.com/en/latest/article/breaking-2022-pre-season-testing-dates-in-barcelona-and-bahrain-confirmed.3ZwPqa2c9GFqg7mFTDubau' },
    { from: '2022-05-18', rounds: 22, source: 'https://www.formula1.com/en/latest/article/formula-1-to-race-at-22-grands-prix-in-2022.5ySj1LGnDVesfBDHI1Kc3c' }
  ],
  2023: [
    { rounds: 23, source: 'https://www.formula1.com/en/latest/article/formula-1-update-on-the-2024-calendar.4pTQzihtKTiegogmNX5XrP' },
    { from: '2023-05-17', rounds: 22, source: 'https://corp.formula1.com/update-on-the-emilia-romagna-grand-prix-in-imola/' }
  ],
  2024: [{ rounds: 24, source: 'https://www.formula1.com/en/latest/article/formula-1-announces-calendar-for-2024.XL3c5Cxi0ZOQzPrUu5izL' }],
  2025: [{ rounds: 24, source: 'https://www.formula1.com/en/latest/article/fia-and-formula-1-announces-calendar-for-2025.48ii9hOMGxuOJnjLgpA5qS' }]
};

export const DEFAULT_VALIDATION_YEARS = Object.freeze(Object.keys(PUBLISHED_CALENDARS).map(Number));

const MODELS = [
  ['trend', 'Recent trend'],
  ['recentMean', 'Recent average'],
  ['holdPoints', 'Hold points']
];
const sum = numbers => numbers.reduce((total, value) => total + value, 0);
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date));
const validId = id => typeof id === 'string' && id.length > 0;

function validCalendar(calendar) {
  return Array.isArray(calendar) && calendar.length > 0 && calendar.every((entry, index) =>
    Number.isInteger(entry?.rounds) && entry.rounds >= 4 && (index === 0
      ? entry.from == null
      : validDate(entry.from) && (index === 1 || entry.from > calendar[index - 1].from)));
}

function snapshotResults(season, mode, finalRound) {
  if (!Array.isArray(season.races) || season.races.length !== finalRound ||
      season[mode === 'teams' ? 'teamRound' : 'driverRound'] !== finalRound) {
    return { reason: 'The snapshot does not reach the season finale.' };
  }

  const races = [...season.races].sort((a, b) => a?.round - b?.round);
  const weekends = [];
  const totals = new Map();
  for (const [index, race] of races.entries()) {
    if (race?.round !== index + 1 || !validDate(race.date) || !race.date.startsWith(`${season.year}-`) ||
        (index > 0 && race.date <= races[index - 1].date) || !Array.isArray(race.results) || !race.results.length) {
      return { reason: 'Race dates or classifications are incomplete.' };
    }
    const sprint = race.sprint ?? [];
    const scheduledSprint = Array.isArray(race.sessions) && race.sessions.some(session => session?.name === 'Sprint');
    if (!Array.isArray(sprint) || (scheduledSprint && !sprint.length)) {
      return { reason: `Round ${race.round} is missing a sprint classification.` };
    }

    const pointsById = new Map();
    for (const classification of [race.results, sprint]) {
      const drivers = new Set();
      for (const row of classification) {
        const id = mode === 'teams' ? row?.teamId : row?.id;
        if (!validId(id) || !validId(row?.id) || !Number.isFinite(row.points) || drivers.has(row.id)) {
          return { reason: `Round ${race.round} has invalid classification rows.` };
        }
        drivers.add(row.id);
        pointsById.set(id, (pointsById.get(id) ?? 0) + row.points);
      }
    }
    weekends.push({ round: race.round, date: race.date, pointsById });
    for (const [id, points] of pointsById) totals.set(id, (totals.get(id) ?? 0) + points);
  }

  const actual = new Map();
  for (const row of Array.isArray(season[mode]) ? season[mode] : []) {
    if (!validId(row?.id) || !Number.isFinite(row.points) || actual.has(row.id)) {
      return { reason: 'Final standings have invalid or duplicate entries.' };
    }
    actual.set(row.id, row.points);
  }
  if (actual.size !== totals.size || [...totals].some(([id, total]) =>
    !actual.has(id) || Math.abs(actual.get(id) - total) > 1e-6)) {
    return { reason: 'Race and sprint points do not reconcile with the final standings.' };
  }
  return { weekends, actual };
}

function rollingProjections(year, weekends, actual, calendar) {
  const cases = [];
  const earnedById = new Map();
  for (let index = 0; index < weekends.length - 1; index++) {
    const { round, date, pointsById } = weekends[index];
    for (const [id, points] of pointsById) earnedById.set(id, (earnedById.get(id) ?? 0) + points);
    if (index < 2) continue;

    const plan = calendar.findLast(entry => !entry.from || entry.from <= date);
    const remaining = plan.rounds - index - 1;
    if (remaining <= 0) continue;

    const recent = weekends.slice(Math.max(0, index - 5), index + 1);
    for (const [id, earned] of earnedById) {
      const values = recent.map(weekend => weekend.pointsById.get(id) ?? 0);
      cases.push({ year, cutoff: round, remaining, id, earned, actual: actual.get(id), estimates: {
        trend: earned + trendPace(values) * remaining,
        recentMean: earned + sum(values) / values.length * remaining,
        holdPoints: earned
      } });
    }
  }
  return cases;
}

const error = (entry, method) => entry.actual - entry.estimates[method];

function score(cases) {
  return Object.fromEntries(MODELS.map(([method]) => {
    const errors = cases.map(entry => error(entry, method));
    const sample = errors.length;
    return [method, {
      sample,
      mae: sample ? sum(errors.map(Math.abs)) / sample : null,
      rmse: sample ? Math.sqrt(sum(errors.map(value => value ** 2)) / sample) : null
    }];
  }));
}

// Custom years need a calendar with an opening count and optional dated revisions.
// Example: { years: [2020], calendars: { 2020: [{ rounds: 17 }] } }
export function evaluateForecasts(seasons = [], mode = 'drivers', options = {}) {
  mode = mode === 'teams' ? 'teams' : 'drivers';
  const requestedYears = [...new Set(options.years ?? DEFAULT_VALIDATION_YEARS)]
    .filter(Number.isInteger).sort((a, b) => a - b);
  const snapshots = new Map(seasons.flatMap(season => season ? [[season.year, season]] : []));
  const bySeason = [];
  const skipped = [];
  const cases = [];

  for (const year of requestedYears) {
    const season = snapshots.get(year);
    const calendar = options.calendars?.[year] ?? PUBLISHED_CALENDARS[year];
    if (!season || !validCalendar(calendar)) {
      skipped.push({ year, reason: season ? 'A dated season calendar is unavailable.' : 'The snapshot is unavailable.' });
      continue;
    }
    const { weekends, actual, reason } = snapshotResults(season, mode, calendar.at(-1).rounds);
    if (reason) {
      skipped.push({ year, reason });
      continue;
    }
    const entries = rollingProjections(year, weekends, actual, calendar);
    if (!entries.length) {
      skipped.push({ year, reason: 'There are no eligible cutoffs before the finale.' });
      continue;
    }
    cases.push(...entries);
    bySeason.push({ year, cutoffs: new Set(entries.map(entry => entry.cutoff)).size, sample: entries.length,
      metrics: score(entries), calendarSources: calendar === PUBLISHED_CALENDARS[year] ? calendar.map(entry => entry.source) : [] });
  }

  return { mode, requestedYears, years: bySeason.map(entry => entry.year), bySeason, skipped, cases, metrics: score(cases) };
}

function quantile(sorted, probability) {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

function residualRange(cases) {
  const years = [...new Set(cases.map(entry => entry.year))].sort((a, b) => a - b);
  const sample = cases.length;
  if (sample < 20 || years.length < 2) return null;
  const residuals = cases.map(entry => error(entry, 'trend')).sort((a, b) => a - b);
  return { lowerError: quantile(residuals, 0.1), upperError: quantile(residuals, 0.9), sample, years };
}

export function projectionInterval(evaluation, { estimate, remaining, year } = {}) {
  if (!Number.isFinite(estimate) || !Number.isInteger(remaining) || remaining < 1 || !Number.isInteger(year)) return null;
  const range = residualRange((evaluation?.cases ?? []).filter(entry => entry.year < year && entry.remaining === remaining));
  return range && { ...range, remaining, lower: estimate + range.lowerError, upper: estimate + range.upperError };
}

export function forecastValidationView(state = {}, mode = 'drivers', options = {}) {
  const evaluation = evaluateForecasts(state.seasons ?? [], mode, options);
  const { bySeason, cases, skipped, metrics } = evaluation;
  const title = panelHead('Historical season-end backtest');
  const loading = state.status === 'loading';
  const status = loading ? 'Loading historical season snapshots…' : state.status === 'error'
    ? 'Some historical season snapshots could not be loaded.' : '';
  const availability = skipped.length && !loading
    ? `<details class="data-table"><summary>Skipped seasons (${skipped.length})</summary><ul>${skipped.map(({ year, reason }) =>
      `<li>${e(year)} · ${e(reason)}</li>`).join('')}</ul></details>` : '';
  if (!cases.length) {
    return `<section class="panel forecast-validation">${title}<p role="status">${e(status || 'No completed seasons are available for comparison.')}</p>${availability}</section>`;
  }

  const entrant = evaluation.mode === 'teams' ? 'constructor' : 'driver';
  const horizons = [...new Set(cases.map(entry => entry.remaining))].sort((a, b) => a - b);
  const ranges = horizons.flatMap(remaining => {
    const range = residualRange(cases.filter(entry => entry.remaining === remaining));
    return range ? [[remaining, decimals(range.lowerError), decimals(range.upperError), decimals(range.sample, 0), range.years.length]] : [];
  });
  return `<section class="panel forecast-validation">
    ${title}
    ${status ? `<p role="status">${e(status)}</p>` : ''}
    <p>${decimals(cases.length, 0)} ${entrant} forecasts across ${bySeason.length} ${bySeason.length === 1 ? 'season' : 'seasons'} (${evaluation.years.join(', ')}). Each forecast uses classifications through its cutoff and is scored against the final championship points.</p>
    ${table(['Method', ['Mean absolute error (pts)'], ['Root mean square error (pts)'], ['Forecasts']], MODELS.map(([method, label]) => [
      label, decimals(metrics[method].mae), decimals(metrics[method].rmse), decimals(metrics[method].sample, 0)
    ]), 'Season-end forecast error')}
    <p class="subtle">Lower errors are better. The trend fits cumulative points over up to six recent weekends. The recent average uses mean points over those same weekends. Hold points carries the cutoff total to the finale.</p>
    <details class="data-table"><summary>Results and calendar sources by season</summary>
      ${table(['Season', ['Cutoffs'], ['Forecasts'], ...MODELS.map(([, label]) => [`${label} MAE (pts)`]), 'Formula 1 calendar'], bySeason.map(entry => [
        entry.year, entry.cutoffs, entry.sample, ...MODELS.map(([method]) => decimals(entry.metrics[method].mae)),
        entry.calendarSources.map((source, index) => `<a href="${e(source)}">${index ? 'Revision' : 'Opening plan'}</a>`).join(' · ') || '—'
      ]), 'Backtest results by season')}
    </details>
    <details class="data-table"><summary>Historical uncertainty by weekends remaining</summary>
      <p>The 10th and 90th percentiles describe how far actual points fell below or above the trend estimate at the same forecast horizon. Forecasts from the same season overlap, and future errors may differ.</p>
      ${ranges.length ? table([['Weekends left'], ['10th percentile (pts)'], ['90th percentile (pts)'], ['Forecasts'], ['Seasons']], ranges, 'Historical trend forecast errors')
        : '<p>A range requires at least 20 forecasts from at least two seasons at the same horizon.</p>'}
    </details>
    ${availability}
    <p class="data-stamp">Jolpica F1 race, sprint and final standings snapshots. Forecasts start after round three and include entrants once they appear in a classification. Calendar revisions apply from their announcement date. Archived classifications can include later corrections.</p>
  </section>`;
}
