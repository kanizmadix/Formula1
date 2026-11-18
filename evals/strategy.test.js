import test from 'node:test';
import assert from 'node:assert/strict';
import { strategyComparison, strategyView } from '../web/strategy.js';

const drivers = [{ id: 'one', number: 1, code: 'ONE' }, { id: 'two', number: 2, code: 'TWO' }];
const timing = { sessionKey: 42, missing: [], laps: [
  { number: 1, lap: 1, seconds: 92 },
  { number: 2, lap: 1, seconds: 93.5 },
  { number: 1, lap: 2, seconds: 88 },
  { number: 2, lap: 3, seconds: 100 },
  { number: 3, lap: 5, seconds: 40 }
], stints: [
  { number: 1, first: 1, last: 4, compound: 'HARD' },
  { number: 2, first: 1, last: 3, compound: 'MEDIUM' },
  { number: 2, first: 3, last: 2, compound: 'SOFT' }
], pits: [
  { number: 2, lap: 3, lane: 22.104, stop: 2.2 },
  { number: 3, lap: 2, lane: 21, stop: 2.1 }
] };
const flags = [
  { lap_number: null, category: 'Flag', flag: 'RED', message: 'RED FLAG' },
  { lap_number: 2, category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' },
  { lap_number: 1, category: 'Flag', flag: 'YELLOW', message: 'YELLOW IN SECTOR 1' }
];

test('strategy timeline joins only selected drivers and calculates differences only for shared laps', () => {
  const result = strategyComparison(drivers, timing, flags);
  assert.deepEqual(result.laps, [1, 2, 3, 4]);
  assert.deepEqual(result.delta, [-1.5, null, null, null]);
  assert.equal(result.rows[1].pits[0].stop, 2.2);
  assert.equal(result.rows[1].stints.length, 1);
  assert.equal(result.flags.length, 2);
  assert.deepEqual(strategyComparison([drivers[1]], timing).delta, []);
});

test('strategy view identifies timing metrics, flags without lap numbers, and archive failures', () => {
  const html = strategyView({ data: timing }, { data: { control: flags, weather: [], missing: ['weather'] } }, drivers);
  assert.match(html, /Race Strategy Lab/);
  assert.match(html, /22\.104/);
  assert.match(html, /2\.200/);
  assert.match(html, /RED FLAG/);
  assert.match(html, /-1\.500 s/);
  assert.match(html, /Unavailable from the archive: weather/);
});
