// Serves dist/ the way CloudFront will, including clean URLs and the per-game board APIs,
// so the whole site can be tried without deploying. node tools/dev-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler as connectionsBoard } from '../lambda/connections.mjs';
import { handler as geozeeBoard } from '../lambda/geozee.mjs';
import { handler as geogridBoard } from '../lambda/geogrid.mjs';
import { handler as weaverBoard } from '../lambda/weaver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = process.env.PORT || 8080;

const boards = {
    '/connections/board': connectionsBoard,
    '/geozee/board': geozeeBoard,
    '/geogrid/board': geogridBoard,
    '/weaver/board': weaverBoard
};

const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

// Mirrors the CloudFront function: /connections and /connections/ both serve the index.
function resolveFile(pathname) {
    const direct = path.join(ROOT, pathname);
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
        return direct;
    }
    const index = path.join(ROOT, pathname, 'index.html');
    if (fs.existsSync(index) && fs.statSync(index).isFile()) {
        return index;
    }
    return null;
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const board = boards[url.pathname.replace(/\/$/, '')];

    if (board) {
        const out = await board({ queryStringParameters: Object.fromEntries(url.searchParams) });
        res.writeHead(out.statusCode, out.headers || { 'Content-Type': 'application/json' });
        res.end(out.body);
        return;
    }

    const file = resolveFile(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file || !file.startsWith(ROOT)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('http://localhost:' + PORT));
