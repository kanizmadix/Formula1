# Race Lab · Formula 1 Analytics

Race Lab is the modern version of my final-year Formula 1 data science project. It brings season standings, race analysis, historic records and points forecasting into one interactive dashboard.

[Open Race Lab on GitHub Pages](https://kanizmadix.github.io/Formula1/)

## Explore the app

- **Overview and standings** show official driver and constructor totals, a race-by-race points comparison, and CSV downloads. The chart sums points from Grands Prix and sprints. Official standings also reflect championship adjustments and tie-breaking.
- **Calendar and race analysis** cover scheduled sessions, circuit locations, race and sprint classifications, lap pace, pit-lane and stationary pit durations where available, and tyre stints. Older lap times start in 1996 and older pit timings in 2011, subject to provider coverage.
- **Records** uses archived race winners to calculate win totals and youngest and oldest winners. Shared wins count per winning entry.
- **Forecast lab** extends the original linear regression experiment. Select the latest round or a historical cutoff and compare regression error with a recent-average baseline. The projection fits cumulative race and sprint points over up to six recent weekends, then adds its estimated scoring pace for the remaining calendar. The rolling evaluation trains each forecast only on earlier rounds.

The original Streamlit entry point, analysis scripts, and college-project datasets are part of the repository's archive. The current dashboard gets its figures from the public providers below.

## Data and hosting

| Provider | Coverage used in Race Lab |
| --- | --- |
| [Jolpica F1](https://github.com/jolpica/jolpica-f1) | Calendars, classifications, standings and winning entries from 1950 onward. Constructor standings start in 1958. Also provides historic laps and pit timing. |
| [OpenF1](https://openf1.org/docs/) | Free post-session lap times, pit timing and tyres from 2023 onward. Stationary stop durations have their own availability and never mix with in-lane times. Live coverage requires a paid OpenF1 subscription. |
| [OpenStreetMap](https://www.openstreetmap.org/) | Circuit location links using Jolpica coordinates. |

The Node.js data pipeline paginates and normalizes public responses into dated JSON snapshots. GitHub Actions refreshes the active season, any incomplete seeded seasons, and the records archive four times daily and on deployment. The last successful deployment stays online if a refresh fails. The browser reads recent seasons from same-origin snapshots, fetches other seasons and individual timing sessions on demand, and displays data stamps or an error with a retry action. Third-party API timing and historical coverage vary by season and event.

GitHub Pages serves the static app over HTTPS. The GitHub Actions workflow supplies the scheduled backend and publishes the static build. The application requires no API key, database, or always-on server.

## Local development

Use Node.js 22 or newer. The modern app has no package dependencies.

```sh
npm run dev
npm test
npm run build
```

The dev server prints the URL under the same project path as GitHub Pages. It uses the committed snapshots on startup. An internet connection is needed for on-demand data and optional web fonts. Run `npm run refresh -- 2026 --records` to regenerate the specified season and all-time winners, or `npm run refresh -- --publish` to run the same refresh as GitHub Actions. Restart the dev server after changing source files or refreshing data.

Race Lab is an independent educational project. The hero depicts a fictional car.
