// Local static server for planner/ that applies the same headers as planner/vercel.json,
// so the Content-Security-Policy and caching rules can be tested before deploying.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'planner');
const port = Number(process.argv[2] || 5178);
const rules = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers
  .map(r => ({ re: new RegExp('^' + r.source + '$'), headers: r.headers }));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' };
    // localhost has no HTTPS, so leave out the headers that only make sense over TLS
    for (const r of rules) if (r.re.test(path)) for (const h of r.headers) {
      if (h.key === 'Strict-Transport-Security') continue;
      headers[h.key] = h.key === 'Content-Security-Policy' ? h.value.replace('; upgrade-insecure-requests', '') : h.value;
    }
    res.writeHead(200, headers).end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`planner on http://localhost:${port} (vercel.json headers applied)`));
