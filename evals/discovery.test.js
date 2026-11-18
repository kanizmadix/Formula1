import test from 'node:test';
import assert from 'node:assert/strict';
import { chartCsvRows } from '../web/chart-rows.js';
import {
  chartCsvRows as discoveryCsvRows, downloadChartCsv, formatHash, isDriverId, parseHash, renderSearch, searchSeason, updateSearch
} from '../web/discovery.js';

const season = {
  year: 2021,
  drivers: [
    { id: 'perez', name: 'Sergio Pérez', code: 'PER', team: 'Red Bull' },
    { id: 'max_verstappen', name: 'Max Verstappen', code: 'VER', team: 'Red Bull' }
  ],
  races: [
    {
      round: 8, name: 'Styrian Grand Prix', circuit: 'Red Bull Ring', circuitId: 'red_bull_ring', city: 'Spielberg', country: 'Austria',
      results: [{ id: 'perez', number: 11 }, { id: 'max_verstappen', number: 33 }]
    },
    {
      round: 9, name: 'Austrian Grand Prix', circuit: 'Red Bull Ring', circuitId: 'red_bull_ring', city: 'Spielberg', country: 'Austria',
      results: [{ id: 'perez', number: 11 }]
    },
    {
      round: 12, name: 'Belgian Grand Prix', circuit: 'Circuit de Spa-Francorchamps', circuitId: 'spa', city: 'Spa', country: 'Belgium',
      results: [{ id: 'test_driver', name: 'Test & Driver', number: null }]
    },
    { round: 14, name: 'Italian Grand Prix', sprint: [{ id: 'sprint_only', name: 'Sprint Only', code: 'SPR' }] }
  ]
};

test('legacy hashes and pair links round-trip across race tabs and season comparisons', () => {
  assert.deepEqual(parseHash('#race/2021/08/timing'), {
    page: 'race', year: 2021, round: 8, tab: 'timing', pair: [], mode: null, laps: []
  });
  assert.equal(formatHash(parseHash('#standings')), '#standings');
  const pair = ['max_verstappen', 'perez'];
  for (const tab of ['results', 'circuit', 'strategy', 'timing', 'telemetry']) {
    const route = { page: 'race', year: 2021, round: 8, tab, pair, mode: null, laps: [] };
    const hash = `#race/2021/8/${tab}?a=max_verstappen&b=perez`;
    assert.equal(formatHash(route), hash);
    assert.deepEqual(parseHash(hash), route);
  }
  assert.deepEqual(parseHash('#rating/2021?a=perez').pair, ['perez']);
  assert.equal(formatHash({ page: 'standings', year: 2021, pair: ['perez', ''] }), '#standings/2021?a=perez');
});

test('route validation handles malformed IDs, duplicate comparisons, invalid years and allowed tabs', () => {
  assert.equal(isDriverId('jean-pierre_2'), true);
  assert.equal(isDriverId('a'.repeat(65)), false);
  assert.equal(isDriverId('perez\n'), false);
  assert.deepEqual(parseHash('#race/2021/9/timing?a=%3Cscript%3E&b=max_verstappen').pair, ['max_verstappen']);
  assert.deepEqual(parseHash('#standings/2021?a=p%65rez&b=perez&unknown=value').pair, ['perez']);
  assert.deepEqual(parseHash('#standings/2021?a=perez%2Falpine&b=%E0%A4%A').pair, []);
  const options = { pages: ['overview', 'race', 'driver-rating'], raceTabs: ['results', 'timing'], maxYear: 2026 };
  assert.equal(parseHash('#driver-rating/2024', options).page, 'driver-rating');
  assert.equal(parseHash('#rating/2024', options).page, 'overview');
  assert.equal(parseHash('#race/9999/8/telemetry', options).year, null);
  assert.equal(parseHash('#race/2024/0/timing', options).round, null);
  assert.equal(parseHash('#race/2024/8/telemetry', options).tab, 'results');
});

test('optional mode and lap fields round-trip independently and retain lap positions', () => {
  const hash = '#race/2024/6/telemetry?a=norris&b=piastri&kind=drivers&lapA=27&lapB=29';
  const route = {
    page: 'race', year: 2024, round: 6, tab: 'telemetry', pair: ['norris', 'piastri'], mode: 'drivers', laps: [27, 29]
  };
  assert.deepEqual(parseHash(hash), route);
  assert.equal(formatHash(route), hash);
  assert.equal(formatHash({ page: 'standings', year: 2024, mode: 'teams' }), '#standings/2024?kind=teams');
  const partial = parseHash('#race/2024/6/telemetry?kind=constructor&lapA=1e2&lapB=035');
  assert.equal(partial.mode, null);
  assert.deepEqual(partial.laps, [null, 35]);
  assert.equal(formatHash(partial), '#race/2024/6/telemetry?lapB=35');
  assert.deepEqual(parseHash('#race/2024/6/telemetry?lapA=-1&lapB=0').laps, []);
  assert.deepEqual(parseHash('#race/2024/6/telemetry?lapA=200&lapB=5000').laps, [200, null]);
});

test('season aliases find drivers and group circuit weekends despite partial feeds', () => {
  assert.deepEqual(searchSeason(season, 'PeREz').drivers.map(row => row.id), ['perez']);
  assert.deepEqual(searchSeason(season, 'MAX_verstappen').drivers.map(row => row.id), ['max_verstappen']);
  assert.deepEqual(searchSeason(season, 'red bull per').drivers.map(row => row.id), ['perez']);
  assert.deepEqual(searchSeason(season, 'SPR').drivers.map(row => row.id), ['sprint_only']);
  assert.deepEqual(searchSeason(season, 'test driver').drivers.map(row => row.id), ['test_driver']);
  assert.deepEqual(searchSeason({ year: 2022 }, 'perez'), { drivers: [], circuits: [] });
  assert.deepEqual(searchSeason(season, ' ').drivers, []);
  const [circuit] = searchSeason(season, 'Spielberg Austrian').circuits;
  assert.equal(circuit.name, 'Red Bull Ring');
  assert.deepEqual(circuit.races.map(race => race.round), [8, 9]);
});

test('search exposes labeled controls, live status and season-specific pair links', () => {
  const options = { pair: ['max_verstappen', 'perez'], ratingPage: 'driver-rating' };
  const driver = renderSearch(season, 'Pérez', options);
  assert.match(driver, /<form[^>]+role="search"/);
  assert.match(driver, /<label for="season-search">Driver or circuit<\/label>/);
  assert.match(driver, /type="search" id="season-search"[^>]+aria-controls="season-search-results"/);
  assert.match(driver, /role="status">1 driver and 0 circuits found\./);
  assert.match(driver, /href="#standings\/2021\?a=max_verstappen&amp;b=perez&amp;kind=drivers"/);
  assert.match(driver, /href="#driver-rating\/2021\?a=max_verstappen&amp;b=perez"/);
  assert.match(driver, /href="#race\/2021\/8\/timing\?a=max_verstappen&amp;b=perez"/);
  assert.match(renderSearch(season, 'Pérez', { pair: ['not_in_results', 'perez'] }), /href="#race\/2021\/9\/timing\?a=perez"/);
  const circuit = renderSearch(season, 'red_bull_ring', options);
  for (const round of [8, 9]) {
    assert.ok(circuit.includes(`href="#race/2021/${round}/circuit?a=max_verstappen&amp;b=perez"`));
  }
  const raceOnly = renderSearch(season, '"test & driver"', options);
  assert.match(raceOnly, /value="&quot;test &amp; driver&quot;"/);
  assert.match(raceOnly, /href="#race\/2021\/12\/results\?a=test_driver&amp;b=perez"/);
  assert.doesNotMatch(raceOnly, /href="#standings/);
  assert.match(renderSearch(season, 'Nobody'), /No matching drivers or circuits for 2021\./);
});

test('search updates preserve the form by changing only the status and results', () => {
  const nodes = { '#season-search-status': { textContent: '' }, '#season-search-results': { innerHTML: '' } };
  const root = { querySelector: selector => nodes[selector] };
  updateSearch(root, season, 'PER');
  assert.equal(nodes['#season-search-status'].textContent, '1 driver and 0 circuits found.');
  assert.match(nodes['#season-search-results'].innerHTML, /Sergio Pérez/);
  updateSearch(root, season, 'zzzz');
  assert.equal(nodes['#season-search-status'].textContent, 'No matching drivers or circuits for 2021.');
  assert.equal(nodes['#season-search-results'].innerHTML, '');
});

test('chart rows keep axis and series order, zero and raw values, and blank gaps', () => {
  const chart = {
    label: 'Lap delta <seconds>', dataHeading: 'Lap',
    labels: [{ short: '1', detail: 'Lap 1' }, { short: '2' }, { short: '3' }, { short: '4' }],
    series: [{ name: 'Driver A', values: [0, null, -1.532728, Infinity, 99] }, { name: 'Driver "B"', values: [NaN, 1.875] }]
  };
  assert.deepEqual(chartCsvRows(chart), [
    ['Lap', 'Driver A', 'Driver "B"'], ['Lap 1', 0, null], ['2', null, 1.875], ['3', -1.532728, null], ['4', null, null]
  ]);
  assert.equal(discoveryCsvRows, chartCsvRows);
  assert.deepEqual(chartCsvRows({ ...chart, exportUnit: 's' })[0], ['Lap', 'Driver A (s)', 'Driver "B" (s)']);
});

test('chart button downloads an escaped CSV with blank missing values', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let csv;
  let revoked;
  let clicked = false;
  const anchor = { click() { clicked = true; } };
  t.mock.method(URL, 'createObjectURL', blob => {
    csv = blob.text();
    return 'blob:test';
  });
  t.mock.method(URL, 'revokeObjectURL', url => { revoked = url; });
  globalThis.document = { createElement: () => anchor };
  try {
    const payload = { filename: 'test.csv', rows: [['Lap', 'A "B"'], ['=formula', null], ['Lap 3', -0.3]] };
    downloadChartCsv({ dataset: { chartCsv: JSON.stringify(payload) } });
    assert.equal(anchor.download, 'test.csv');
    assert.equal(anchor.href, 'blob:test');
    assert.equal(clicked, true);
    assert.equal(await csv, '"Lap","A ""B"""\r\n"\'=formula",""\r\n"Lap 3","-0.3"');
    t.mock.timers.tick(1000);
    assert.equal(revoked, 'blob:test');
  } finally {
    delete globalThis.document;
  }
});
