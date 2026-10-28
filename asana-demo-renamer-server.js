#!/usr/bin/env node
'use strict';

// Run: node asana-demo-renamer-server.js
// Open: http://localhost:3000

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3000;
const HTML = path.join(__dirname, 'asana-demo-renamer.html');

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ── Serve HTML ──────────────────────────────────────────────────────────
    if (u.pathname === '/' || u.pathname === '/index.html') {
      if (!fs.existsSync(HTML)) {
        res.writeHead(404); res.end('asana-demo-renamer.html not found in the same folder');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(HTML).pipe(res);
      return;
    }

    // ── Proxy → Asana (/asana/...) ──────────────────────────────────────────
    if (u.pathname.startsWith('/asana/')) {
      const asanaPath = '/api/1.0' + u.pathname.slice('/asana'.length) + u.search;
      const body = req.method !== 'GET' ? await readBody(req) : Buffer.alloc(0);
      const hdrs = {
        Authorization: req.headers['authorization'] || '',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (body.length) hdrs['Content-Length'] = body.length;

      const r = await httpsReq({ hostname: 'app.asana.com', path: asanaPath, method: req.method, headers: hdrs }, body);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.body);
      return;
    }

    // ── Proxy → Anthropic (/claude) ─────────────────────────────────────────
    if (u.pathname === '/claude') {
      const body = await readBody(req);
      const hdrs = {
        'x-api-key': req.headers['x-claude-key'] || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      };
      const r = await httpsReq({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: hdrs }, body);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.body);
      return;
    }

    res.writeHead(404); res.end('Not found');

  } catch (e) {
    console.error('Proxy error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }

}).listen(PORT, '127.0.0.1', () => {
  console.log('\n  🔄  Asana Demo Renamer');
  console.log(`  ✅  http://localhost:${PORT}\n`);
});
