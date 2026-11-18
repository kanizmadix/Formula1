import { test, expect } from '@playwright/test';

const start = '2025-12-07T13:00:00.000Z';
const race = './#race/2025/24';
const strategyPair = `${race}/strategy?a=max_verstappen&b=piastri`;
const sessionKey = 9839;

test.beforeEach(async ({ page }) => {
  // Controlled provider responses make alignment and the expected delta reproducible in CI.
  await page.route('https://api.openf1.org/v1/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split('/').at(-1);
    const data = {
      sessions: [{ session_key: sessionKey, date_start: start, date_end: '2025-12-07T15:00:00Z' }],
      laps: [1, 2, 3].flatMap(lap => [[1, 90], [81, 91], [4, 92]].map(([driver_number, seconds]) => ({
        driver_number, lap_number: lap, lap_duration: seconds - lap / 10, is_pit_out_lap: driver_number === 81 && lap === 3,
        date_start: new Date(Date.parse(start) + lap * 90_000).toISOString()
      }))),
      stints: [1, 81, 4].map((driver_number, i) => ({
        driver_number, lap_start: 1, lap_end: 3, compound: ['SOFT', 'MEDIUM', 'HARD'][i], tyre_age_at_start: 0
      })),
      pit: [1, 81, 4].map((driver_number, i) => ({ driver_number, lap_number: 2, lane_duration: 21 + i, stop_duration: 2.15 })),
      weather: [{ date: start, track_temperature: 36.2, air_temperature: 26.1, humidity: 57, rainfall: false }],
      race_control: [{ date: start, lap_number: 2, category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' }],
      car_data: endpoint === 'car_data' ? [0, 250, 500].map((elapsed, i) => ({
        date: new Date(Date.parse(url.searchParams.get('date>') ?? start) + elapsed).toISOString(),
        session_key: sessionKey, driver_number: Number(url.searchParams.get('driver_number')),
        speed: 270 + i, throttle: 95 + i, brake: i ? 0 : 100, n_gear: 7
      })) : []
    };
    const response = data[endpoint];
    await route.fulfill({ status: response ? 200 : 404, json: response ?? [], headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('https://api.jolpi.ca/ergast/f1/2025/24/qualifying/**', route => route.fulfill({ json: {
    MRData: { total: '2', RaceTable: { Races: [{
      season: '2025', round: '24', QualifyingResults: [
        { position: '1', number: '1', Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' }, Q3: '1:22.207' },
        { position: '3', number: '81', Driver: { driverId: 'piastri', givenName: 'Oscar', familyName: 'Piastri' }, Q3: '1:22.437' }
      ]
    }] } }
  } }));
});

test('strategy comparison swaps drivers, preserves shared links, and exports raw time values', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(strategyPair);
  await expect(page.getByRole('heading', { name: 'Race Strategy Lab', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Matched-lap pace delta' })).toBeVisible();
  await expect(page.getByText(/VER minus PIA · 2 shared timed laps · median -1.000 s/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Race control events' })).toContainText('SAFETY CAR DEPLOYED');
  await expect(page.getByRole('table', { name: 'Track weather samples' })).toContainText('36.2');
  const stints = page.getByRole('table', { name: 'Compared tyre stints' });
  await expect(stints).toContainText('PIA');
  await page.getByLabel('Compare with', { exact: true }).selectOption('norris');
  await expect(stints).toContainText('NOR');
  await expect(stints).not.toContainText('PIA');
  await expect(page.getByText(/VER minus NOR · 3 shared timed laps · median -2.000 s/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download chart CSV for Race strategy lap pace' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('race-strategy-lap-pace.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  expect(csv).toContain('"Lap 1","89.9","91.9"');

  await page.getByRole('button', { name: 'Copy comparison link' }).click();
  await expect(page.getByText('Comparison link copied.')).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(shared);
  await page.reload();
  await expect(page.getByLabel('Compare with', { exact: true })).toHaveValue('norris');
  await expect(page.getByRole('table', { name: 'Compared pit windows' })).toContainText('NOR');
});

test('driver and circuit search links open the season and race views', async ({ page }) => {
  await page.goto('./#search/2025');
  const search = page.getByLabel('Driver or circuit');
  await search.fill('piastri');
  await expect(page.getByRole('link', { name: 'Standings for Oscar Piastri' })).toBeVisible();
  await page.getByRole('link', { name: 'Standings for Oscar Piastri' }).click();
  await expect(page.getByLabel('First', { exact: true })).toHaveValue('piastri');
  await page.goto('./#search/2025');
  await page.getByLabel('Driver or circuit').fill('Yas Marina');
  await page.getByRole('link', { name: /Abu Dhabi Grand Prix at Yas Marina/ }).click();
  await expect(page.getByRole('heading', { name: 'Weekend schedule' })).toBeVisible();
});

test('mobile strategy route has no horizontal page overflow and handles one driver', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(strategyPair);
  await expect(page.getByRole('heading', { name: 'Race Strategy Lab', exact: true })).toBeVisible();
  await page.getByLabel('Compare with', { exact: true }).selectOption('');
  await expect(page.getByRole('heading', { name: 'Matched-lap pace delta' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Compare with', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('telemetry switches laps on the same driver pair and qualifying shows position movement', async ({ page }) => {
  await page.goto(`${race}/telemetry?a=max_verstappen&b=piastri&lapA=2&lapB=2`);
  await expect(page.getByRole('heading', { name: 'Lap telemetry', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Speed by elapsed lap time' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV · Oscar Piastri · Lap 2' })).toBeVisible();
  await page.getByLabel('VER lap', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Download CSV · Max Verstappen · Lap 1' })).toBeVisible();
  await expect(page).toHaveURL(/lapA=1/);
  await page.getByRole('button', { name: 'Qualifying', exact: true }).click();
  const table = page.getByRole('table', { name: 'Qualifying results and race position changes' });
  const piastri = table.getByRole('row', { name: /Oscar Piastri/ });
  await expect(piastri).toContainText('1:22.437');
  await expect(piastri.getByRole('cell', { name: '+1', exact: true }).first()).toBeVisible();
});

test('forecast backtest displays three methods and switches to constructor validation', async ({ page }) => {
  await page.goto('./#forecast/2026');
  const scores = page.getByRole('table', { name: 'Season-end forecast error' });
  await expect(scores.getByRole('row')).toHaveCount(4);
  await expect(scores).toContainText('2,085');
  await expect(scores).toContainText('Hold points');
  await page.getByRole('button', { name: 'Constructors', exact: true }).click();
  await expect(scores).toContainText('990');
  await page.getByText('Historical uncertainty by weekends remaining', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Historical trend forecast errors' })).toBeVisible();
});


test('public archive filters season timing and supplies expanded records', async ({ page }) => {
  await page.goto('./#analysis/2025');
  const drivers = page.getByRole('table', { name: 'Drivers season timing comparison' });
  await expect(drivers).toBeVisible();
  await page.getByLabel('Driver', { exact: true }).selectOption('norris');
  await page.getByLabel('Team', { exact: true }).selectOption('mclaren');
  await page.getByLabel('Circuit', { exact: true }).selectOption('yas_marina');
  await expect(drivers.getByRole('row')).toHaveCount(2);
  await expect(drivers).toContainText('Lando Norris');
  await expect(drivers).toContainText('21.365 s');
  await expect(drivers).toContainText('58');
  await expect(page.getByText(/Race selection: 1 with results/)).toBeVisible();
  await page.goto('./#records/2025');
  await expect(page.getByRole('table', { name: 'Most career starts without a win' })).toContainText('Nico Hülkenberg');
  await expect(page.getByRole('table', { name: 'Reported retirement reasons' })).toBeVisible();
});

test('Strategy Lab replay keeps the two pace charts and tyre timeline on the selected lap', async ({ page }) => {
  await page.clock.install();
  await page.goto(strategyPair);
  const scrubber = page.getByRole('slider', { name: 'Replay lap' });
  const summary = page.locator('[data-replay-summary]');
  await expect(scrubber).toHaveAttribute('aria-valuetext', 'Lap 1 of 58');
  await expect(summary).toContainText('Lap 1 replay');
  await page.getByRole('button', { name: 'Play replay' }).click();
  await page.clock.runFor(810);
  await expect(scrubber).toHaveValue('2');
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await page.clock.runFor(900);
  await expect(scrubber).toHaveValue('2');
  await expect(summary).toContainText('SAFETY CAR DEPLOYED');
  await expect(summary).toContainText('Pit visit');
  await expect(summary).toContainText('21.000 s lane');
  await expect(page.locator('[data-replay-lap="2"].is-current')).toHaveCount(3);

  const pace = page.locator('svg[aria-label="Race strategy lap pace"]');
  await pace.locator('[data-replay-lap="3"]').focus();
  await page.keyboard.press('Enter');
  await expect(scrubber).toHaveValue('3');
  await expect(summary).toContainText('Pace unavailable');

  await scrubber.focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'Restart replay' })).toBeVisible();
  const restartedAt = await page.evaluate(() => {
    document.getElementById('replay-play').click();
    const lap = document.getElementById('replay-lap').value;
    document.querySelector('[data-control="race-tab"][data-value="circuit"]').click();
    return lap;
  });
  expect(restartedAt).toBe('1');
  await expect(page.getByRole('heading', { name: 'Weekend schedule' })).toBeVisible();
  await page.clock.runFor(2000);
  await page.getByRole('button', { name: 'Strategy Lab', exact: true }).click();
  await expect(scrubber).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
});

test('mobile replay keeps large comparison controls within reach while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(strategyPair);
  const dock = page.locator('.replay-dock');
  const scrubber = page.getByRole('slider', { name: 'Replay lap' });
  await expect(scrubber).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.replay-dock').offsetTop + 260));
  await expect.poll(async () => Math.round((await dock.boundingBox()).y)).toBe(0);
  const second = page.getByLabel('Compare with', { exact: true });
  expect((await second.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Next lap' }).click();
  await second.selectOption('norris');
  await expect(scrubber).toHaveValue('2');
  await expect(page.locator('[data-replay-summary]')).toContainText('NOR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('starting lights sequence advances once and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#overview/2025');
  const lights = page.locator('.start-lights');
  const lamps = lights.locator('span');
  await expect(lamps).toHaveCount(5);
  await expect(lights).toHaveAttribute('aria-hidden', 'true');
  const effects = await lamps.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node, '::after');
    return { name: style.animationName, delay: parseFloat(style.animationDelay) };
  }));
  expect(effects.every(effect => effect.name.includes('lamp-on') && effect.name.includes('lamp-out'))).toBe(true);
  expect(effects.map(effect => effect.delay)).toEqual([0.14, 0.36, 0.58, 0.8, 1.02]);
  const sequence = await page.evaluate(() => {
    const animations = document.getAnimations().filter(effect => ['lamp-on', 'lamp-out'].includes(effect.animationName));
    const opacity = time => {
      for (const effect of animations) {
        effect.pause();
        effect.currentTime = time;
      }
      return Array.from(document.querySelectorAll('.start-lights span'), node => getComputedStyle(node, '::after').opacity);
    };
    return [opacity(650), opacity(1200), opacity(1600)];
  });
  expect(sequence).toEqual([['1', '1', '1', '0', '0'], ['1', '1', '1', '1', '1'], ['0', '0', '0', '0', '0']]);
  await page.getByRole('button', { name: 'Constructors', exact: true }).click();
  await expect(lights).not.toHaveClass(/is-starting/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(lamps).toHaveCount(5);
  expect(await lamps.first().evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('none');
  await expect(page.getByRole('heading', { name: 'Race Lab', exact: true })).toBeVisible();
});
