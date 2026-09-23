// node scripts/diagnosticar-pagamentos-guias.mjs --company UUID [--competencia YYYY-MM]
// Só leitura: não corrige nem reabre competências. Conexão vem do ambiente operacional.
import { PrismaClient } from '@prisma/client';
import { diagnosticarPagamentosGuias } from '../src/application/accounting/diagnosticoPagamentosGuias.js';
const args = process.argv.slice(2);
const portalClientId = args[args.indexOf('--company') + 1];
const competencia = args.includes('--competencia') ? args[args.indexOf('--competencia') + 1] : undefined;
if (!args.includes('--company') || !portalClientId || portalClientId.startsWith('--')) {
  throw new Error('Uso: --company UUID [--competencia YYYY-MM]. Nenhuma consulta executada.');
}
const client = new PrismaClient();
try {
  const rows = await diagnosticarPagamentosGuias({ portalClientId, competencia, client });
  process.stdout.write(JSON.stringify({ portalClientId, competencia: competencia || null, somenteLeitura: true, guias: rows }, null, 2) + '\n');
} finally { await client.$disconnect(); }
