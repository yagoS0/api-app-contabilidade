const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan } = require('./verificar.cjs');

test('domínio e aplicação mantêm dependências concretas nos adaptadores', t => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'altan-fronteiras-'));
  t.after(() => fs.rmSync(checkout, { recursive: true, force: true }));
  const files = {
    'prisma/schema.prisma': 'model Guide {\n}',
    'src/modules/guides/domain/guia.js': [
      'import { Router } from "express";',
      'import { PrismaClient } from "@prisma/client";',
      'import { S3Client } from "@aws-sdk/client-s3";',
      'import { ler } from "../infrastructure/documentos.js";',
    ].join('\n'),
    'src/modules/guides/infrastructure/documentos.js': 'export const ler = () => null;',
    'src/modules/guides/application/consultar.js': 'export { ler } from "../infrastructure/documentos.js";',
  };
  for (const [file, source] of Object.entries(files)) {
    const target = path.join(checkout, 'apps/api', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  const domain = 'modules/guides/domain/guia.js';
  const adapter = 'modules/guides/infrastructure/documentos.js';
  const expected = [
    ['dominio-pacote-externo', domain, 'express'],
    ['dominio-pacote-externo', domain, '@prisma/client'],
    ['prisma-import', domain, '@prisma/client'],
    ['dominio-pacote-externo', domain, '@aws-sdk/client-s3'],
    ['dominio-dependencia', domain, adapter],
    ['aplicacao-dependencia', 'modules/guides/application/consultar.js', adapter],
  ];
  assert.deepEqual(scan(checkout), Object.fromEntries(expected.map(key => [JSON.stringify(key), 1])));
});
