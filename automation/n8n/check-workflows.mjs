#!/usr/bin/env node
/**
 * Revisión estática de los flujos de n8n (corre en CI sin levantar n8n):
 *   - cada ruta de packages/events tiene su flujo con un Webhook en ese path;
 *   - el nodo "Verificar firma" acepta exactamente los tipos que esa ruta recibe;
 *   - las rutas coinciden con las colas de Terraform (modules/events);
 *   - todo flujo tiene el flujo de errores, no guarda ejecuciones exitosas y usa la credencial del core;
 *   - ningún flujo trae secretos ni URLs de AWS escritos a mano.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ROUTES } = require('../../packages/events');
// packages/events guarda tipo → flujos; aquí se necesita flujo → tipos.
const FLOWS = {};
for (const [type, routes] of Object.entries(ROUTES)) for (const r of routes) (FLOWS[r] ??= []).push(type);
const dir = new URL('./workflows/', import.meta.url);
const errors = [];
const fail = (msg) => errors.push(msg);

const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, wf: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));

const ERROR_WF = 'AmbarErrores0001';
const ids = new Set();
const webhookPaths = new Map();

for (const { file, wf } of workflows) {
  if (ids.has(wf.id)) fail(`${file}: id repetido ${wf.id}`);
  ids.add(wf.id);
  if (!/^[A-Za-z0-9]{16}$/.test(wf.id)) fail(`${file}: el id debe tener 16 caracteres alfanuméricos`);
  if (wf.settings?.saveDataSuccessExecution !== 'none') fail(`${file}: no debe guardar ejecuciones exitosas (datos financieros)`);
  if (wf.id !== ERROR_WF && wf.settings?.errorWorkflow !== ERROR_WF) fail(`${file}: falta errorWorkflow=${ERROR_WF}`);

  const names = new Set(wf.nodes.map((n) => n.name));
  for (const [from, conn] of Object.entries(wf.connections)) {
    if (!names.has(from)) fail(`${file}: conexión desde un nodo inexistente "${from}"`);
    for (const outs of conn.main) for (const c of outs) if (!names.has(c.node)) fail(`${file}: conexión hacia "${c.node}" que no existe`);
  }

  for (const n of wf.nodes) {
    const text = JSON.stringify(n.parameters);
    if (/amazonaws\.com|hooks\.slack\.com|Bearer [A-Za-z0-9]/.test(text)) fail(`${file}/${n.name}: URL o secreto escrito a mano`);
    if (n.type === 'n8n-nodes-base.httpRequest' && text.includes('AMBAR_CORE_URL') && n.credentials?.oAuth2Api?.id !== 'AmbarCoreM2M0001') {
      fail(`${file}/${n.name}: las llamadas al core deben usar la credencial AmbarCoreM2M0001`);
    }
    if (n.type === 'n8n-nodes-base.webhook') {
      if (n.parameters.options?.rawBody !== true) fail(`${file}/${n.name}: el webhook necesita rawBody para verificar la firma`);
      if (n.parameters.responseMode !== 'responseNode') fail(`${file}/${n.name}: debe responder al final (un error devuelve 5xx y SQS reintenta)`);
      webhookPaths.set(n.parameters.path, { file, wf });
    }
  }
}

for (const [route, types] of Object.entries(FLOWS)) {
  const found = webhookPaths.get(route);
  if (!found) {
    fail(`La ruta ${route} de packages/events no tiene flujo con Webhook en ese path`);
    continue;
  }
  const verify = found.wf.nodes.find((n) => n.name === 'Verificar firma');
  const m = verify && /const EXPECTED_TYPES = (\[[^\]]*\]);/.exec(verify.parameters.jsCode);
  const expected = m ? JSON.parse(m[1]) : null;
  if (!expected) fail(`${found.file}: falta EXPECTED_TYPES en "Verificar firma"`);
  else if (JSON.stringify([...expected].sort()) !== JSON.stringify([...types].sort())) {
    fail(`${found.file}: acepta ${expected.join(', ')} pero la ruta ${route} recibe ${types.join(', ')}`);
  }
}
for (const path of webhookPaths.keys()) if (!FLOWS[path]) fail(`Webhook ${path} sin ruta en packages/events`);

// Las colas de Terraform deben ser las mismas rutas.
const tf = readFileSync(new URL('../../infra/terraform/modules/events/variables.tf', import.meta.url), 'utf8');
const block = /variable "routes"[\s\S]*?default = \{([\s\S]*?)\n  \}/.exec(tf)?.[1] ?? '';
const tfRoutes = Object.fromEntries(
  [...block.matchAll(/"([a-z-]+)"\s*=\s*\[([^\]]*)\]/g)].map(([, k, v]) => [k, [...v.matchAll(/"([^"]+)"/g)].map((x) => x[1])]),
);
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, [...o[k]].sort()]));
if (canon(tfRoutes) !== canon(FLOWS)) {
  fail(`Terraform (modules/events) y packages/events no coinciden:\n  terraform: ${JSON.stringify(tfRoutes)}\n  events:    ${JSON.stringify(FLOWS)}`);
}

if (errors.length) {
  console.error(`✖ ${errors.length} problema(s) en los flujos:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ ${workflows.length} flujos revisados; rutas, firmas y colas coinciden.`);
