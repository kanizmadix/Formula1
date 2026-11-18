import { download, e, pageTitle, panelHead, roundLabel } from './ui.js';
import { chartCsvRows } from './chart-rows.js';

export { chartCsvRows };

const defaultPages = ['overview', 'standings', 'calendar', 'race', 'records', 'forecast', 'guide', 'search', 'rating'];
const defaultRaceTabs = ['results', 'timing', 'circuit', 'strategy', 'telemetry'];

export const isDriverId = id => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/.test(id);

function cleanPair(pair) {
  return Array.isArray(pair) ? [...new Set(pair.slice(0, 2).filter(isDriverId))] : [];
}

function positiveInt(value, digits) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  return text.length <= digits && /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

function routeFields({ page, year, round, tab, pair, mode, laps }, {
  maxYear = 9999, pages = defaultPages, raceTabs = defaultRaceTabs
} = {}) {
  const validYear = /^\d{4}$/.test(year ?? '') && year >= 1950 && year <= maxYear ? Number(year) : null;
  const validPage = pages.includes(page) ? page : 'overview';
  const validRound = validPage === 'race' && validYear ? positiveInt(round, 2) : null;
  const [firstLap, secondLap] = Array.isArray(laps) ? laps : [];
  const lapA = positiveInt(firstLap, 3);
  const lapB = positiveInt(secondLap, 3);
  return {
    page: validPage,
    year: validYear,
    round: validRound,
    tab: validRound && raceTabs.includes(tab) ? tab : 'results',
    pair: cleanPair(pair),
    mode: ['drivers', 'teams'].includes(mode) ? mode : null,
    laps: lapA || lapB ? [lapA, lapB] : []
  };
}

export function parseHash(hash = '', options) {
  const fragment = hash.replace(/^#/, '');
  const separator = fragment.indexOf('?');
  const path = separator === -1 ? fragment : fragment.slice(0, separator);
  const [page, year, round, tab] = path.split('/');
  const params = new URLSearchParams(separator === -1 ? '' : fragment.slice(separator + 1));
  return routeFields({
    page, year, round, tab, pair: [params.get('a'), params.get('b')],
    mode: params.get('kind'), laps: [params.get('lapA'), params.get('lapB')]
  }, options);
}

export function formatHash(route, options) {
  const { page, year, round, tab, pair, mode, laps } = routeFields(route, options);
  const params = new URLSearchParams();
  if (pair[0]) params.set('a', pair[0]);
  if (pair[1]) params.set('b', pair[1]);
  if (mode) params.set('kind', mode);
  if (laps[0]) params.set('lapA', laps[0]);
  if (laps[1]) params.set('lapB', laps[1]);
  return `#${page}${year ? `/${year}` : ''}${round ? `/${round}/${tab}` : ''}${params.size ? `?${params}` : ''}`;
}

const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function matchScore(query, values) {
  const fields = values.map(normalize).filter(Boolean);
  if (fields.includes(query)) return 3;
  if (fields.some(field => field.startsWith(query))) return 2;
  return query.split(' ').every(word => fields.some(field => field.includes(word))) ? 1 : 0;
}

function matching(rows, query) {
  return rows.map(row => ({ row, score: matchScore(query, [row.name, ...row.aliases]) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, 'en') || a.row.id.localeCompare(b.row.id, 'en'))
    .map(match => match.row);
}

export function searchSeason(season, text) {
  const query = normalize(text);
  if (!query) return { drivers: [], circuits: [] };

  const drivers = new Map();
  const circuits = new Map();
  function addDriver(row, { standing = false, race = null, grandPrix = false } = {}) {
    if (!isDriverId(row?.id)) return;
    const driver = drivers.get(row.id) ?? { id: row.id, aliases: new Set(), timingRaces: [] };
    driver.name ??= row.name || undefined;
    driver.team ??= row.team || undefined;
    for (const value of [row.id, row.name, row.code, row.country, row.team, row.number]) driver.aliases.add(value);
    if (standing) driver.standing = true;
    if (grandPrix) driver.rating = true;
    if (race && !driver.latest) {
      driver.latest = race;
      driver.latestIsGrandPrix = grandPrix;
    }
    if (grandPrix && Number.isInteger(row.number) && season.year >= 1996) driver.timingRaces.push(race);
    drivers.set(row.id, driver);
  }

  for (const row of season?.drivers ?? []) addDriver(row, { standing: true });
  const races = (season?.races ?? []).filter(race => Number.isInteger(race?.round) && race.round > 0 && race.round <= 99);
  for (const race of races.sort((a, b) => b.round - a.round)) {
    for (const row of race.results ?? []) addDriver(row, { race, grandPrix: true });
    for (const row of race.sprint ?? []) addDriver(row, { race });
    const id = race.circuitId || (race.circuit && [race.circuit, race.city, race.country].map(normalize).join('/')) || String(race.round);
    const circuit = circuits.get(id) ?? {
      id, name: race.circuit || race.name || `Round ${race.round}`, location: [race.city, race.country].filter(Boolean).join(', '),
      aliases: new Set(), races: []
    };
    for (const value of [race.circuitId, race.circuit, race.name, race.city, race.country]) circuit.aliases.add(value);
    circuit.races.unshift(race);
    circuits.set(id, circuit);
  }

  for (const driver of drivers.values()) driver.name ??= driver.id;
  return { drivers: matching([...drivers.values()], query), circuits: matching([...circuits.values()], query) };
}

function searchContent(season, query, { pair, ratingPage } = {}) {
  if (!season) return { status: 'Season data is unavailable.', markup: '' };
  if (!normalize(query)) return { status: 'Enter a driver, circuit, or Grand Prix to search this season.', markup: '' };
  const { drivers, circuits } = searchSeason(season, query);
  if (!drivers.length && !circuits.length) return { status: `No matching drivers or circuits for ${season.year}.`, markup: '' };
  const selected = cleanPair(pair);
  const link = (route, driverPair = selected) => e(formatHash({ ...route, year: season.year, pair: driverPair }, {
    pages: ratingPage ? [...defaultPages, ratingPage] : defaultPages
  }));
  const sections = [];
  if (drivers.length) {
    const rows = drivers.map(driver => {
      const driverPair = selected.includes(driver.id) ? selected : [driver.id, ...selected.slice(-1)];
      const destinations = [];
      if (driver.standing) destinations.push(['Standings', link({ page: 'standings', mode: 'drivers' }, driverPair)]);
      if (ratingPage && driver.rating) destinations.push(['Rating', link({ page: ratingPage }, driverPair)]);
      const hasTimingDriver = (race, id) => race.results.some(row => row?.id === id && Number.isInteger(row.number));
      const timingRace = driver.timingRaces.find(race => driverPair.every(id => hasTimingDriver(race, id))) ?? driver.timingRaces[0];
      if (timingRace) {
        const timingPair = driverPair.filter(id => hasTimingDriver(timingRace, id));
        destinations.push([`Race timing · ${roundLabel(timingRace.round)}`, link({ page: 'race', round: timingRace.round, tab: 'timing' }, timingPair)]);
      } else if (driver.latest) {
        const label = driver.latestIsGrandPrix ? 'Race results' : 'Sprint weekend';
        const href = link({ page: 'race', round: driver.latest.round, tab: 'results' }, driverPair);
        destinations.push([`${label} · ${roundLabel(driver.latest.round)}`, href]);
      }
      const actions = destinations.map(([label, href]) =>
        `<a class="text-link" href="${href}" aria-label="${e(`${label} for ${driver.name}`)}">${e(label)}</a>`).join('');
      return `<li class="link-row"><span><strong>${e(driver.name)}</strong>${driver.team ? `<span class="meta">${e(driver.team)}</span>` : ''}</span>
        <span class="search-links">${actions}</span></li>`;
    });
    sections.push(`<section class="panel">${panelHead('Drivers')}<ul class="search-list" role="list">${rows.join('')}</ul></section>`);
  }
  if (circuits.length) {
    const rows = circuits.map(circuit => {
      const weekends = circuit.races.map(race => {
        const label = `${roundLabel(race.round)} · ${race.name || 'Circuit details'}`;
        return `<a class="text-link" href="${link({ page: 'race', round: race.round, tab: 'circuit' })}"
          aria-label="${e(`${label} at ${circuit.name}`)}">${e(label)}</a>`;
      }).join('');
      return `<li class="link-row"><span><strong>${e(circuit.name)}</strong>${circuit.location ? `<span class="meta">${e(circuit.location)}</span>` : ''}</span>
        <span class="search-links">${weekends}</span></li>`;
    });
    sections.push(`<section class="panel">${panelHead('Circuits')}<ul class="search-list" role="list">${rows.join('')}</ul></section>`);
  }
  return {
    status: `${drivers.length} ${drivers.length === 1 ? 'driver' : 'drivers'} and ${circuits.length} ${circuits.length === 1 ? 'circuit' : 'circuits'} found.`,
    markup: sections.join('')
  };
}

export function renderSearch(season, query = '', options) {
  const { status, markup } = searchContent(season, query, options);
  const title = season ? `Search the ${season.year} season` : 'Search';
  return `${pageTitle(title, 'Find drivers, circuits, and race weekends.')}
    <form class="control-row" role="search" data-search-form>
      <label for="season-search">Driver or circuit</label>
      <input type="search" id="season-search" name="q" data-search value="${e(query)}" autocomplete="off" aria-controls="season-search-results">
      <button type="submit" class="secondary">Search</button>
    </form>
    <div class="stack">
      <p id="season-search-status" class="subtle" role="status">${e(status)}</p>
      <div id="season-search-results" class="stack">${markup}</div>
    </div>`;
}

export function updateSearch(root, season, query, options) {
  const statusNode = root.querySelector('#season-search-status');
  const resultsNode = root.querySelector('#season-search-results');
  if (!statusNode || !resultsNode) return;
  const { status, markup } = searchContent(season, query, options);
  if (statusNode.textContent !== status) statusNode.textContent = status;
  resultsNode.innerHTML = markup;
}

export function downloadChartCsv(button) {
  const payload = button?.dataset?.chartCsv;
  if (!payload) return;
  const { filename, rows } = JSON.parse(payload);
  download(filename, rows);
}
