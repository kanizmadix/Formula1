export const completed = season => season.races.filter(race => race.results.length);
export const points = results => results.reduce((sum, row) => sum + row.points, 0);
export const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function racePoints(races, id, teams) {
  return races.map(race => points([...race.results, ...race.sprint].filter(row => (teams ? row.teamId : row.id) === id)));
}

export function cumulative(series) {
  let sum = 0;
  return series.map(value => (sum += value));
}

export function trendPace(values) {
  const series = [0, ...cumulative(values)];
  const midpoint = values.length / 2;
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  const covariance = series.reduce((sum, value, index) => sum + (index - midpoint) * (value - mean), 0);
  const variance = series.reduce((sum, _, index) => sum + (index - midpoint) ** 2, 0);
  return variance ? Math.max(0, covariance / variance) : 0;
}

export function model(season, teams, cutoff) {
  const officialRound = teams ? season.teamRound : season.driverRound;
  const races = completed(season).filter(race => race.round <= cutoff);
  const rest = season.races.length - races.length;
  if (races.length < 3) return null;
  const official = teams ? season.teams : season.drivers;
  const entrants = new Map();
  for (const race of races) {
    for (const row of [...race.results, ...race.sprint]) {
      entrants.set(teams ? row.teamId : row.id, teams ? row.team : row.name);
    }
  }
  const officialById = new Map(official.map(row => [row.id, row]));
  const useOfficial = cutoff === officialRound;
  const rows = [...entrants].map(([id, name]) => {
    const values = racePoints(races, id, teams);
    const earned = useOfficial ? officialById.get(id)?.points ?? 0 : values.reduce((sum, value) => sum + value, 0);
    const pace = trendPace(values.slice(-6));
    return { id, name, earned, pace, estimate: earned + pace * rest, values };
  }).sort((a, b) => b.estimate - a.estimate ||
    (useOfficial ? (officialById.get(a.id)?.rank ?? Infinity) - (officialById.get(b.id)?.rank ?? Infinity) : 0) ||
    a.name.localeCompare(b.name));
  const errors = [];
  for (const row of rows) {
    for (let i = 3; i < row.values.length; i++) {
      const training = row.values.slice(Math.max(0, i - 6), i);
      if (!row.values.slice(0, i).some(value => value > 0)) continue;
      errors.push([
        Math.abs(row.values[i] - trendPace(training)),
        Math.abs(row.values[i] - training.reduce((a, b) => a + b, 0) / training.length)
      ]);
    }
  }
  return {
    rows, rest, useOfficial, sample: errors.length,
    mae: errors.length ? [0, 1].map(index => errors.reduce((sum, values) => sum + values[index], 0) / errors.length) : []
  };
}

export function byAge(wins) {
  return wins.flatMap(win => {
    if (!win.born || !win.date) return [];
    const days = (Date.parse(win.date) - Date.parse(win.born)) / 86_400_000;
    return Number.isFinite(days) && days > 0 ? [{ ...win, days }] : [];
  }).sort((a, b) => a.days - b.days);
}

export function leaders(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const id = row[`${key === 'team' ? 'teamId' : 'id'}`];
    const current = counts.get(id) ?? { name: row[key], wins: 0 };
    current.wins++;
    counts.set(id, current);
  }
  return [...counts.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}
