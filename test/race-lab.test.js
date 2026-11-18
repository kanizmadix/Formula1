import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { legacyPits, season, utcRaceTime } from '../web/data.js';
import { byAge, completed, cumulative, median, model, racePoints, trendPace } from '../web/metrics.js';
import { chart, e, lapTime } from '../web/ui.js';

const read = async file => JSON.parse(await readFile(new URL(`../data/${file}.json`, import.meta.url), 'utf8'));
const data = await read('2023');
const records = await read('records');

test('published snapshots retain unique scheduled rounds, classified positions, and source dates', async () => {
  for (const year of [2021, 2022, 2023, 2024, 2025, 2026]) {
    const selected = await read(year);
    assert.equal(selected.year, year);
    assert.ok(selected.races.length > 15);
    assert.equal(new Set(selected.races.map(race => race.round)).size, selected.races.length);
    assert.ok(Number.isFinite(Date.parse(selected.fetchedAt)));
    for (const race of selected.races) {
      assert.ok(Number.isFinite(utcRaceTime(race)));
      assert.ok(race.circuit && race.country);
      assert.ok(race.results.every(row => row.id && row.teamId && Number.isFinite(row.points)));
      if (race.results.length) assert.ok(race.results.find(row => row.classification === '1'));
    }
  }
});

test('driver and team trajectories include sprint points and preserve official standings', () => {
  const races = completed(data);
  const victory = races.find(race => race.name === 'Azerbaijan Grand Prix');
  const driver = victory.results.find(result => result.id === 'perez');
  const sprint = victory.sprint.find(result => result.id === 'perez');
  assert.equal(driver.points, 25);
  assert.equal(sprint.points, 8);
  assert.deepEqual(racePoints([victory], 'perez', false), [33]);
  assert.deepEqual(racePoints([victory], 'red_bull', true), [57]);
  assert.deepEqual(cumulative([25, 0, 18.5]), [25, 25, 43.5]);
  assert.equal(data.drivers[0].id, 'max_verstappen');
  assert.equal(data.drivers[0].points, 575);
});

test('rolling forecasts use the data available at the selected cutoff', () => {
  assert.equal(trendPace([4, 4, 4, 4]), 4);
  const before = model(data, false, 6);
  const altered = { ...data, races: data.races.map(race => race.round <= 6 ? race : {
    ...race, results: race.results.map(row => ({ ...row, points: 999 }))
  }) };
  assert.deepEqual(model(altered, false, 6), before);
  assert.equal(before.rest, data.races.length - 6);
  assert.equal(before.useOfficial, false);
  assert.ok(before.sample > 0);
  const final = model(data, false, data.driverRound);
  assert.equal(final.useOfficial, true);
  assert.equal(final.rest, 0);
  assert.equal(final.rows[0].estimate, data.drivers[0].points);
});

test('historical age records are derived from dates and ignore missing birthdays', () => {
  const ages = byAge([...records.wins, { born: null, date: '2000-01-01' }]);
  assert.equal(ages[0].id, 'max_verstappen');
  assert.equal(ages.at(-1).id, 'fagioli');
  assert.equal(median([100, 90, 120, 110]), 105);
  assert.equal(median([]), null);
});

test('chart output escapes provider-derived names and handles missing lap samples', () => {
  const label = '<script>bad</script>';
  const html = chart({
    label, labels: [{ short: label }, { short: '2' }, { short: '3' }],
    series: [{ name: label, color: '#eee', values: [61, null, 62] }],
    format: lapTime
  });
  assert.ok(!html.includes(label));
  assert.ok(html.includes(e(label)));
  assert.match(html, /M53\.0,[\d.]+\s+M625\.0,/);
  assert.equal(lapTime(59.9999), '1:00.000');
});

test('pagination merges results within a race and pit timing accepts minutes', async t => {
  const driver = { driverId: 'driver', givenName: 'First', familyName: 'Driver' };
  const constructor = { constructorId: 'team', name: 'Team' };
  const race = { season: '1999', round: '1', raceName: 'Test GP', date: '1999-01-01',
    Circuit: { circuitId: 'test', circuitName: 'Test Circuit', Location: { locality: 'City', country: 'Country' } } };
  const result = rank => ({ Driver: { ...driver, driverId: `d${rank}` }, Constructor: constructor, number: String(rank), position: String(rank), points: '1' });
  t.mock.method(globalThis, 'fetch', async raw => {
    const url = new URL(raw);
    const offset = Number(url.searchParams.get('offset'));
    if (url.pathname.includes('standings')) return Response.json({ MRData: { StandingsTable: { StandingsLists: [] } } });
    if (url.pathname.includes('pitstops')) return Response.json({ MRData: { limit: '100', total: '1', RaceTable: { Races: [
      { ...race, PitStops: [{ driverId: 'd1', lap: '17', duration: '1:02.500' }] }
    ] } } });
    const results = url.pathname.includes('results');
    return Response.json({ MRData: { limit: '1', total: results ? '2' : '1', RaceTable: {
      Races: [results ? { ...race, Results: [result(offset + 1)] } : race]
    } } });
  });
  const normalized = await season(1999);
  assert.deepEqual(normalized.races[0].results.map(row => row.id), ['d1', 'd2']);
  const pits = await legacyPits(2012, normalized.races[0]);
  assert.deepEqual(pits, [{ number: 1, lap: 17, lane: 62.5, stop: null }]);
});
