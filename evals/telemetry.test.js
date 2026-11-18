import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultTelemetryLap, loadQualifying, loadTelemetry, qualifyingView, telemetryView } from '../web/telemetry.js';

const start = '2025-12-07T13:14:10.198Z';
const nextStart = '2025-12-07T13:19:51.508Z';
const lap = (driver, number, overrides = {}) => ({
  driver_number: driver, lap_number: number, date_start: start, lap_duration: 92.249, ...overrides
});
const sample = (session, driver, time, offset, fields = {}) => ({
  session_key: session, driver_number: driver,
  date: new Date(Date.parse(time) + offset).toISOString(),
  speed: 306, throttle: 99, brake: 0, n_gear: 8, ...fields
});

test('default selection prefers the fastest bounded lap and falls back to pit-out laps', () => {
  const pit = lap(44, 2, { lap_duration: 85, is_pit_out_lap: true });
  const choices = [
    lap(44, 1, { date_start: null, lap_duration: 81 }),
    pit,
    lap(44, 10, { lap_duration: 601 }),
    lap(44, 8),
    lap(44, 7)
  ];
  assert.equal(defaultTelemetryLap(choices), 7);
  assert.equal(defaultTelemetryLap([pit]), 2);
  assert.equal(defaultTelemetryLap([choices[0], choices[2]]), null);
});

test('car data requests are bounded per driver and each selected lap has its own elapsed origin', async t => {
  const session = 9839;
  const first = lap(44, 8, { session_key: session });
  const second = lap(16, 12, { date_start: nextStart, lap_duration: 92 });
  const fetch = t.mock.method(globalThis, 'fetch', async rawUrl => {
    const url = new URL(rawUrl);
    assert.equal(url.origin, 'https://api.openf1.org');
    assert.equal(url.pathname, '/v1/car_data');
    assert.equal(url.searchParams.get('session_key'), String(session));
    if (url.searchParams.get('driver_number') === '44') {
      assert.match(url.search, /&date%3E=2025-12-07T13:14:10\.198Z&date%3C2025-12-07T13:15:42\.447Z$/);
      return Response.json([
        sample(session, 44, start, 700, { throttle: 104, brake: 42, n_gear: 8.5 }),
        sample(session, 44, start, -1),
        sample(session, 44, start, 200, { speed: null, throttle: 0, brake: 100, n_gear: 0 }),
        sample(session, 44, start, 200, { speed: 155 }),
        sample(session, 44, start, 92249),
        sample(session + 1, 44, start, 400),
        sample(session, 16, start, 400),
        sample(session, 44, start, 400, { date: 'invalid' })
      ]);
    }
    assert.equal(url.searchParams.get('driver_number'), '16');
    assert.match(url.search, /&date%3E=2025-12-07T13:19:51\.508Z&date%3C2025-12-07T13:21:23\.508Z$/);
    return Response.json([sample(session, 16, nextStart, 200)]);
  });
  const data = await loadTelemetry(String(session), [first, second]);
  assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(data.series.map(line => [line.driver, line.lapNumber]), [[44, 8], [16, 12]]);
  assert.deepEqual(data.series[0].samples, [
    { elapsed: .2, speed: 155, throttle: 0, brake: 100, gear: 0 },
    { elapsed: .7, speed: 306, throttle: null, brake: null, gear: null }
  ]);
  assert.equal(data.series[1].samples[0].elapsed, .2);
});

test('empty and invalid selections cannot trigger telemetry requests', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  const selections = [lap(44, 2, { session_key: 500 }), lap(16, 4, { lap_duration: 1500 })];
  await assert.rejects(loadTelemetry('latest', selections), /archived OpenF1 session/);
  const data = await loadTelemetry(501, selections);
  assert.equal(fetch.mock.callCount(), 0);
  assert.ok(data.series.every(line => line.error && !line.samples.length));
});

test('one failed lap preserves the other trace and an empty response can be retried', async t => {
  const session = 8041;
  const selections = [lap(44, 3), lap(16, 10)];
  let secondAttempts = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).searchParams.get('driver_number') === '44') return new Response(null, { status: 503 });
    return Response.json(secondAttempts++ ? [sample(session, 16, start, 100)] : []);
  });
  const initial = await loadTelemetry(session, selections);
  assert.match(initial.series[0].error, /HTTP 503/);
  assert.deepEqual(initial.series[1].samples, []);
  const retried = await loadTelemetry(session, [null, selections[1]]);
  assert.equal(retried.series[0], null);
  assert.equal(retried.series[1].samples.length, 1);
  await assert.rejects(loadTelemetry(session, [selections[0], null]), /HTTP 503/);
});

test('telemetry view preserves A/B selectors, breaks gaps, and emits numeric per-lap CSV', () => {
  const first = lap(44, 8, { lap_duration: 6 });
  const second = lap(16, 12, { lap_duration: 5 });
  const drivers = [{ number: 44, name: '<First>', code: 'ONE' }, { number: 16, name: 'Second', code: 'TWO' }];
  const recorded = (elapsed, overrides) => ({ elapsed, speed: 200, throttle: 80, brake: 0, gear: 6, ...overrides });
  const state = { data: { sessionKey: 9839, series: [
    { driver: 44, lapNumber: 8, duration: 6, samples: [
      recorded(.5, { throttle: null, brake: 100 }), recorded(1), recorded(3), recorded(3.5)
    ] },
    { driver: 16, lapNumber: 12, duration: 5, samples: [recorded(1), recorded(1.5)] }
  ] } };
  const laps = { 44: [first, lap(44, 9, { date_start: null })], 16: [second] };
  const html = telemetryView(state, drivers, laps, [8, 12]);
  assert.match(html, /data-select="telemetry-first-lap"[^>]*>.*?<option value="8" selected>/s);
  assert.match(html, /data-select="telemetry-second-lap"[^>]*>.*?<option value="12" selected>/s);
  assert.doesNotMatch(html, /<option value="9"|<First>/);
  assert.match(html, /recording gaps · missing values in throttle/);
  for (const label of ['Speed by', 'Throttle by', 'Brake by', 'Gear by']) assert.ok(html.includes(label));
  const speedPath = html.match(/<path d="([^"]+)"/)[1];
  assert.deepEqual(speedPath.match(/[ML]/g), ['M', 'L', 'M', 'L']);
  assert.match(speedPath, /^M95\.67,/); // First trace begins at .5 s on the shared 6 s scale.
  const csvs = [...html.matchAll(/data-chart-csv="([^"]+)"/g)].map(match =>
    JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
  assert.deepEqual(csvs.map(csv => csv.filename), ['telemetry-9839-car-44-lap-8.csv', 'telemetry-9839-car-16-lap-12.csv']);
  assert.deepEqual(csvs[0].rows[0], ['Elapsed lap time (s)', 'Speed (km/h)', 'Throttle (%)', 'Brake (0 off, 100 on)', 'Gear (number)']);
  assert.deepEqual(csvs[0].rows[1], [.5, 200, null, 100, 6]);
  assert.doesNotMatch(telemetryView(state, drivers, laps, [null, 12]), /car-44-lap-8\.csv/);
});

test('qualifying joins driver IDs, preserves missing times and compares classified positions only', async t => {
  const entries = [
    { Driver: { driverId: 'b', givenName: 'Pit', familyName: 'Lane' }, position: '2', Q1: '1:02.500' },
    { Driver: { driverId: 'a', givenName: 'Early', familyName: 'Starter' }, position: '1', Q1: '1:01.100', Q3: '1:01.016' },
    { Driver: { driverId: 'c', givenName: 'Retired' }, position: '5', Q1: '1:03.000' },
    { Driver: { driverId: 'q', givenName: 'Qualifying only' }, position: '8' }
  ];
  const response = { MRData: { total: '4', RaceTable: { Races: [
    { season: '2024', round: '17', QualifyingResults: entries }
  ] } } };
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), 'https://api.jolpi.ca/ergast/f1/2024/17/qualifying/?limit=100&offset=0');
    return Response.json(response);
  });
  const race = { round: 17, results: [
    { id: 'a', grid: 3, classification: '2', rank: 2, status: 'Lapped' },
    { id: 'b', grid: 0, classification: '1', rank: 1, status: 'Finished' },
    { id: 'c', grid: 5, classification: 'R', rank: 7, status: 'Collision' },
    { id: 'r', name: 'Race only', grid: 6, classification: '4', rank: 4, status: 'Finished' }
  ] };
  const data = await loadQualifying(2024, race);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(data.results.map(row => row.position), [1, 2, 5, 8]);
  const html = qualifyingView({ data }, race);
  const cells = name => {
    const row = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].find(match => match[1].startsWith(`<td>${name}</td>`));
    return [...row[1].matchAll(/<td(?: class="num")?>(.*?)<\/td>/g)].map(match => match[1]);
  };
  assert.deepEqual(cells('Early Starter').slice(2), ['1', '1:01.100', '—', '1:01.016', '3', '2', 'Lapped', '−1', '+1']);
  assert.deepEqual(cells('Pit Lane').slice(-5), ['No grid slot (0)', '1', 'Finished', '+1', '—']);
  assert.deepEqual(cells('Retired').slice(-5), ['5', 'R', 'Collision', '—', '—']);
  assert.deepEqual(cells('Race only').slice(-2), ['—', '+2']);
  assert.deepEqual(cells('Qualifying only').slice(-2), ['—', '—']);
  assert.match(qualifyingView({ error: 'Qualifying unavailable' }, race), /data-retry="qualifying".*Race only/s);
});
