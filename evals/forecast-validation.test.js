import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_VALIDATION_YEARS, evaluateForecasts, forecastValidationView, projectionInterval } from '../web/forecast-validation.js';

const read = async year => JSON.parse(await readFile(new URL(`../data/${year}.json`, import.meta.url), 'utf8'));
const snapshots = await Promise.all(DEFAULT_VALIDATION_YEARS.map(read));

test('bundled seasons compare three methods on the same driver and constructor samples', () => {
  const driver = evaluateForecasts(snapshots);
  const team = evaluateForecasts(snapshots, 'teams');
  for (const evaluation of [driver, team]) {
    assert.deepEqual(evaluation.years, [2021, 2022, 2023, 2024, 2025]);
    assert.deepEqual(evaluation.skipped, []);
    assert.equal(evaluation.cases.length, evaluation.bySeason.reduce((sum, season) => sum + season.sample, 0));
    assert.deepEqual(Object.keys(evaluation.metrics), ['trend', 'recentMean', 'holdPoints']);
    for (const { sample, mae, rmse } of Object.values(evaluation.metrics)) {
      assert.equal(sample, evaluation.cases.length);
      assert.ok(mae > 0 && rmse >= mae);
    }
  }
  assert.ok(driver.cases.length > team.cases.length);
  const max = driver.cases.find(row => row.year === 2023 && row.cutoff === 5 && row.id === 'max_verstappen');
  assert.equal(max.actual, 575);
  assert.equal(max.remaining, 18, 'Miami ran before the Imola cancellation');
  assert.equal(driver.cases.find(row => row.year === 2023 && row.cutoff === 6).remaining, 16);
  assert.ok(driver.cases.every(row => row.cutoff >= 3 && row.remaining > 0));
});

function exampleSeason(lastPoints = 10) {
  const driver = points => ({ id: 'early', teamId: 'team', points });
  const late = points => ({ id: 'late', teamId: 'team', points });
  return {
    year: 2020,
    driverRound: 5,
    teamRound: 5,
    drivers: [{ id: 'early', points: 22 + lastPoints }, { id: 'late', points: 4 }],
    teams: [{ id: 'team', points: 26 + lastPoints }],
    races: [
      { round: 1, date: '2020-07-01', results: [driver(2)] },
      { round: 2, date: '2020-07-08', results: [driver(4)], sprint: [driver(2)] },
      { round: 3, date: '2020-07-15', results: [driver(6)] },
      { round: 4, date: '2020-07-22', results: [driver(8), late(3)] },
      { round: 5, date: '2020-07-29', results: [driver(lastPoints), late(1)] }
    ]
  };
}

const options = { years: [2020], calendars: { 2020: [{ rounds: 6 }, { from: '2020-07-20', rounds: 5 }] } };

test('rolling cutoffs use earlier race and sprint points and the calendar published at the time', () => {
  const base = evaluateForecasts([exampleSeason()], 'drivers', options);
  assert.deepEqual(base.cases.map(({ cutoff, id }) => [cutoff, id]), [[3, 'early'], [4, 'early'], [4, 'late']]);
  const [first, next] = base.cases;
  assert.equal(first.earned, 14);
  assert.equal(first.remaining, 3);
  assert.equal(first.estimates.trend, 28.4);
  assert.equal(first.estimates.recentMean, 28);
  assert.equal(first.estimates.holdPoints, 14);
  assert.equal(next.remaining, 1);
  assert.equal(base.metrics.holdPoints.mae, (18 + 10 + 1) / 3);

  const changed = evaluateForecasts([exampleSeason(100)], 'drivers', options);
  assert.notEqual(changed.cases[0].actual, first.actual);
  assert.deepEqual(changed.cases.map(entry => entry.estimates), base.cases.map(entry => entry.estimates));
  assert.notEqual(changed.metrics.trend.mae, base.metrics.trend.mae);

  const teams = evaluateForecasts([exampleSeason()], 'teams', options);
  assert.equal(teams.cases[1].earned, 25);
  assert.equal(teams.cases[1].actual, 36);
});

test('missing or inconsistent snapshots are skipped while valid seasons remain visible', () => {
  const sprintMissing = structuredClone(snapshots[1]);
  sprintMissing.races.find(race => race.sprint.length).sprint = [];
  const short = structuredClone(snapshots[3]);
  short.races.pop();
  short.driverRound--;
  const badPoints = structuredClone(snapshots[4]);
  badPoints.drivers[0].points += 1;
  const partial = [sprintMissing, snapshots[2], short, badPoints];
  const evaluation = evaluateForecasts(partial);
  assert.deepEqual(evaluation.years, [2023]);
  assert.deepEqual(evaluation.skipped.map(({ year }) => year), [2021, 2022, 2024, 2025]);
  assert.match(evaluation.skipped[1].reason, /sprint classification/);
  assert.match(evaluation.skipped[2].reason, /finale/);
  assert.match(evaluation.skipped[3].reason, /reconcile/);
  assert.equal(evaluateForecasts().metrics.trend.mae, null);

  assert.match(forecastValidationView({ status: 'loading' }), /Loading historical season snapshots/);
  const markup = forecastValidationView({ seasons: partial, status: 'error' });
  assert.match(markup, /driver forecasts across 1 season \(2023\)/);
  assert.match(markup, /Skipped seasons \(4\)/);
  assert.match(markup, /A range requires at least 20 forecasts from at least two seasons/);
});

test('point bands use signed residuals at the exact horizon from strictly earlier seasons', () => {
  const cases = Array.from({ length: 20 }, (_, index) => ({
    year: index < 10 ? 2021 : 2022, remaining: 5, actual: 100 + index, estimates: { trend: 100 }
  }));
  cases.push({ year: 2023, remaining: 5, actual: -1000, estimates: { trend: 100 } });
  cases.push({ year: 2024, remaining: 5, actual: -2000, estimates: { trend: 100 } });
  cases.push({ year: 2022, remaining: 6, actual: 2000, estimates: { trend: 100 } });
  const evaluation = { cases };
  const args = { estimate: 250, remaining: 5, year: 2023 };
  const range = projectionInterval(evaluation, args);
  assert.deepEqual(range.years, [2021, 2022]);
  assert.equal(range.sample, 20);
  assert.equal(range.lower, 251.9);
  assert.equal(range.upper, 267.1);
  assert.equal(projectionInterval(evaluation, { ...args, year: 2022 }), null);
  assert.equal(projectionInterval(evaluation, { ...args, remaining: 6 }), null);
  assert.equal(projectionInterval(evaluation, { ...args, remaining: 0 }), null);
});
