export const JOLPICA = 'https://api.jolpi.ca/ergast/f1/';
export const OPENF1 = 'https://api.openf1.org/v1/';
const responses = new Map();
const lastRequest = new Map();
const spacing = new Map([[JOLPICA, 350], [OPENF1, 550]]);

export class HttpError extends Error {
  constructor(url, status) {
    super(`${new URL(url).hostname} returned HTTP ${status}.`);
    this.status = status;
  }
}

export function json(url, { ttl = 300_000, retries = 1 } = {}) {
  const key = String(url);
  const now = Date.now();
  const cached = responses.get(key);
  if (cached?.until > now) return cached.promise;
  const entry = { until: Infinity };
  const load = async () => {
    for (let attempt = 0; ; attempt++) {
      const base = [...spacing.keys()].find(prefix => key.startsWith(prefix));
      if (base) {
        const start = Math.max(Date.now(), (lastRequest.get(base) ?? 0) + spacing.get(base));
        lastRequest.set(base, start);
        if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()));
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(16_000) });
      if (response.ok) return response.json();
      if (attempt >= retries || (response.status !== 429 && response.status < 500)) {
        throw new HttpError(url, response.status);
      }
      const retryAfter = response.headers.get('retry-after');
      const seconds = Number(retryAfter);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      await new Promise(resolve => setTimeout(resolve, Math.min(30_000, Math.max(1200, delay || 0))));
    }
  };
  entry.promise = load().then(value => {
    entry.until = Date.now() + ttl;
    return value;
  }).catch(error => {
    responses.delete(key);
    throw error;
  });
  responses.set(key, entry);
  return entry.promise;
}

function f1(path, offset = 0) {
  return json(`${JOLPICA}${path}/?limit=100&offset=${offset}`).then(data => {
    if (!data?.MRData) throw new Error('Jolpica returned an unexpected response.');
    return data.MRData;
  });
}

async function racePages(path, field) {
  const races = new Map();
  let offset = 0;
  while (true) {
    const page = await f1(path, offset);
    for (const race of page.RaceTable.Races) {
      const key = `${race.season}/${race.round}`;
      const existing = races.get(key);
      if (field && existing) existing[field].push(...race[field]);
      else races.set(key, race);
    }
    const limit = Number(page.limit);
    const total = Number(page.total);
    if (!(limit > 0) || !Number.isFinite(total)) throw new Error('Invalid Jolpica pagination.');
    offset += limit;
    if (offset >= total) return [...races.values()];
  }
}

const name = driver => `${driver.givenName} ${driver.familyName}`;
const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const day = value => value?.slice(0, 10);
const driverRow = row => ({
  id: row.Driver.driverId, code: row.Driver.code || row.Driver.familyName.slice(0, 3).toUpperCase(),
  name: name(row.Driver), country: row.Driver.nationality, born: row.Driver.dateOfBirth,
  team: row.Constructors.at(-1)?.name, teamId: row.Constructors.at(-1)?.constructorId,
  rank: Number(row.position), points: Number(row.points), wins: Number(row.wins)
});
const teamRow = row => ({
  id: row.Constructor.constructorId, name: row.Constructor.name, country: row.Constructor.nationality,
  rank: Number(row.position), points: Number(row.points), wins: Number(row.wins)
});
const resultRow = row => ({
  id: row.Driver.driverId, name: name(row.Driver), code: row.Driver.code || row.Driver.familyName.slice(0, 3).toUpperCase(),
  number: num(row.number), team: row.Constructor.name, teamId: row.Constructor.constructorId,
  rank: Number(row.position), classification: row.positionText || row.position,
  grid: num(row.grid), points: Number(row.points), laps: num(row.laps), status: row.status,
  time: row.Time?.time, fastest: row.FastestLap?.Time?.time, fastestRank: num(row.FastestLap?.rank)
});

export const utcRaceTime = race => Date.parse(race.at ? `${race.date}T${race.at}` : `${race.date}T23:59:59Z`);

export async function season(seasonId) {
  const [schedule, drivers, teams, results, sprints] = await Promise.all([
    racePages(seasonId), f1(`${seasonId}/driverstandings`),
    Number(seasonId) < 1958 ? Promise.resolve(null) : f1(`${seasonId}/constructorstandings`),
    racePages(`${seasonId}/results`, 'Results'),
    Number(seasonId) < 2021 ? Promise.resolve([]) : racePages(`${seasonId}/sprint`, 'SprintResults')
  ]);
  if (!schedule.length) throw new Error('The provider has no calendar for this season.');
  const year = Number(schedule[0].season);
  const driverList = drivers.StandingsTable.StandingsLists[0];
  const teamList = teams?.StandingsTable.StandingsLists[0];
  const byRound = new Map(results.map(race => [race.round, race.Results]));
  const sprintByRound = new Map(sprints.map(race => [race.round, race.SprintResults]));
  return {
    year, fetchedAt: new Date().toISOString(),
    driverRound: num(driverList?.round), teamRound: num(teamList?.round),
    drivers: (driverList?.DriverStandings ?? []).map(driverRow),
    teams: (teamList?.ConstructorStandings ?? []).map(teamRow),
    races: schedule.map(race => ({
      round: Number(race.round), name: race.raceName, date: race.date, at: race.time,
      circuit: race.Circuit.circuitName, circuitId: race.Circuit.circuitId,
      city: race.Circuit.Location.locality, country: race.Circuit.Location.country,
      lat: num(race.Circuit.Location.lat), lon: num(race.Circuit.Location.long),
      sessions: ['FirstPractice', 'SecondPractice', 'ThirdPractice', 'Qualifying', 'SprintQualifying', 'SprintShootout', 'Sprint'].flatMap(key =>
        race[key] ? [{ name: key.replace(/([a-z])([A-Z])/g, '$1 $2'), date: race[key].date, at: race[key].time }] : []
      ),
      results: (byRound.get(race.round) ?? []).map(resultRow),
      sprint: (sprintByRound.get(race.round) ?? []).map(resultRow)
    }))
  };
}

async function open(endpoint, parameters) {
  const url = `${OPENF1}${endpoint}?${new URLSearchParams(parameters)}`;
  const rows = await json(url, { ttl: 43_200_000 });
  if (!Array.isArray(rows)) throw new Error('OpenF1 returned an unexpected response.');
  return rows;
}

export async function timingSession(year, race) {
  const sessions = await open('sessions', { year, session_name: 'Race' });
  const sameDate = sessions.filter(session => day(session.date_start) === race.date);
  const [session] = sameDate.length === 1 ? sameDate : sameDate.filter(row =>
    row.country_name?.toLowerCase() === race.country.toLowerCase());
  if (!session || !session.date_end || Date.parse(session.date_end) + 30 * 60_000 > Date.now()) return null;
  return session;
}

export async function openTiming(session) {
  const filter = { session_key: session.session_key };
  const [laps, pits, stints] = await Promise.allSettled([
    open('laps', filter), open('pit', filter), open('stints', filter)
  ]);
  const failures = [laps, pits, stints].filter(item => item.status === 'rejected');
  if (failures.length === 3) throw failures[0].reason;
  return {
    source: 'OpenF1', sessionKey: session.session_key,
    laps: (laps.value ?? []).filter(lap => lap.lap_duration > 0 && !lap.is_pit_out_lap).map(lap => ({
      number: lap.driver_number, lap: lap.lap_number, seconds: lap.lap_duration
    })),
    pits: (pits.value ?? []).map(pit => ({
      number: pit.driver_number, lap: pit.lap_number, lane: num(pit.lane_duration ?? pit.pit_duration), stop: num(pit.stop_duration)
    })),
    stints: (stints.value ?? []).map(stint => ({
      number: stint.driver_number, first: stint.lap_start, last: stint.lap_end, compound: stint.compound, age: stint.tyre_age_at_start
    })),
    missing: [laps, pits, stints].flatMap((item, index) => item.status === 'rejected' ? [['lap times', 'pit stops', 'tyre stints'][index]] : [])
  };
}

function seconds(value) {
  if (value == null || !/^\d+(?::\d{2})*(?:\.\d+)?$/.test(String(value))) return null;
  return String(value).split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
}

export async function legacyPits(year, race) {
  if (year < 2011) return [];
  const rows = await racePages(`${year}/${race.round}/pitstops`, 'PitStops');
  const numbers = new Map(race.results.map(result => [result.id, result.number]));
  return (rows[0]?.PitStops ?? []).map(pit => ({
    number: numbers.get(pit.driverId), lap: Number(pit.lap), lane: seconds(pit.duration), stop: null
  }));
}

export async function legacyTiming(year, race, drivers) {
  const [pits, ...lapRaces] = await Promise.allSettled([
    legacyPits(year, race),
    ...drivers.map(id => racePages(`${year}/${race.round}/drivers/${encodeURIComponent(id)}/laps`, 'Laps'))
  ]);
  const failures = [pits, ...lapRaces].filter(item => item.status === 'rejected');
  if (failures.length === 1 + drivers.length) throw failures[0].reason;
  const numbers = new Map(race.results.map(result => [result.id, result.number]));
  return {
    source: 'Jolpica F1',
    pits: pits.value ?? [],
    laps: lapRaces.flatMap(item => (item.value?.[0]?.Laps ?? []).flatMap(lap =>
      lap.Timings.flatMap(timing => {
        const duration = seconds(timing.time);
        return duration > 0 ? [{ number: numbers.get(timing.driverId), lap: Number(lap.number), seconds: duration }] : [];
      })
    )),
    stints: [],
    missing: [pits.status === 'rejected' && 'pit stops', lapRaces.some(item => item.status === 'rejected') && 'lap times'].filter(Boolean)
  };
}

export async function winnerRecords() {
  const winners = await racePages('results/1', 'Results');
  return {
    fetchedAt: new Date().toISOString(),
    wins: winners.flatMap(race => race.Results.map(row => ({
      driver: name(row.Driver), id: row.Driver.driverId, born: row.Driver.dateOfBirth,
      team: row.Constructor.name, teamId: row.Constructor.constructorId,
      event: race.raceName, date: race.date, year: Number(race.season)
    })))
  };
}
