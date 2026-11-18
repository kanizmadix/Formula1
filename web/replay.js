import { decimals, e, icon, lapTime, palette } from './ui.js';

const interval = 800;

export function replayFrames({ laps, rows, delta, flags }, raceControlAvailable) {
  return laps.map((lap, index) => ({
    lap,
    difference: delta[index] ?? null,
    flags: flags.filter(flag => flag.lap_number === lap).map(flag => flag.message || flag.category || flag.flag).filter(Boolean),
    raceControlAvailable,
    drivers: rows.map(row => ({
      code: row.code,
      name: row.name,
      time: row.laps.get(lap) ?? null,
      tyre: row.stints.findLast(stint => stint.first <= lap && stint.last >= lap)?.compound ?? null,
      pitted: row.pits.filter(pit => pit.lap === lap)
    }))
  }));
}

export function replayStep(state, action, total) {
  const count = Math.max(1, total);
  const limit = value => Math.max(1, Math.min(count, Number.isInteger(value) ? value : 1));
  const current = limit(state.lap);
  switch (action.type) {
    case 'toggle':
      return state.playing || count === 1 ? { lap: current, playing: false }
        : { lap: current === count ? 1 : current, playing: true };
    case 'tick': {
      const lap = state.playing ? limit(current + 1) : current;
      return { lap, playing: Boolean(state.playing && lap < count) };
    }
    case 'seek':
      return { lap: limit(action.lap), playing: false };
    case 'pause':
      return { lap: current, playing: false };
    default:
      return { lap: current, playing: Boolean(state.playing && current < count) };
  }
}

export function replayControls(total) {
  return `<div class="replay-player" role="group" aria-label="Race replay controls">
    <div class="replay-transport">
      <button id="replay-play" type="button" class="button" data-replay-action="toggle" aria-label="Play replay"${total < 2 ? ' disabled' : ''}>${icon('play')}<span>Play</span></button>
      <button id="replay-prev" type="button" class="secondary replay-step" data-replay-action="previous" aria-label="Previous lap" disabled>${icon('previous')}</button>
      <button id="replay-next" type="button" class="secondary replay-step" data-replay-action="next" aria-label="Next lap"${total < 2 ? ' disabled' : ''}>${icon('next')}</button>
    </div>
    <div class="replay-scrubber">
      <label for="replay-lap">Replay lap</label>
      <input id="replay-lap" type="range" min="1" max="${total}" value="1"${total < 2 ? ' disabled' : ''}>
      <span class="replay-position" aria-hidden="true" data-replay-position>1 / ${total}</span>
    </div>
  </div>`;
}

const readableTyre = value => value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : '';
const pitDuration = pit => [
  Number.isFinite(pit.lane) && `${decimals(pit.lane, 3)} s lane`,
  Number.isFinite(pit.stop) && `${decimals(pit.stop, 3)} s stationary`
].filter(Boolean).join(' · ');

export function replaySummary(frame) {
  const { lap, flags, difference, drivers, raceControlAvailable } = frame;
  const delta = difference == null ? '' : `<div class="replay-delta"><span>${e(drivers[0].code)} − ${e(drivers[1].code)}</span><strong>${difference > 0 ? '+' : ''}${decimals(difference, 3)} s</strong></div>`;
  return `<h3>Lap ${lap} replay</h3>
    <div class="replay-drivers">${drivers.map((row, i) => `<div class="replay-driver" style="--driver-accent:${palette[i]}">
      <div class="replay-driver-line"><strong title="${e(row.name)}">${e(row.code)}</strong>
        <span>${row.time == null ? 'Pace unavailable' : lapTime(row.time)}</span></div>
      <div class="replay-detail">${icon('tyre')} ${e(readableTyre(row.tyre) || 'Tyre unavailable')}${row.pitted.length ? ` <span class="replay-pit">${icon('pit')} Pit visit</span>` : ''}</div>
      ${row.pitted.map(pit => `<p class="subtle">${pitDuration(pit) || 'Pit duration unavailable'}</p>`).join('')}
    </div>`).join('')}${delta}</div>
    <div class="replay-flags">${icon('safety')}<div>${flags.length ? flags.map(flag => `<p>${e(flag)}</p>`).join('')
      : `<p>${raceControlAvailable ? 'No lap-tagged race control event' : 'Race control data unavailable'}.</p>`}</div></div>`;
}

export function mountReplay(root, state) {
  const frames = JSON.parse(root.dataset.replayFrames);
  const total = frames.length;
  const slider = root.querySelector('#replay-lap');
  const play = root.querySelector('#replay-play');
  const previous = root.querySelector('#replay-prev');
  const next = root.querySelector('#replay-next');
  const position = root.querySelector('[data-replay-position]');
  const summary = root.querySelector('[data-replay-summary]');
  const markers = Array.from(root.querySelectorAll('[data-replay-lap]'));
  const listeners = new AbortController();
  const { signal } = listeners;
  let timer;
  let active = [];

  function paint() {
    const { lap, playing } = state;
    const label = playing ? 'Pause' : (lap === total && total > 1 ? 'Replay' : 'Play');
    const action = label === 'Replay' ? 'Restart replay' : `${label} replay`;
    if (play.getAttribute('aria-label') !== action) {
      play.setAttribute('aria-label', action);
      play.innerHTML = `${icon(playing ? 'pause' : 'play')}<span>${label}</span>`;
    }
    slider.value = lap;
    slider.setAttribute('aria-valuetext', `Lap ${lap} of ${total}`);
    position.textContent = `${lap} / ${total}`;
    // Keep the focused transport button operable for keyboard users at either boundary.
    previous.setAttribute('aria-disabled', String(lap === 1));
    next.setAttribute('aria-disabled', String(lap === total));
    previous.disabled = false;
    next.disabled = false;
    summary.innerHTML = replaySummary(frames[lap - 1]);
    for (const mark of active) mark.classList.remove('is-current');
    active = markers.filter(mark => Number(mark.dataset.replayLap) === lap);
    for (const mark of active) mark.classList.add('is-current');
  }

  function dispatch(action) {
    const prior = state.lap;
    Object.assign(state, replayStep(state, action, total));
    clearTimeout(timer);
    paint();
    if (state.playing) timer = setTimeout(() => dispatch({ type: 'tick' }), interval);
    if (action.type === 'seek' && action.announce && prior !== state.lap) {
      root.querySelector('[data-replay-announcement]').textContent = `Lap ${state.lap} of ${total}`;
    }
  }

  slider.addEventListener('input', () => dispatch({ type: 'seek', lap: Number(slider.value) }), { signal });
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-replay-action]')?.dataset.replayAction;
    const mark = event.target.closest('[data-replay-lap]');
    if (action === 'toggle') dispatch({ type: 'toggle' });
    if (action === 'previous' && state.lap > 1) dispatch({ type: 'seek', lap: state.lap - 1, announce: true });
    if (action === 'next' && state.lap < total) dispatch({ type: 'seek', lap: state.lap + 1, announce: true });
    if (mark) dispatch({ type: 'seek', lap: Number(mark.dataset.replayLap), announce: true });
  }, { signal });
  root.addEventListener('keydown', event => {
    const mark = event.target.closest('[data-replay-lap][data-chart-hit]');
    if (!mark || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    dispatch({ type: 'seek', lap: Number(mark.dataset.replayLap), announce: true });
  }, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.playing) dispatch({ type: 'pause' });
  }, { signal });
  dispatch({ type: document.hidden ? 'pause' : 'sync' });

  return () => {
    clearTimeout(timer);
    listeners.abort();
  };
}
