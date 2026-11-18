import { json, legacyPits, legacyTiming, openTiming, season, timingSession, winnerRecords } from './data.js';
import { completed } from './metrics.js';
import { download, e, empty, icon } from './ui.js';
import { calendar, driverComparison, forecast, guide, overview, raceTabs, raceView, recordsView, standings } from './views.js';
import { loadStrategyContext, strategyView } from './strategy.js';
import { mountReplay } from './replay.js';
import { defaultTelemetryLap, loadQualifying, loadTelemetry, qualifyingView, telemetryView } from './telemetry.js';
import { DEFAULT_VALIDATION_YEARS, evaluateForecasts, forecastValidationView } from './forecast-validation.js';
import { loadSeasonAnalysis, loadWinlessRecords, seasonAnalysisView, seasonArchiveRecordsView } from './season-analysis.js';
import { downloadChartCsv, formatHash, parseHash, renderSearch, updateSearch } from './discovery.js';

const pages = {
  overview: 'Overview', standings: 'Standings', calendar: 'Calendar', race: 'Race analysis',
  analysis: 'Season data', records: 'Records', forecast: 'Forecast lab', search: 'Search', guide: 'About & data'
};
const content = document.querySelector('#content');
const yearSelect = document.querySelector('#year');
const nav = document.querySelector('#nav');
const todayYear = new Date().getUTCFullYear();
const seasonCache = new Map();
const timingCache = new Map();
const resources = new Map();
const activeResources = new Set();
let manifest = { years: [], records: false };
let year = todayYear;
let route = { page: 'overview' };
let mode = 'drivers';
let filter = 'all';
let sprint = false;
let pitMetric = 'lane';
let searchQuery = '';
let analysisFilters = {};
let forecastRound = null;
let records;
let dataKey = '';
let replayState = { key: '', lap: 1, playing: false };
let unmountReplay;
let startingLightsPlayed = false;

nav.innerHTML = Object.entries(pages).filter(([id]) => id !== 'guide').map(([id, label]) =>
  `<a href="#${id}" data-page="${id}" class="nav-link">${icon(id)}${e(label)}</a>`).join('');
document.querySelector('#guide-link').innerHTML = `${icon('guide')}About &amp; data`;

const hashOptions = () => ({
  maxYear: Math.max(todayYear, ...manifest.years), pages: Object.keys(pages), raceTabs: raceTabs.map(([id]) => id)
});

function navigate(page, targetYear = year, round = null, tab = 'results', options = {}) {
  const next = formatHash({ page, year: targetYear, round, tab, ...options }, hashOptions());
  if (next !== location.hash) location.hash = next;
}

function updateRoute(fields) {
  const next = formatHash({ ...route, year, ...fields }, hashOptions());
  history.replaceState(null, '', next);
  route = parseHash(next, hashOptions());
}

function getRace(data) {
  return data.races.find(race => race.round === route.round) ?? completed(data).at(-1) ?? data.races[0];
}

function effectivePair(options, saved, defaultLength = 2) {
  if (saved.length && options.some(row => row.id === saved[0])) {
    return [saved[0], options.some(row => row.id === saved[1]) && saved[1] !== saved[0] ? saved[1] : ''];
  }
  return [options[0]?.id ?? '', defaultLength > 1 ? options[1]?.id ?? '' : ''];
}

function updateHeader() {
  for (const link of document.querySelectorAll('[data-page]')) {
    const id = link.dataset.page;
    link.href = `#${id}/${year}`;
    if (id === route.page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.querySelector('#breadcrumb').textContent = pages[route.page];
  document.title = `${pages[route.page]} · Race Lab`;
  yearSelect.value = year;
}

function loadYear(target, retry = false) {
  const known = seasonCache.get(target);
  if (!retry && known) return known;
  const entry = { loading: true };
  seasonCache.set(target, entry);
  (async () => {
    if (manifest.years.includes(target) && !retry) {
      try {
        const data = await json(`./data/${target}.json`);
        if (data.year !== target || !data.races.length) throw new Error('Invalid snapshot');
        Object.assign(entry, { data, cached: true, loading: false });
        if (year === target) render();
        if (target < todayYear || Date.now() - Date.parse(data.fetchedAt) < 6 * 3_600_000) return;
      } catch {
        // Continue with the public API when a snapshot is unavailable.
      }
    }
    try {
      const fresh = await season(target);
      const prior = entry.data;
      if (!prior || (fresh.driverRound >= prior.driverRound && fresh.teamRound >= prior.teamRound &&
          completed(fresh).length >= completed(prior).length)) {
        Object.assign(entry, { data: fresh, cached: false });
      }
    } catch (error) {
      if (!entry.data) entry.error = `The ${target} season could not be loaded. ${error.message}`;
    } finally {
      entry.loading = false;
      if (year === target && seasonCache.get(target) === entry) render();
    }
  })();
  return entry;
}

function loadRecords(retry = false) {
  if (records && !retry) return records;
  const entry = { loading: true };
  records = entry;
  (async () => {
    try {
      if (manifest.records && !retry) {
        try {
          entry.data = await json('./data/records.json');
        } catch {
          // Fall back to Jolpica if the static asset cannot be read.
        }
      }
      entry.data ??= await winnerRecords();
      if (!entry.data.wins.length) throw new Error('No winning entries were returned.');
    } catch (error) {
      entry.error = `Historical records could not be loaded. ${error.message}`;
    } finally {
      entry.loading = false;
      if (route.page === 'records') render();
    }
  })();
  return entry;
}

function getTiming(data, race, pair, retry = false) {
  if (!race || !race.results.length || data.year < 1996) return null;
  const legacy = data.year < 2023;
  const key = `${data.year}/${race.round}${legacy ? '/' + pair.join('/') : ''}`;
  if (timingCache.has(key) && !retry) return timingCache.get(key);
  const entry = { loading: true };
  timingCache.set(key, entry);
  (async () => {
    try {
      if (legacy) {
        entry.data = await legacyTiming(data.year, race, [...new Set(pair.filter(Boolean))]);
      } else {
        const session = await timingSession(data.year, race);
        if (session) {
          entry.data = await openTiming(session);
          if (!entry.data.pits.length) {
            try {
              const pits = await legacyPits(data.year, race);
              if (pits.length) {
                entry.data.pits = pits;
                entry.data.pitSource = 'Jolpica F1';
                entry.data.missing = entry.data.missing.filter(item => item !== 'pit stops');
              }
            } catch {
              // Keep available lap times and tyre stints if the fallback is also down.
            }
          }
        }
      }
    } catch (error) {
      entry.error = `Race timing could not be loaded. ${error.message}`;
    } finally {
      entry.loading = false;
      if (route.page === 'race' && ['timing', 'strategy', 'telemetry'].includes(route.tab)) render();
    }
  })();
  return entry;
}

function resource(key, load, message) {
  activeResources.add(key);
  if (resources.has(key)) return resources.get(key);
  const entry = { loading: true };
  resources.set(key, entry);
  Promise.resolve().then(load).then(data => {
    entry.data = data;
  }).catch(error => {
    entry.error = `${message} ${error.message}`;
  }).finally(() => {
    entry.loading = false;
    if (activeResources.has(key) && resources.get(key) === entry) render();
  });
  return entry;
}

function comparableDrivers(race, pair) {
  return pair.map(id => race.results.find(result => result.id === id) ?? null);
}

function telemetrySelection(drivers, timing, preferred = route.laps) {
  const archive = Object.groupBy(timing?.rawLaps ?? [], lap => lap.driver_number);
  const selected = drivers.map((driver, i) => {
    const laps = archive[driver?.number];
    const requested = laps?.find(lap => lap.lap_number === preferred?.[i]);
    return requested ? requested.lap_number : defaultTelemetryLap(laps);
  });
  const raw = selected.map((number, i) => archive[drivers[i]?.number]?.find(lap => lap.lap_number === number) ?? null);
  return { archive, selected, raw };
}

function raceLab(data, race, timing, pair) {
  const { tab } = route;
  if (tab === 'qualifying') {
    const state = resource(`qualifying/${data.year}/${race.round}`, () => loadQualifying(data.year, race), 'Qualifying could not be loaded.');
    return { loading: state.loading, markup: qualifyingView(state, race) };
  }
  if (tab !== 'strategy' && tab !== 'telemetry') return { markup: '' };

  const title = tab === 'strategy' ? 'Race Strategy Lab' : 'Lap telemetry';
  if (data.year < 2023) return { markup: empty(`${title} uses the OpenF1 archive from 2023 onward. Choose Laps & pits for earlier timing.`) };
  if (!race.results.length) return { markup: empty(`${title} becomes available after the Grand Prix and the archive processing window.`) };

  const drivers = comparableDrivers(race, pair);
  const controls = driverComparison(race, pair);
  const sessionKey = timing?.data?.sessionKey;
  if (tab === 'strategy') {
    const context = sessionKey ? resource(`strategy/${sessionKey}`, () => loadStrategyContext(sessionKey), 'Race context could not be loaded.') : null;
    return { loading: context?.loading, markup: strategyView(timing, context, drivers.filter(Boolean), {
      controls, key: `${data.year}/${race.round}`, raceLapCount: Math.max(0, ...race.results.map(row => row.laps ?? 0))
    }) };
  }
  const { archive, selected, raw } = telemetrySelection(drivers, timing?.data);
  const liveData = sessionKey && raw.some(Boolean) ? resource(
    `telemetry/${sessionKey}/${raw.map(lap => lap ? `${lap.driver_number}-${lap.lap_number}` : '-').join('/')}`,
    () => loadTelemetry(sessionKey, raw), 'Lap telemetry could not be loaded.'
  ) : { loading: Boolean(timing?.loading) };
  if (timing?.error) return { markup: controls + empty(timing.error, 'timing') };
  return { loading: liveData.loading, markup: controls + telemetryView(liveData, drivers, archive, selected) };
}

function validatedForecast(data) {
  const state = resource('forecast/validation', async () => {
    const results = await Promise.allSettled(DEFAULT_VALIDATION_YEARS.map(target => json(`./data/${target}.json`)));
    return {
      seasons: results.flatMap(result => result.value ?? []),
      status: results.some(result => result.status === 'rejected') ? 'error' : 'ready'
    };
  }, 'Forecast validation could not be loaded.');
  const validation = state.data ?? { status: state.loading ? 'loading' : 'error' };
  const evaluation = validation.seasons ? evaluateForecasts(validation.seasons, mode) : null;
  return `<div class="stack">${forecast(data, mode, forecastRound ?? completed(data).at(-1)?.round, evaluation)}${forecastValidationView(validation, mode)}</div>`;
}

function seasonAnalysisState(targetYear) {
  const seasonState = loadYear(targetYear);
  const data = seasonState.data;
  const state = resource(`season-analysis/${targetYear}/${data?.fetchedAt ?? 'archive'}`,
    () => loadSeasonAnalysis(data ?? targetYear), 'Season timing could not be loaded.');
  return { state, seasonState };
}

function render(focus) {
  activeResources.clear();
  let markup;
  let busy = false;
  if (route.page === 'guide') {
    markup = guide();
  } else if (route.page === 'analysis') {
    const { state, seasonState } = seasonAnalysisState(year);
    busy = Boolean(state.loading || (!state.data?.races.length && seasonState.loading));
    markup = state.data?.races.length ? seasonAnalysisView(state.data, analysisFilters)
      : busy ? empty(`Loading season analysis for ${year}…`)
      : empty(state.error ?? seasonState.error ?? 'No season timing is available.', 'analysis');
  } else if (route.page === 'records') {
    const entry = loadRecords();
    const { state: archive } = seasonAnalysisState(year);
    const winless = resource('winless', loadWinlessRecords, 'Career records could not be loaded.');
    busy = Boolean(entry.loading || archive.loading || winless.loading);
    markup = recordsView(entry) + (archive.data?.races.length || winless.data
      ? `<div class="section-title"><h2>Starts &amp; retirements</h2></div>${seasonArchiveRecordsView(archive.data, { winless: winless.data })}`
      : busy ? '<p class="subtle" role="status">Loading starts and retirement records…</p>' : '');
  } else {
    const entry = loadYear(year);
    const { data } = entry;
    if (!data) {
      busy = entry.loading;
      markup = empty(entry.error ?? `Loading ${year} championship data…`, entry.error ? 'season' : '');
    } else {
      const viewKey = `${data.year}/${route.page}/${route.round}`;
      if (viewKey !== dataKey) {
        forecastRound = null;
        sprint = false;
        dataKey = viewKey;
      }
      switch (route.page) {
        case 'standings':
          markup = standings(data, mode, effectivePair(data[mode], route.pair), entry.cached);
          break;
        case 'calendar':
          markup = calendar(data, filter, entry.cached);
          break;
        case 'search':
          markup = renderSearch(data, searchQuery, { pair: route.pair });
          break;
        case 'race': {
          const race = getRace(data);
          const pair = effectivePair(race.results.filter(row => row.number !== null), route.pair);
          const usesTiming = ['timing', 'strategy', 'telemetry'].includes(route.tab) && (route.tab === 'timing' || data.year >= 2023);
          const timing = usesTiming ? getTiming(data, race, pair) : null;
          const lab = raceLab(data, race, timing, pair);
          busy = Boolean(timing?.loading || lab.loading);
          markup = raceView(data, race, route.tab, sprint, timing, pair, pitMetric, lab.markup);
          break;
        }
        case 'forecast':
          markup = validatedForecast(data);
          break;
        default:
          markup = overview(data, mode, entry.cached);
      }
    }
  }
  const restore = focus ?? (content.contains(document.activeElement) ? document.activeElement : null);
  const focusedId = restore?.id;
  const focusedControl = restore?.dataset.control;
  const focusedValue = restore?.dataset.value;
  unmountReplay?.();
  content.innerHTML = markup;
  const replay = content.querySelector('[data-replay-frames]');
  if (replay) {
    if (replayState.key !== replay.dataset.replayKey) {
      replayState = { key: replay.dataset.replayKey, lap: 1, playing: false };
    }
    unmountReplay = mountReplay(replay, replayState);
  } else {
    unmountReplay = undefined;
    replayState.playing = false;
  }
  const lights = content.querySelector('.start-lights');
  if (lights && !startingLightsPlayed) {
    lights.classList.add('is-starting');
    startingLightsPlayed = true;
  }
  content.setAttribute('aria-busy', String(busy));
  if (focusedId && focusedId !== 'content') document.getElementById(focusedId)?.focus({ preventScroll: true });
  if (focusedControl) {
    const expected = [...content.querySelectorAll('[data-control]')].find(node =>
      node.dataset.control === focusedControl && node.dataset.value === focusedValue);
    expected?.focus({ preventScroll: true });
  }
}

function applyRoute() {
  const next = parseHash(location.hash, hashOptions());
  const newPage = route.page !== next.page;
  const previousY = year;
  route = next;
  year = route.year ?? year;
  mode = route.mode ?? (route.page === 'standings' && route.pair?.length ? 'drivers' : mode);
  if (previousY !== year) {
    filter = 'all';
    analysisFilters = {};
  }
  updateHeader();
  render();
  if (newPage || previousY !== year) {
    window.scrollTo(0, 0);
    content.focus({ preventScroll: true });
  }
}

function onControl(control, value) {
  const data = seasonCache.get(year)?.data;
  if (control === 'mode') {
    mode = value;
    updateRoute({ mode, pair: [] });
  }
  if (control === 'calendar-filter') filter = value;
  if (control === 'race-tab' && data) {
    navigate('race', year, getRace(data).round, value, { pair: route.pair, laps: route.laps });
  }
  if (control === 'result-kind') sprint = value === 'sprint';
  if (control === 'pit-metric') pitMetric = value;
}

function onSelect(control, value) {
  if (route.page === 'analysis' && ['driver', 'team', 'circuit'].includes(control)) {
    analysisFilters = { ...analysisFilters, [control]: value };
    return;
  }
  const data = seasonCache.get(year)?.data;
  if (!data) return;
  if (control === 'race-picker') navigate('race', year, Number(value), route.tab, { pair: route.pair });
  if (control === 'forecast-round') forecastRound = Number(value);
  if (control === 'telemetry-first-lap' || control === 'telemetry-second-lap') {
    const race = getRace(data);
    const pair = effectivePair(race.results.filter(row => row.number !== null), route.pair);
    const timing = getTiming(data, race, pair);
    const { selected } = telemetrySelection(comparableDrivers(race, pair), timing?.data);
    selected[control === 'telemetry-first-lap' ? 0 : 1] = Number(value) || null;
    updateRoute({ round: race.round, pair, laps: selected });
  }
  if (control.startsWith('standings-') || control.startsWith('timing-')) {
    const race = control.startsWith('timing-') ? getRace(data) : null;
    if (race) replayState.playing = false;
    const options = race ? race.results.filter(row => row.number !== null) : data[mode];
    const pair = effectivePair(options, route.pair);
    pair[control.endsWith('first') ? 0 : 1] = value;
    updateRoute({ round: race?.round ?? route.round, pair, mode: race ? null : mode, laps: [] });
  }
}

async function shareComparison(target) {
  const data = seasonCache.get(year)?.data;
  if (!data) return;
  const race = route.page === 'race' ? getRace(data) : null;
  const options = race ? race.results.filter(row => row.number !== null) : data[mode];
  const pair = effectivePair(options, route.pair);
  const url = new URL(location.href);
  url.hash = formatHash({ ...route, year, round: race?.round, pair, mode: race ? null : mode }, hashOptions());
  const status = target.parentElement.querySelector('[data-share-status]');
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = 'Comparison link copied.';
  } catch {
    status.textContent = url.href;
  }
}


function onDownload(section) {
  const data = seasonCache.get(year)?.data;
  if (!data) return;
  if (section === 'standings') {
    download(`formula1-${year}-${mode}.csv`, [
      ['Position', 'Name', 'Nationality', 'Team', 'Wins', 'Points'],
      ...data[mode].map(row => [row.rank, row.name, row.country, row.team, row.wins, row.points])
    ]);
  }
  if (section === 'results') {
    const race = getRace(data);
    download(`formula1-${year}-round-${race.round}-${sprint ? 'sprint' : 'race'}.csv`, [
      ['Position', 'Driver', 'Constructor', 'Grid', 'Laps', 'Time', 'Status', 'Points'],
      ...(sprint ? race.sprint : race.results).map(row =>
        [row.classification, row.name, row.team, row.grid, row.laps, row.time, row.status, row.points])
    ]);
  }
}

content.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  const { control, value, retry, download: section } = target.dataset;
  if (control) {
    onControl(control, value);
    if (control !== 'race-tab') render(target);
  }
  if (section) onDownload(section);
  if (target.hasAttribute('data-share')) shareComparison(target);
  if (target.hasAttribute('data-chart-csv')) downloadChartCsv(target);
  if (retry) {
    if (retry === 'analysis') {
      for (const key of activeResources) {
        if (key.startsWith(`season-analysis/${year}/`)) resources.delete(key);
      }
      loadYear(year, true);
    }
    if (retry === 'season') loadYear(year, true);
    if (retry === 'qualifying') resources.delete(`qualifying/${year}/${getRace(seasonCache.get(year).data).round}`);
    if (retry === 'telemetry') for (const key of activeResources) {
      if (key.startsWith('telemetry/')) resources.delete(key);
    }
    if (retry === 'records') loadRecords(true);
    if (retry === 'timing' || retry === 'strategy') {
      const data = seasonCache.get(year)?.data;
      const race = getRace(data);
      const pair = effectivePair(race.results.filter(row => row.number !== null), route.pair);
      const previous = getTiming(data, race, pair);
      if (retry === 'strategy' && previous?.data?.sessionKey) resources.delete(`strategy/${previous.data.sessionKey}`);
      getTiming(data, race, pair, true);
    }
    render();
  }
});

content.addEventListener('change', event => {
  const target = event.target;
  const control = target.dataset.select;
  if (!control) return;
  onSelect(control, target.value);
  if (control !== 'race-picker') render(target);
});

content.addEventListener('input', event => {
  if (!event.target.matches('[data-search]')) return;
  searchQuery = event.target.value;
  updateSearch(content, seasonCache.get(year)?.data, searchQuery, { pair: route.pair });
});
content.addEventListener('submit', event => {
  if (!event.target.matches('[data-search-form]')) return;
  event.preventDefault();
  document.getElementById('season-search-results')?.querySelector('a')?.focus();
});

function chartReadout(event) {
  const target = event.target.closest('[data-chart-hit]');
  if (target) target.closest('.chart-block').querySelector('.chart-readout').textContent = target.dataset.chartHit;
}
content.addEventListener('pointerover', chartReadout);
content.addEventListener('focusin', chartReadout);
content.addEventListener('keydown', event => {
  const target = event.target.closest('[data-chart-hit]');
  if (!target || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const neighbor = event.key === 'ArrowLeft' ? target.previousElementSibling : target.nextElementSibling;
  if (!neighbor?.hasAttribute('data-chart-hit')) return;
  event.preventDefault();
  target.tabIndex = -1;
  neighbor.tabIndex = 0;
  neighbor.focus();
});

yearSelect.addEventListener('change', () => navigate(route.page, Number(yearSelect.value)));
window.addEventListener('hashchange', () => {
  if (location.hash !== '#content') applyRoute();
});

try {
  manifest = await json('./data/index.json');
} catch {
  // The public API can serve seasons without bundled snapshots.
}
const count = Math.max(todayYear, ...manifest.years) - 1950 + 1;
yearSelect.innerHTML = Array.from({ length: count }, (_, index) => {
  const value = count + 1949 - index;
  return `<option value="${value}">${value}</option>`;
}).join('');
applyRoute();
