import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { openapiPath } from '@ambar/api-contract';
import type { Response } from 'supertest';

type Json = Record<string, any>;

const doc: Json = parse(readFileSync(openapiPath, 'utf8'));
const DOC_ID = 'ambar-openapi';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('int64', { type: 'number', validate: (n: number) => Number.isSafeInteger(n) });
ajv.addSchema(doc, DOC_ID);

const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

function resolvePointer(pointer: string): Json {
  return pointer
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node: Json, key) => node[key], doc);
}

function findOperation(operationId: string): { path: string; method: string; op: Json } {
  for (const [path, item] of Object.entries<Json>(doc.paths)) {
    for (const [method, op] of Object.entries<Json>(item)) {
      if (op && typeof op === 'object' && op.operationId === operationId) return { path, method, op };
    }
  }
  throw new Error(`operationId ${operationId} no existe en el contrato`);
}

/**
 * Prueba de contrato: el status debe estar declarado para la operación y el cuerpo
 * debe validar contra el esquema del contrato (incluidos los errores RFC 9457).
 */
export function expectContract(res: Response, operationId: string): void {
  const { path, method, op } = findOperation(operationId);
  const status = String(res.status);
  if (!op.responses[status]) {
    throw new Error(
      `${operationId} respondió ${status}, que no está declarado en el contrato (${Object.keys(op.responses).join(', ')}).\nCuerpo: ${JSON.stringify(res.body)}`,
    );
  }
  let pointer = `/paths/${esc(path)}/${method}/responses/${status}`;
  let response = op.responses[status];
  if (response.$ref) {
    pointer = response.$ref.slice(1);
    response = resolvePointer(pointer);
  }
  const contentTypes = Object.keys(response.content ?? {});
  if (contentTypes.length === 0) return;
  const contentType = contentTypes[0];
  expect(res.headers['content-type']).toContain(contentType);

  const validate = ajv.getSchema(`${DOC_ID}#${pointer}/content/${esc(contentType)}/schema`);
  if (!validate) throw new Error(`No se pudo compilar el esquema en ${pointer}`);
  if (!validate(res.body)) {
    throw new Error(
      `La respuesta ${status} de ${operationId} no cumple el contrato: ${ajv.errorsText(validate.errors)}\nCuerpo: ${JSON.stringify(res.body)}`,
    );
  }
}
