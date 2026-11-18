import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  loadSeasonAnalysis, loadWinlessRecords, makeSeasonAnalysis, seasonAnalysisView, seasonArchiveRecordsView,
  summarizeSeasonAnalysis
} from '../web/season-analysis.js';

const driver = (id, name, teamId, team) => ({ id, name, teamId, team });
const ana = driver('ana', 'Ana Martin', 'red', 'Red Racing');
const beck = driver('beck', 'Beck Jones', 'blue', 'Blue Racing');
const redBeck = { ...beck, teamId: ana.teamId, team: ana.team };
const result = (entrant, data = {}) => ({
  ...entrant, classification: '2', rank: 2, laps: 60, status: 'Finished', ...data
});
const race = (round, date, circuitId, circuit, results = []) => ({
  round, date, circuitId, circuit, name: `${circuit} Grand Prix`, results
});
const recorded = (entrant, data) => ({
  ...entrant, started: true, won: false, retirement: null, laps: 0,
  fastestLap: null, medianLap: null, pitCount: 0, pitLane: [], ...data
});
const monza = race(1, '2025-07-01', 'monza', 'Monza', [
  result(ana, { classification: '1', rank: 1, fastest: '1:20.000' }),
  result(redBeck, { fastest: '1:24.000' })
]);
const vegas = race(2, '2025-11-23', 'vegas', 'Las Vegas', [
  result(ana, { fastest: '', classification: 'R', rank: 5, status: 'Retired' }),
  result(beck, { fastest: '1:40.000', classification: 'R', rank: 7, status: 'Lapped' })
]);
const spa = race(3, '2025-11-25', 'spa', 'Spa', [
  result(beck, { fastest: '1:30.000', classification: 'R', status: 'Engine' }),
  result(ana, { classification: 'W', status: 'Did not start', laps: 0 })
]);
const season = { year: 2025, races: [monza, vegas, spa, race(4, '2025-12-01', 'future', 'Future')] };
const archive = {
  version: 1, year: 2025, asOf: '2025-11-24T00:00:00Z',
  races: [
    { ...monza, drivers: [
      recorded(ana, { won: true, laps: 60, fastestLap: 80000, medianLap: 82000, pitCount: 2, pitLane: [24000, 20000] }),
      recorded(redBeck, { laps: 59, fastestLap: 84000, medianLap: 88000, pitCount: 2, pitLane: [20000] })
    ] },
    { ...vegas, date: '2025-11-22', drivers: [
      recorded(ana, { laps: 12, fastestLap: 101000, medianLap: 102000, retirement: 'Brakes', pitCount: 1, pitLane: [40000] }),
      recorded(beck, { laps: 35, fastestLap: 100000, medianLap: 102000 })
    ] }
  ]
};

test('combined driver, team and circuit filters use race-day teams and retain the full-field benchmark', () => {
  const analysis = makeSeasonAnalysis(season, archive);
  const monzaBeck = summarizeSeasonAnalysis(analysis, { driver: 'beck', team: 'red', circuit: 'monza' });
  assert.deepEqual(monzaBeck.coverage.map(race => race.round), [1]);
  assert.equal(monzaBeck.drivers[0].laps, 59);
  assert.equal(monzaBeck.drivers[0].pitCount, 2);
  assert.equal(monzaBeck.drivers[0].pitSamples, 1);
  assert.equal(monzaBeck.teams[0].id, 'red');
  assert.ok(Math.abs(monzaBeck.drivers[0].medianPace - 10) < 1e-10);
  assert.ok(Math.abs(monzaBeck.drivers[0].fastestPace - 5) < 1e-10);
  assert.equal(summarizeSeasonAnalysis(analysis, { driver: 'beck', team: 'red', circuit: 'vegas' }).coverage.length, 0);

  const html = seasonAnalysisView(analysis, { driver: 'beck', team: 'red', circuit: 'monza' });
  assert.match(html, /data-select="driver"/);
  assert.match(html, /data-select="team"/);
  assert.match(html, /data-select="circuit"/);
  assert.match(html, /value="monza" selected/);
  assert.match(html, /Quickest lap/);
  assert.match(html, /20\.000 s/);
});

test('lap gap medians weight driver-races equally and late-night results join on round, circuit and date', () => {
  const analysis = makeSeasonAnalysis(season, archive);
  const all = summarizeSeasonAnalysis(analysis);
  const anaTiming = all.drivers.find(row => row.id === 'ana');
  assert.equal(all.coverage.length, 3);
  assert.equal(all.coverage[1].laps, 47);
  assert.equal(all.coverage[1].classificationBestLaps, 1);
  assert.equal(anaTiming.laps, 72);
  assert.equal(anaTiming.lapSamples, 2);
  assert.ok(Math.abs(anaTiming.medianPace - 2.25) < 1e-10);
  assert.equal(anaTiming.medianPitLane, 24000);

  const wrongCircuit = { ...archive, races: [archive.races[0], { ...archive.races[1], circuitId: 'spa' }] };
  assert.equal(summarizeSeasonAnalysis(makeSeasonAnalysis(season, wrongCircuit)).coverage[1].laps, 0);
});

test('partial timing preserves official fastest laps and reports missing coverage explicitly', () => {
  const analysis = makeSeasonAnalysis(season, archive);
  const missing = summarizeSeasonAnalysis(analysis, { circuit: 'spa' });
  assert.deepEqual(missing.coverage.map(race => [race.laps, race.bestLaps, race.pitSamples]), [[0, 1, 0]]);
  assert.equal(missing.drivers[0].lapSamples, 0);
  assert.equal(missing.drivers[0].fastestSamples, 1);
  assert.match(seasonAnalysisView(analysis, { circuit: 'spa' }), /1 with results, 0 with recorded laps, 1 with fastest laps and 0 with pit-lane durations/);
  assert.match(seasonAnalysisView(makeSeasonAnalysis(season)), /packaged timing archive is unavailable/);
  assert.match(seasonAnalysisView(analysis, { circuit: 'future' }), /No results match this selection/);
  assert.equal(summarizeSeasonAnalysis(makeSeasonAnalysis(2025, archive)).coverage.length, 2);
});

test('retirement reasons distinguish race outcomes and winless season counts exclude winners outside the filter', () => {
  const analysis = makeSeasonAnalysis(season, archive);
  assert.deepEqual(summarizeSeasonAnalysis(analysis).retirements, [['Brakes', 1], ['Engine', 1]]);
  assert.deepEqual(summarizeSeasonAnalysis(makeSeasonAnalysis(season)).retirements, [['Engine', 1], ['Reason not specified', 1]]);
  assert.deepEqual(summarizeSeasonAnalysis(analysis, { circuit: 'vegas' }).winless,
    [{ id: 'beck', name: 'Beck Jones', starts: 1 }]);
  const html = seasonArchiveRecordsView(analysis, { winless: {
    firstRace: '1950-05-13', lastRace: '2025-11-24', rows: [{ name: 'Archive <driver>', starts: 242 }]
  } });
  assert.match(html, /Most career starts without a win/);
  assert.match(html, /Archive &lt;driver&gt;/);
  assert.match(html, /2 of 2 recorded retirements/);
});

test('browser loaders request one local file each and preserve results when an archive is unavailable', async t => {
  const calls = [];
  const year = 2030;
  const winless = { version: 1, lastRace: '2025-11-24', rows: [{ name: 'Beck Jones', starts: 242 }] };
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    if (url.endsWith('winless.json')) return Response.json(winless);
    if (url.endsWith('2025.json')) return Response.json(archive);
    return new Response('', { status: 404 });
  });
  const [loaded, missing, records] = await Promise.all([
    loadSeasonAnalysis(season), loadSeasonAnalysis({ ...season, year }), loadWinlessRecords()
  ]);
  assert.equal(loaded.archiveAvailable, true);
  assert.equal(missing.archiveAvailable, false);
  assert.equal(summarizeSeasonAnalysis(missing).coverage[0].bestLaps, 2);
  assert.deepEqual(records, winless);
  assert.deepEqual(calls.sort(), [
    './data/season-analysis/2025.json', './data/season-analysis/2030.json', './data/season-analysis/winless.json'
  ]);
});

test('archive build counts shared winners, deduplicates career starts and reuses a matching dump date', async () => {
  const exec = promisify(execFile);
  const temp = await mkdtemp(join(tmpdir(), 'f1-archive-eval-'));
  const dump = join(temp, 'sample.zip');
  const output = join(temp, 'output');
  const asOf = '2018-02-01T00:00:00Z';
  const script = fileURLToPath(new URL('../scripts/season-archive.mjs', import.meta.url));
  const tables = {
    season: 'id,year\n1,1951\n2,2018',
    circuit: 'id,reference,name\n1,test,Test Circuit',
    driver: 'id,reference,forename,surname\n1,first,Ada,First\n2,shared,Bea,Shared\n3,winless,Cal,Winless',
    round: 'id,season_id,number,name,date,circuit_id,is_cancelled\n1,1,1,Shared GP,1951-07-01,1,f\n2,2,1,New GP,2018-01-03,1,f',
    session: 'id,round_id,type,is_cancelled\n1,1,R,f\n2,2,R,f\n3,2,SR,f',
    teamdriver: 'id,driver_id,team_id\n1,1,1\n2,2,1\n3,3,1',
    team: 'id,reference,name\n1,red,Red Racing',
    roundentry: 'id,team_driver_id\n1,1\n2,2\n3,3\n4,3\n5,3',
    sessionentry: 'id,session_id,round_entry_id,status,position,laps_completed,detail\n' +
      '1,1,1,0,1,50,Finished\n2,1,2,0,1,50,Finished\n3,1,3,11,3,24,Engine\n4,1,4,1,4,32,Lapped\n' +
      '5,2,1,0,1,60,Finished\n6,2,3,1,2,56,Lapped\n7,2,5,30,3,0,Did not start\n8,3,3,0,1,12,Finished',
    lap: 'session_entry_id,number,is_deleted,time\n5,1,f,00:01:21.100\n5,2,t,00:01:00\n6,1,f,00:01:22.001\n8,1,f,00:01:10',
    pitstop: 'session_entry_id,duration\n5,00:00:23.29\n6,\n8,00:00:20'
  };
  try {
    const filenames = await Promise.all(Object.entries(tables).map(async ([table, csv]) => {
      const name = `formula_one_${table}.csv`;
      await writeFile(join(temp, name), `${csv}\n`);
      return name;
    }));
    await exec('zip', ['-q', dump, ...filenames], { cwd: temp });
    await exec(process.execPath, [script, '--dump', dump, '--as-of', asOf, '--output', output]);
    const read = async name => JSON.parse(await readFile(join(output, name), 'utf8'));
    assert.deepEqual((await read('winless.json')).rows, [{ id: 'winless', name: 'Cal Winless', starts: 2 }]);
    const [race] = (await read('2018.json')).races;
    assert.equal(race.drivers.find(row => row.id === 'first').medianLap, 81100);
    assert.deepEqual(race.drivers.find(row => row.id === 'first').pitLane, [23290]);
    assert.equal(race.drivers.find(row => row.id === 'winless').pitCount, 1);
    assert.deepEqual(race.drivers.find(row => row.id === 'winless').pitLane, []);

    const mock = join(temp, 'mock.mjs');
    await writeFile(mock, `globalThis.fetch = async url => {
      if (url !== 'https://api.jolpi.ca/data/dumps/download/') throw new Error('Unexpected ZIP download');
      return Response.json({ delayed_dumps: { csv: { uploaded_at: ${JSON.stringify(asOf)}, file_size: 2, file_hash: 'a'.repeat(64) } } });
    };`);
    const { stdout } = await exec(process.execPath, ['--import', mock, script, '--output', output]);
    assert.match(stdout, /already matches the Jolpica dump/);
    await rm(join(output, '2018.json'));
    await assert.rejects(exec(process.execPath, ['--import', mock, script, '--output', output]), /Unexpected ZIP download/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
