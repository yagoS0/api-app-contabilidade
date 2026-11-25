// Builds a private schema for validation only. Never migrates or generates a client.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const principal = resolve(root, 'apps/api/prisma/schema.prisma');
const original = readFileSync(principal, 'utf8');
let schema = original;
const additions = {
  User: '  comandosFs12 Fs12Comando[] @relation("Fs12ComandoAutor")\n  associacoesFs12 Fs12ComandoCalculo[] @relation("Fs12AssociacaoAutor")',
  AppSetting: '  respostasFs12 Fs12ComandoResposta[] @relation("Fs12RespostaMarcador")',
  SerproChamada: '  comandoFs12 Fs12ComandoReserva? @relation("Fs12ReservaLedger")',
  ApuracaoFs12Revisao: '  comandosFs12 Fs12Comando[] @relation("Fs12ComandoRevisao")',
  ApuracaoFs12Calculo: '  comandosOrigemFs12 Fs12Comando[] @relation("Fs12ComandoOrigem")\n  associacoesFs12 Fs12ComandoCalculo[] @relation("Fs12AssociacaoCalculo")\n  @@unique([id, portalClientId, companyId, competencia, revisaoFs12], map: "fs12_calculo_escopo_vinculo_key")',
};
// Historical fixture remains usable on pre-integration trees. On the integrated schema,
// validate the actual four models rather than adding duplicate definitions.
const integrated = /^model Fs12Comando \{/m.test(schema);
if (!integrated) {
  for (const [model, fields] of Object.entries(additions)) {
    const regex = new RegExp(`(model ${model} \\{[\\s\\S]*?)(\\r?\\n\\})`);
    if (!regex.test(schema)) throw new Error(`Model absent: ${model}`);
    schema = schema.replace(regex, `$1\n${fields}$2`);
  }
  schema += '\n' + readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ensaio.prisma'), 'utf8');
}
const out = resolve(root, '.altan-governance/prisma-ensaio/schema.prisma');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, schema);
const result = spawnSync(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'validate', '--schema', out], {
  cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/validation_only_governance_test' },
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (readFileSync(principal, 'utf8') !== original) throw new Error('Principal schema changed');
console.log('Principal unchanged SHA256:', createHash('sha256').update(original).digest('hex'));
process.exitCode = result.status ?? 1;
