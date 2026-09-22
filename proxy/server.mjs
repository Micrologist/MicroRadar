// Node entry point for the same proxy, for hosts that run a container or a
// plain Node process (Fly.io, Render, Railway) rather than a Worker runtime.
//
// worker.js stays the single source of truth: it is written against the web
// platform (Request, Response, URL, fetch), all of which Node has natively, so
// this file only bridges node:http to it and never duplicates the logic.
//
// Run: node server.mjs   (PORT defaults to 8080)

import http from 'node:http';
import worker from './worker.js';

const PORT = process.env.PORT || 8080;

http.createServer(async (req, res) => {
  try {
    const request = new Request('http://' + (req.headers.host || 'localhost') + req.url, {
      method: req.method,
      headers: req.headers,
    });
    const out = await worker.fetch(request);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy failure', detail: String(err && err.message) }));
  }
}).listen(PORT, () => console.log('microradar proxy listening on ' + PORT));
