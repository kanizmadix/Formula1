import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { median } from '../web/metrics.js';

const exec = promisify(execFile);
const dumpEndpoint = 'https://api.jolpi.ca/data/dumps/download/';
const minimumYear = 2018;
const maximumDumpSize = 64 * 1024 * 1024;

async function dumpMetadata() {
  const metadata = await fetch(dumpEndpoint, { signal: AbortSignal.timeout(25_000) });
  if (!metadata.ok) throw new Error(`Jolpica dump metadata returned HTTP ${metadata.status}.`);
  const dump = (await metadata.json()).delayed_dumps?.csv;
  if (!(dump?.file_size > 0 && dump.file_size <= maximumDumpSize) ||
      !Number.isFinite(Date.parse(dump.uploaded_at)) || !/^[0-9a-f]{64}$/i.test(dump.file_hash)) {
    throw new Error('Jolpica did not provide valid metadata for the free CSV dump.');
  }
  return dump;
}

async function downloadDump(target, dump) {
  const response = await fetch(`${dumpEndpoint}delayed/?dump_type=csv`, { signal: AbortSignal.timeout(240_000) });
  if (!response.ok) throw new Error(`Jolpica dump download returned HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length !== dump.file_size || createHash('sha256').update(archive).digest('hex') !== dump.file_hash.toLowerCase()) {
    throw new Error('The Jolpica download did not match the archive metadata.');
  }
  await writeFile(target, archive);
}

async function hasCurrentArchives(output, asOf) {
  const read = async file => JSON.parse(await readFile(join(output, file), 'utf8'));
  try {
    const winless = await read('winless.json');
    if (winless?.version !== 1 || winless.asOf !== asOf || !Array.isArray(winless.rows) || !winless.rows.length ||
        typeof winless.lastRace !== 'string' || !Number.isFinite(Date.parse(winless.lastRace))) return false;
    const lastYear = Number(winless.lastRace.slice(0, 4));
    if (
        !Number.isInteger(lastYear) || lastYear < minimumYear || lastYear > new Date(asOf).getUTCFullYear()) return false;
    for (let year = minimumYear; year <= lastYear; year++) {
      const archive = await read(`${year}.json`);
      if (archive?.version !== 1 || archive.year !== year || archive.asOf !== asOf ||
          !Array.isArray(archive.races) || !archive.races.length) return false;
    }
    return true;
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') return false;
    throw error;
  }
}

function* csvRows(text, required, name) {
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r?\n|$)/y;
  let headers;
  let row = [];
  for (let offset = 0; offset < text.length;) {
    field.lastIndex = offset;
    const match = field.exec(text);
    if (!match || field.lastIndex === offset) throw new Error(`Invalid CSV in ${name} at offset ${offset}.`);
    offset = field.lastIndex;
    row.push(match[1]?.replaceAll('""', '"') ?? match[2]);
    if (match[3] === ',') continue;
    if (!headers) {
      headers = row;
      if (required.some(column => !headers.includes(column))) throw new Error(`Unexpected columns in ${name}.`);
    } else {
      if (row.length !== headers.length) throw new Error(`Incomplete row in ${name} at offset ${offset}.`);
      yield Object.fromEntries(headers.map((column, index) => [column, row[index]]));
    }
    row = [];
  }
  if (row.length || !headers) throw new Error(`Incomplete CSV in ${name}.`);
}

async function readTable(dump, name, columns) {
  const { stdout } = await exec('unzip', ['-p', dump, `formula_one_${name}.csv`], { maxBuffer: maximumDumpSize });
  return csvRows(stdout, columns, name);
}

function milliseconds(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const ms = ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000
    + Number((match[4] ?? '').padEnd(6, '0')) / 1000;
  return ms > 0 ? ms : null;
}

// SessionEntry status values are defined in Jolpica's SessionStatus model.
function recordedStart(entry) {
  return ['0', '1', '10', '11'].includes(entry.status) || (entry.status === '20' && Number(entry.laps_completed) > 0);
}

function retirementReason(entry) {
  if (entry.status !== '10' && entry.status !== '11') return null;
  const detail = entry.detail.trim();
  if (detail && !/^(retired|did not finish|dnf|unknown)$/i.test(detail)) return detail;
  return entry.status === '10' ? 'Accident or on-track incident' : 'Reason not specified';
}

async function archiveData(dump, asOf) {
  const [seasonRows, circuitRows, driverRows, roundRows, sessionRows, teamDriverRows, teamRows, roundEntryRows] = await Promise.all([
    readTable(dump, 'season', ['id', 'year']),
    readTable(dump, 'circuit', ['id', 'reference', 'name']),
    readTable(dump, 'driver', ['id', 'reference', 'forename', 'surname']),
    readTable(dump, 'round', ['id', 'season_id', 'number', 'name', 'date', 'circuit_id', 'is_cancelled']),
    readTable(dump, 'session', ['id', 'round_id', 'type', 'is_cancelled']),
    readTable(dump, 'teamdriver', ['id', 'driver_id', 'team_id']),
    readTable(dump, 'team', ['id', 'reference', 'name']),
    readTable(dump, 'roundentry', ['id', 'team_driver_id'])
  ]);
  const index = rows => new Map(Array.from(rows, row => [row.id, row]));
  const years = index(seasonRows);
  const circuits = index(circuitRows);
  const drivers = index(driverRows);
  const rounds = index(roundRows);
  const teamDrivers = index(teamDriverRows);
  const teams = index(teamRows);
  const roundEntries = index(roundEntryRows);
  const races = new Map();
  for (const session of sessionRows) {
    if (session.type !== 'R' || session.is_cancelled === 't') continue;
    const race = rounds.get(session.round_id);
    if (!race || race.is_cancelled === 't' || !race.number || !race.date) continue;
    const year = Number(years.get(race.season_id)?.year);
    if (!Number.isInteger(year)) throw new Error(`Missing season for round ${race.id}.`);
    const circuit = circuits.get(race.circuit_id);
    races.set(session.id, {
      id: race.id, year, round: Number(race.number), date: race.date, name: race.name,
      circuitId: circuit?.reference ?? '', circuit: circuit?.name ?? '', starts: new Map(), drivers: []
    });
  }

  const archiveEntries = new Map();
  for (const row of await readTable(dump, 'sessionentry', ['id', 'session_id', 'round_entry_id', 'status', 'position', 'laps_completed', 'detail'])) {
    const race = races.get(row.session_id);
    if (!race) continue;
    const teamDriver = teamDrivers.get(roundEntries.get(row.round_entry_id)?.team_driver_id);
    const driver = drivers.get(teamDriver?.driver_id);
    if (!driver?.reference) throw new Error(`Missing driver for race entry ${row.id}.`);
    const started = recordedStart(row);
    const won = row.status === '0' && row.position === '1';
    if (started) race.starts.set(driver.id, won || race.starts.get(driver.id) === true);
    if (race.year < minimumYear) continue;
    const team = teams.get(teamDriver.team_id);
    const entry = {
      id: driver.reference, name: `${driver.forename} ${driver.surname}`.trim(),
      teamId: team?.reference ?? '', team: team?.name ?? '',
      started, won, retirement: retirementReason(row),
      lapTimes: new Map(), pitCount: 0, pitLane: []
    };
    race.drivers.push(entry);
    archiveEntries.set(row.id, entry);
  }

  for (const row of await readTable(dump, 'lap', ['session_entry_id', 'number', 'is_deleted', 'time'])) {
    const entry = archiveEntries.get(row.session_entry_id);
    if (!entry || row.is_deleted === 't' || !(Number(row.number) > 0)) continue;
    const duration = milliseconds(row.time);
    if (duration !== null) entry.lapTimes.set(row.number, duration);
  }

  for (const row of await readTable(dump, 'pitstop', ['session_entry_id', 'duration'])) {
    const entry = archiveEntries.get(row.session_entry_id);
    if (!entry) continue;
    entry.pitCount++;
    const duration = milliseconds(row.duration);
    if (duration !== null) entry.pitLane.push(duration);
  }

  const seasons = new Map();
  const careers = new Map();
  const countedStarts = new Set();
  const wonEntries = new Set();
  let firstRace;
  let lastRace;
  for (const race of races.values()) {
    if (!race.starts.size) continue;
    if (!firstRace || race.date < firstRace) firstRace = race.date;
    if (!lastRace || race.date > lastRace) lastRace = race.date;
    for (const [driverId, won] of race.starts) {
      const key = `${race.id}/${driverId}`;
      if (!careers.has(driverId)) careers.set(driverId, { starts: 0, wins: 0 });
      const career = careers.get(driverId);
      if (!countedStarts.has(key)) career.starts++;
      if (won && !wonEntries.has(key)) career.wins++;
      countedStarts.add(key);
      if (won) wonEntries.add(key);
    }
    if (race.year < minimumYear) continue;
    if (!seasons.has(race.year)) seasons.set(race.year, { version: 1, year: race.year, asOf, races: [] });
    seasons.get(race.year).races.push({
      round: race.round, date: race.date, name: race.name, circuitId: race.circuitId, circuit: race.circuit,
      drivers: race.drivers.map(({ lapTimes, ...entry }) => {
        const times = [...lapTimes.values()];
        return {
          ...entry, laps: times.length,
          medianLap: median(times), fastestLap: times.length ? Math.min(...times) : null
        };
      })
    });
  }
  if (!firstRace || !seasons.size || ![...seasons.values()].some(season => season.races.some(race =>
    race.drivers.some(driver => driver.laps > 0 && driver.pitCount > 0)))) {
    throw new Error('The dump did not contain enough data to build the season archives.');
  }
  for (const season of seasons.values()) season.races.sort((a, b) => a.round - b.round);
  const rows = [...careers].flatMap(([id, career]) => {
    if (!career.starts || career.wins) return [];
    const driver = drivers.get(id);
    return [{ id: driver.reference, name: `${driver.forename} ${driver.surname}`.trim(), starts: career.starts }];
  }).sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name, 'en')).slice(0, 25);
  return { seasons, winless: { version: 1, asOf, firstRace, lastRace, rows } };
}

const { values } = parseArgs({
  options: { dump: { type: 'string' }, 'as-of': { type: 'string' }, output: { type: 'string' } }
});
if (values['as-of'] && (!values.dump || !Number.isFinite(Date.parse(values['as-of'])))) {
  throw new Error('Pass a valid --as-of date with --dump.');
}
const output = values.output ?? fileURLToPath(new URL('../data/season-analysis/', import.meta.url));
const metadata = values.dump ? null : await dumpMetadata();
const asOf = metadata?.uploaded_at ?? values['as-of'] ?? null;
if (metadata && await hasCurrentArchives(output, asOf)) {
  console.log(`Season analysis archive already matches the Jolpica dump published ${asOf}.`);
} else {
  const temporary = await mkdtemp(join(tmpdir(), 'f1-season-archive-'));
  try {
    const dump = values.dump ?? join(temporary, 'dump.zip');
    if (metadata) await downloadDump(dump, metadata);
    const { seasons, winless } = await archiveData(dump, asOf);
    await mkdir(output, { recursive: true });
    for (const [filename, data] of [
      ...[...seasons].map(([year, season]) => [`${year}.json`, season]),
      ['winless.json', winless]
    ]) {
      const target = join(output, filename);
      const pending = `${target}.${process.pid}.tmp`;
      try {
        await writeFile(pending, JSON.stringify(data) + '\n');
        await rename(pending, target);
      } finally {
        await rm(pending, { force: true });
      }
    }
    console.log(`Built timing archives for ${[...seasons.keys()].sort().join(', ')} and career starts through ${winless.lastRace}.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
