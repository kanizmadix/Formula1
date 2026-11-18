import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';

const fromRoot = path => new URL(`../${path}`, import.meta.url);
const data = fromRoot('data/');
const output = fromRoot('dist/');
await rm(output, { recursive: true, force: true });
await cp(fromRoot('web/'), output, { recursive: true });
const files = (await readdir(data)).filter(file => /^(?:\d{4}|records)\.json$/.test(file));
await mkdir(new URL('data/', output), { recursive: true });
await Promise.all(files.map(file => cp(new URL(file, data), new URL(`data/${file}`, output))));
const years = files.filter(file => /^\d{4}\.json$/.test(file)).map(file => Number(file.slice(0, 4))).sort((a, b) => b - a);
await writeFile(new URL('data/index.json', output), JSON.stringify({ years, records: files.includes('records.json') }));
await writeFile(new URL('.nojekyll', output), '');
console.log(`Built dist/ with ${years.length} season snapshots.`);
