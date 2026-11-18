import { json, legacyPits, legacyTiming, openTiming, season, timingSession, winnerRecords } from './data.js';
import { completed } from './metrics.js';
import { download, e, empty, icon } from './ui.js';
import { calendar, forecast, guide, overview, raceView, recordsView, standings } from './views.js';

const pages = {
  overview: 'Overview', standings: 'Standings', calendar: 'Calendar', race: 'Race analysis',
  records: 'Records', forecast: 'Forecast lab', guide: 'About & data'
};
const content = document.querySelector('#content');
const yearSelect = document.querySelector('#year');
const nav = document.querySelector('#nav');
const todayYear = new Date().getUTCFullYear();
const seasonCache = new Map();
const timingCache = new Map();
let manifest = { years: [], records: false };
let year = todayYear;
let route = { page: 'overview' };
let mode = 'drivers';
let filter = 'all';
let sprint = false;
let pitMetric = 'lane';
let standingsPair = [];
let timingPair = [];
let forecastRound = null;
let records;
let dataKey = '';

nav.innerHTML = Object.entries(pages).filter(([id]) => id !== 'guide').map(([id, label]) =>
  `<a href="#${id}" data-page="${id}" class="nav-link">${icon(id)}${e(label)}</a>`).join('');
document.querySelector('#guide-link').innerHTML = `${icon('guide')}About &amp; data`;

function parseHash() {
  const [page, yearText, roundText, tabText] = location.hash.slice(1).split('/');
  const wanted = Number(yearText);
  return {
    page: Object.hasOwn(pages, page) ? page : 'overview',
    year: /^\d{4}$/.test(yearText ?? '') && wanted >= 1950 && wanted <= Math.max(todayYear, ...manifest.years) ? wanted : null,
    round: /^\d{1,2}$/.test(roundText ?? '') ? Number(roundText) : null,
    tab: ['results', 'timing', 'circuit'].includes(tabText) ? tabText : 'results'
  };
}

function navigate(page, targetYear = year, round = null, tab = 'results') {
  const next = `#${page}/${targetYear}${round ? `/${round}/${tab}` : ''}`;
  if (next !== location.hash) location.hash = next;
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
      if (route.page === 'race' && route.tab === 'timing') render();
    }
  })();
  return entry;
}

function render(focus) {
  let markup;
  let busy = false;
  if (route.page === 'guide') {
    markup = guide();
  } else if (route.page === 'records') {
    const entry = loadRecords();
    markup = recordsView(entry);
    busy = entry.loading;
  } else {
    const entry = loadYear(year);
    const { data } = entry;
    if (!data) {
      busy = entry.loading;
      markup = empty(entry.error ?? `Loading ${year} championship data…`, entry.error ? 'season' : '');
    } else {
      const viewKey = `${data.year}/${route.page}/${route.round}`;
      if (viewKey !== dataKey) {
        standingsPair = [];
        timingPair = [];
        forecastRound = null;
        sprint = false;
        dataKey = viewKey;
      }
      switch (route.page) {
        case 'standings':
          markup = standings(data, mode, effectivePair(data[mode], standingsPair), entry.cached);
          break;
        case 'calendar':
          markup = calendar(data, filter, entry.cached);
          break;
        case 'race': {
          const race = getRace(data);
          const pair = effectivePair(race.results.filter(row => row.number !== null), timingPair);
          const timing = route.tab === 'timing' ? getTiming(data, race, pair) : null;
          busy = Boolean(timing?.loading);
          markup = raceView(data, race, route.tab, sprint, timing, pair, pitMetric);
          break;
        }
        case 'forecast':
          markup = forecast(data, mode, forecastRound ?? completed(data).at(-1)?.round);
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
  content.innerHTML = markup;
  content.setAttribute('aria-busy', String(busy));
  if (focusedId && focusedId !== 'content') document.getElementById(focusedId)?.focus({ preventScroll: true });
  if (focusedControl) {
    const expected = [...content.querySelectorAll('[data-control]')].find(node =>
      node.dataset.control === focusedControl && node.dataset.value === focusedValue);
    expected?.focus({ preventScroll: true });
  }
}

function applyRoute() {
  const next = parseHash();
  const newPage = route.page !== next.page;
  const previousY = year;
  route = next;
  year = route.year ?? year;
  if (previousY !== year) filter = 'all';
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
    standingsPair = [];
  }
  if (control === 'calendar-filter') filter = value;
  if (control === 'race-tab' && data) navigate('race', year, getRace(data).round, value);
  if (control === 'result-kind') sprint = value === 'sprint';
  if (control === 'pit-metric') pitMetric = value;
}

function onSelect(control, value) {
  const data = seasonCache.get(year)?.data;
  if (!data) return;
  if (control === 'race-picker') navigate('race', year, Number(value), route.tab);
  if (control === 'forecast-round') forecastRound = Number(value);
  if (control.startsWith('standings-')) {
    standingsPair = effectivePair(data[mode], standingsPair);
    standingsPair[control.endsWith('first') ? 0 : 1] = value;
  }
  if (control.startsWith('timing-')) {
    timingPair = effectivePair(getRace(data).results.filter(row => row.number !== null), timingPair);
    timingPair[control.endsWith('first') ? 0 : 1] = value;
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
  if (retry) {
    if (retry === 'season') loadYear(year, true);
    if (retry === 'records') loadRecords(true);
    if (retry === 'timing') {
      const data = seasonCache.get(year)?.data;
      const race = getRace(data);
      const pair = effectivePair(race.results.filter(row => row.number !== null), timingPair);
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
