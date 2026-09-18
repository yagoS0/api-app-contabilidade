import { prisma } from '../src/infrastructure/db/prisma.js';
import { backfillIdentidadeComunicacao } from '../src/application/whatsapp/BackfillIdentidadeComunicacaoService.js';

// Sem --apply é inventário somente leitura. Nenhum provedor externo é usado.
try {
  const resultado = await backfillIdentidadeComunicacao({ aplicar: process.argv.includes('--apply'), client: prisma });
  console.log(JSON.stringify(resultado, null, 2));
  if (resultado.conflitos.length) process.exitCode = 2;
} catch (err) { console.error(err.code || 'BACKFILL_FALHOU', err.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
