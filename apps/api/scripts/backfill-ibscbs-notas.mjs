import { PrismaClient } from '@prisma/client';
import { reprocessarIbscbs } from '../src/application/fiscal/ibscbs/reprocessarNotas.js';
const args = process.argv.slice(2);
const i = args.indexOf('--empresa');
const portalClientId = i >= 0 ? args[i + 1] : null;
if (!portalClientId || portalClientId.startsWith('--')) throw new Error('Uso: node scripts/backfill-ibscbs-notas.mjs --empresa ID_PORTAL [--aplicar]. Simulação é o padrão.');
const prisma = new PrismaClient();
try {
  if (!await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true } })) throw new Error('Empresa não encontrada');
  console.log(JSON.stringify(await reprocessarIbscbs({ client: prisma, portalClientId, aplicar: args.includes('--aplicar') }), null, 2));
} finally { await prisma.$disconnect(); }
