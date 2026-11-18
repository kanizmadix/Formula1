import assert from 'node:assert/strict';
import test from 'node:test';
import { replayFrames, replayStep, replaySummary } from '../web/replay.js';
import { strategyComparison } from '../web/strategy.js';
import { icon } from '../web/ui.js';

test('replay traverses the full Grand Prix and matches exact lap records', () => {
  const drivers = [{ number: 1, code: 'A', name: 'Driver A' }, { number: 2, code: 'B', name: 'Driver B' }];
  const timing = {
    laps: [{ number: 1, lap: 1, seconds: 91 }, { number: 2, lap: 1, seconds: 92 }],
    stints: [
      { number: 1, first: 1, last: 2, compound: 'SOFT' },
      { number: 1, first: 2, last: 3, compound: 'HARD' }
    ],
    pits: [{ number: 1, lap: 2, lane: 21.3, stop: null }]
  };
  const flags = [
    { lap_number: 2, category: 'SafetyCar', message: 'VSC DEPLOYED' },
    { lap_number: null, flag: 'RED', message: 'RED FLAG' }
  ];
  const frames = replayFrames(strategyComparison(drivers, timing, flags, 4), true);
  assert.equal(frames.length, 4);
  assert.equal(frames[0].difference, -1);
  assert.equal(frames[0].drivers[0].tyre, 'SOFT');
  assert.equal(frames[1].drivers[0].tyre, 'HARD');
  assert.equal(frames[1].difference, null);
  assert.deepEqual(frames[1].flags, ['VSC DEPLOYED']);
  assert.equal(frames[1].drivers[0].pitted[0].lane, 21.3);
  assert.equal(frames[2].drivers[0].pitted.length, 0);
  assert.deepEqual(frames[3].flags, []);
  assert.equal(frames[3].drivers[0].time, null);
  assert.equal(frames[3].drivers[0].tyre, null);
});

test('replay transport pauses when seeking, stops at the finish, and restarts from lap one', () => {
  const action = (state, type, lap) => replayStep(state, { type, lap }, 3);
  const playing = action({ lap: 1, playing: false }, 'toggle');
  assert.deepEqual(playing, { lap: 1, playing: true });
  const second = action(playing, 'tick');
  assert.deepEqual(second, { lap: 2, playing: true });
  assert.deepEqual(action(second, 'pause'), { lap: 2, playing: false });
  assert.deepEqual(action(second, 'seek', -1), { lap: 1, playing: false });
  const finish = action(second, 'tick');
  assert.deepEqual(finish, { lap: 3, playing: false });
  assert.deepEqual(action(finish, 'tick'), finish);
  assert.deepEqual(action(finish, 'toggle'), playing);
  assert.deepEqual(replayStep(finish, { type: 'sync' }, 1), { lap: 1, playing: false });
});

test('replay summary escapes archived text and labels missing timing, tyres and flags', () => {
  const frame = {
    lap: 2, difference: null, flags: ['<unsafe>'], raceControlAvailable: true,
    drivers: [{ code: '<A>', name: 'A" B', time: null, tyre: null, pitted: [{ lane: null, stop: null }] }]
  };
  const html = replaySummary(frame);
  assert.doesNotMatch(html, /<unsafe>|<A>/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /Pace unavailable/);
  assert.match(html, /Tyre unavailable/);
  assert.match(html, /Pit duration unavailable/);
  assert.match(replaySummary({ ...frame, flags: [], raceControlAvailable: false }), /Race control data unavailable/);
  assert.match(replaySummary({ ...frame, flags: [], raceControlAvailable: null }), /Loading race control/);
});

test('motorsport glyphs are distinct, original vector shapes with decorative semantics', () => {
  const shapes = ['tyre', 'pit', 'safety', 'telemetry', 'qualifying', 'weather'].map(icon);
  assert.equal(new Set(shapes).size, shapes.length);
  for (const shape of shapes) assert.match(shape, /aria-hidden="true".*<path d="M/);
});
