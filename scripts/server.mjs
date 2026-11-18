import './build.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const types = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', jpg: 'image/jpeg', webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml'
};
const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/Formula1(?=\/|$)/, '');
  const relative = path.replace(/^\/+/, '') || 'index.html';
  const file = new URL(relative, root);
  if (!file.href.startsWith(root.href) || file.protocol !== 'file:') {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[relative.split('.').at(-1)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local preview http://127.0.0.1:${port}/Formula1/`));
