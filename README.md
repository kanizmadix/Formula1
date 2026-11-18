# Race Lab · Formula 1 Analytics

Race Lab brings my final-year Formula 1 data science project to the web as an interactive racing analytics dashboard.

[Open Race Lab on GitHub Pages](https://kanizmadix.github.io/Formula1/)

## Explore the app

- **Race Strategy Lab** compares two drivers’ lap pace, matched-lap deltas, tyre stints, and pit visits. Safety-car and red-flag messages and track weather provide context. [Try the 2025 Abu Dhabi comparison](https://kanizmadix.github.io/Formula1/#race/2025/24/strategy?a=max_verstappen&b=piastri)
- **Lap telemetry and qualifying** compare speed, throttle, brake and gear traces for independently selected laps. Qualifying shows Q1–Q3 times alongside grid and finish positions.
- **Season data and records** compare lap pace and pit-lane durations by driver, team and circuit. Records cover wins, winner ages, winless career starts and reported retirement reasons. Coverage and sample counts appear next to the data.
- **Forecast Lab** estimates season-end points from a historical cutoff or the latest completed round. A rolling 2021–2025 backtest compares recent trend, recent average and hold-points methods. Historical error ranges compare forecasts at the same horizon.
- **Search and sharing** find drivers, circuits, and weekends. Comparison links preserve the driver pair and selected telemetry laps. Chart CSVs export the raw plotted values, with blank cells for missing samples.

The [original college project](https://github.com/kanizmadix/Formula1/tree/c541a38) is available in Git history.

## Data and hosting

| Public source | Coverage |
| --- | --- |
| [Jolpica F1 API](https://github.com/jolpica/jolpica-f1) | Calendars, results, qualifying, standings, winner records, and older per-race timing. Constructor standings begin in 1958, older lap times in 1996 and older pit data in 2011, subject to coverage. |
| [Jolpica F1 data dumps](https://github.com/jolpica/jolpica-f1/blob/main/docs/database_dumps.md) | Delayed career start records and packaged Grand Prix timing aggregates from 2018. The archive publishes on its own schedule and can trail the current standings. |
| [OpenF1](https://openf1.org/docs/) | Free archived race telemetry, weather, race control, tyres and timing from 2023. Live access requires a paid subscription. Pit-lane transit and stationary durations are separate measurements. |
| [OpenStreetMap](https://www.openstreetmap.org/) | Circuit location links from Jolpica coordinates. |

GitHub Actions refreshes championship snapshots and checks the delayed timing archive four times daily. The build publishes to GitHub Pages. The last successful version stays online if a refresh fails. Race comparisons make bounded public API requests on demand. The dashboard requires no API key or database.

Strategy comparisons use matching race lap numbers. The pace chart excludes OpenF1 pit-out laps, and telemetry aligns traces by seconds from each driver's own approximate lap start. Season-wide pace uses each driver's median recorded lap relative to the fastest available lap in the same Grand Prix. It includes timed pit and slow laps. Historical forecast errors describe past performance and depend on the archived classifications and calendar revisions.

## Local development and evals

Use Node.js 22 or newer. Playwright is a development dependency.

```sh
npm ci
npm run dev
npm test
npx playwright install chromium
npm run evals:browser
```

- `npm test` runs the core and feature evals. `npm run evals:browser` runs the local Chromium suite with controlled provider responses.
- `RACE_LAB_LIVE_URL=https://kanizmadix.github.io/Formula1/ npm run evals:browser` tests the deployed site against real API data.
- `npm run build` builds the Pages output into `dist/`.
- `npm run refresh -- --publish` refreshes results snapshots. `npm run refresh:archive` rebuilds the delayed timing archive and requires `unzip`. Restart the dev server to serve a new build.

Race Lab is an independent educational project. The hero depicts a fictional car.
