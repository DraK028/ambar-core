#!/usr/bin/env node
/**
 * SOLO DESARROLLO: hace de webhook de Slack para las alertas de operación de n8n.
 * Guarda cada mensaje recibido como una línea JSON.
 *   node tools/ops-capture.mjs /tmp/ops.jsonl      # OPS_WEBHOOK_URL=http://127.0.0.1:9999/ops
 */
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const out = process.argv[2] ?? 'ops-alerts.jsonl';
const port = Number(process.env.PORT ?? 9999);
createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  appendFileSync(out, JSON.stringify({ path: req.url, body: b }) + '\n');
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
}).listen(port, '127.0.0.1', () => console.log(`Alertas de operación → ${out} (http://127.0.0.1:${port})`));
