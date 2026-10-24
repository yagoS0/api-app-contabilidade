import { PrismaClient } from '@prisma/client';
import { reconciliarDatasNotas } from '../src/application/notas/reconciliarDatasNotas.js';

// Intentionally no dotenv: this command must not silently load production credentials.
const value = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const aplicar = process.argv.includes('--apply-local-disposable');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Somente PostgreSQL loopback autorizado neste incremento.');
if (aplicar && !/(test|discard|descart|isolad)/i.test(url.pathname)) throw Error('Nome de banco descartável de testes obrigatório para escrita.');
const prisma = new PrismaClient();
try {
  const result = await reconciliarDatasNotas(prisma, { clientId: value('client'), ids: value('ids')?.split(','),
    aplicar, confirmarBancoDescartavel: aplicar });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { await prisma.$disconnect(); }
