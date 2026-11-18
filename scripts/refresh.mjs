import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { season, winnerRecords } from '../web/data.js';

const output = new URL('../data/', import.meta.url);
await mkdir(output, { recursive: true });
async function save(file, data) {
  const target = new URL(file, output);
  const temporary = new URL(`${file}.${process.pid}.tmp`, output);
  await writeFile(temporary, JSON.stringify(data) + '\n');
  await rename(temporary, target);
}

const utcYear = new Date().getUTCFullYear();
const args = process.argv.slice(2);
const publish = args.includes('--publish');
if (args.some(arg => !['--records', '--publish'].includes(arg) && !/^\d{4}$/.test(arg))) {
  throw new Error('Pass calendar years, --records, or --publish.');
}
const years = args.filter(arg => /^\d{4}$/.test(arg)).map(Number);
if (publish) {
  const seeded = (await readdir(output)).filter(file => /^\d{4}\.json$/.test(file)).map(file => Number(file.slice(0, 4)));
  const newest = Math.min(utcYear, Math.max(utcYear - 1, ...seeded));
  for (const year of seeded.filter(year => year < utcYear)) {
    const snapshot = JSON.parse(await readFile(new URL(`${year}.json`, output), 'utf8'));
    if (snapshot.races.some(race => !race.results.length)) years.push(year);
  }
  for (let year = newest; year <= utcYear; year++) years.push(year);
}
for (const year of new Set(years.length ? years : args.includes('--records') ? [] : [utcYear])) {
  const snapshot = await season(year);
  let previous;
  try {
    previous = JSON.parse(await readFile(new URL(`${year}.json`, output), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous && (snapshot.driverRound < previous.driverRound || snapshot.teamRound < previous.teamRound ||
      snapshot.races.filter(race => race.results.length).length < previous.races.filter(race => race.results.length).length)) {
    throw new Error(`The provider returned an older ${year} season than the cached snapshot.`);
  }
  await save(`${year}.json`, snapshot);
  console.log(`Updated ${year} · ${snapshot.races.length} scheduled, ${snapshot.races.filter(race => race.results.length).length} classified races.`);
}
if (publish || args.includes('--records') || !args.length) {
  const records = await winnerRecords();
  if (!records.wins.length) throw new Error('The provider returned no wins.');
  await save('records.json', records);
  console.log(`Updated records · ${records.wins.length} winning entries.`);
}
