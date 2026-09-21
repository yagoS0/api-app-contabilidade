// Prova pequena do SQL REAL da projeção, sem migrations, provedor ou dados reais.
// Uso: node apps/api/scripts/verify-whatsapp-janela-postgres.js <diretório dos binários PostgreSQL>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { lerHistoricoIdentidade, listarInboxWhatsapp } from '../src/application/whatsapp/InboxWhatsappService.js';

globalThis.fetch = () => { throw new Error('Rede externa proibida'); };
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw new Error('Informe os binários PostgreSQL de teste.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = path.join(repo, 'test-evidence', `janela-pg-${Date.now()}`);
const data = path.join(run, 'data');
fs.mkdirSync(run, { recursive: true });
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
function comando(exe, args) {
  const r = spawnSync(path.join(pgBin, `${exe}.exe`), args, { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  fs.appendFileSync(path.join(run, 'cluster.log'), `${exe}\n${r.stdout || ''}${r.stderr || ''}`);
  if (r.status !== 0) throw new Error(`${exe}: ${r.error?.message || r.stderr}`);
}
let iniciou = false;
let sql;
const checks = [];
try {
  comando('initdb', ['-D', data, '-U', 'janela_test', '-A', 'trust', '--encoding=UTF8', '--no-locale']);
  comando('pg_ctl', ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c timezone=UTC`, '-w', 'start']);
  iniciou = true;
  // A URL é construída somente com a porta alocada deste cluster; nunca lê DATABASE_URL.
  sql = new PrismaClient({ datasources: { db: { url: `postgresql://janela_test@127.0.0.1:${port}/postgres` } } });
  await sql.$executeRawUnsafe('CREATE TABLE conversas_whatsapp (id text PRIMARY KEY, "canalId" text, "vinculoNumeroId" text, "telefoneE164" text)');
  await sql.$executeRawUnsafe('CREATE TABLE mensagens_whatsapp (id text PRIMARY KEY, "conversaId" text, direcao text, "ocorridaEmProvedor" timestamp, "registradaEm" timestamp)');
  await sql.$executeRawUnsafe('CREATE TABLE resolucoes_contexto_whatsapp ("mensagemId" text, "conversaId" text)');
  const agora = Date.now(), hora = 3600000;
  const ha = n => new Date(agora - n * hora);
  const pessoa = { id: 'pessoa-sintetica', estado: 'ATIVO', versao: 1 };
  const segmento = (id, canalId, vinculoNumeroId = 'v-atual', telefone = '5521999998888') => ({
    id, canalId, vinculoNumeroId, telefoneE164: telefone, portalClientId: null,
    chaveEscopo: `sem-empresa:${id}`, excluidaEm: null, updatedAt: ha(1),
    canalWhatsapp: canalId ? { id: canalId, ativo: true } : null,
    vinculoNumero: vinculoNumeroId ? { id: vinculoNumeroId, interlocutorId: pessoa.id, interlocutor: pessoa, encerrouEm: null } : null,
  });
  const segmentos = [segmento('principal', 'principal'), segmento('comercial', 'comercial'), segmento('antigo', 'principal', 'v-anterior'),
    segmento('legado-a', null, null, '552188887777'), segmento('legado-b', null, null, '552177776666')];
  segmentos.find(c => c.id === 'antigo').vinculoNumero.encerrouEm = ha(1);
  for (const c of segmentos) await sql.$executeRaw`INSERT INTO conversas_whatsapp (id,"canalId","vinculoNumeroId","telefoneE164") VALUES (${c.id},${c.canalId},${c.vinculoNumeroId},${c.telefoneE164})`;
  async function inserir(id, conversaId, provedor, registro, direcao = 'in') {
    await sql.$executeRaw`INSERT INTO mensagens_whatsapp (id,"conversaId",direcao,"ocorridaEmProvedor","registradaEm") VALUES (${id},${conversaId},${direcao},${provedor},${registro})`;
  }
  await inserir('comercial-recente', 'comercial', ha(1), ha(0.9));
  await inserir('comercial-atrasada', 'comercial', ha(48), ha(0.1));
  await inserir('antiga-vigencia', 'antigo', ha(0.01), ha(0.01));
  await inserir('nossa-resposta', 'principal', ha(0.001), ha(0.001), 'out');
  await inserir('legado-a-antiga', 'legado-a', ha(48), ha(48));
  await inserir('legado-b-recente', 'legado-b', null, ha(1));
  const client = {
    // Só o agrupamento anterior à projeção é sintético; os dois SELECT DISTINCT ON
    // que escolhem mensagem e janela são sempre executados pelo PostgreSQL real.
    $queryRaw: q => q.sql.includes('WITH base AS')
      ? Promise.resolve(segmentos.filter(c => !c.vinculoNumeroId).map(c => ({ grupo: `legado:${c.id}`, segmentos: [c.id], instante: ha(1), naoLidas: 0 })))
      : sql.$queryRaw(q),
    conversaWhatsapp: { findUnique: async ({ where }) => segmentos.find(c => c.id === where.id),
      findMany: async ({ where }) => segmentos.filter(c => where.id?.in ? where.id.in.includes(c.id) : c.vinculoNumero?.interlocutorId === where.vinculoNumero?.interlocutorId),
      count: async () => 0 },
    contatoWhatsapp: { findMany: async () => [], count: async () => 0 },
    atendimentoLead: { findMany: async () => [] }, mensagemWhatsapp: { findMany: async () => [] },
    acaoPendenteWhatsapp: { findMany: async () => [] }, vinculoNumeroInterlocutor: { findMany: async () => [] },
    notaInternaAtendimento: { findMany: async () => [] },
  };
  async function verificar(nome, fn) {
    try { await fn(); checks.push({ nome, ok: true }); }
    catch (e) { checks.push({ nome, ok: false, erro: e.message }); }
  }
  const historico = id => lerHistoricoIdentidade({ conversaId: id, visiveis: [], client });
  await verificar('entrada atrasada não fecha o comercial', async () => {
    const r = await historico('comercial');
    assert.equal(r.conversa.janela.situacao, 'ABERTA');
    assert.equal(r.conversa.janela.instante.toISOString(), ha(1).toISOString());
  });
  await verificar('comercial e vigência anterior não abrem principal', async () => {
    assert.equal((await historico('principal')).conversa.janela.situacao, 'NUNCA_ABERTA');
  });
  await verificar('legados de outros telefones não compartilham janela na inbox', async () => {
    const r = await listarInboxWhatsapp({ visiveis: [], client });
    assert.equal(r.conversas.find(c => c.id === 'legado-a').janela.situacao, 'EXPIRADA');
    assert.equal(r.conversas.find(c => c.id === 'legado-b').janela.situacao, 'ABERTA');
  });
  await verificar('fallback sem timestamp do provedor permanece disponível', async () => {
    assert.equal((await historico('legado-b')).conversa.janela.situacao, 'ABERTA');
  });
  await verificar('ocorrência futura usa registro, não prolonga janela', async () => {
    await inserir('provedor-futuro', 'principal', ha(-3), ha(25));
    assert.equal((await historico('principal')).conversa.janela.situacao, 'EXPIRADA');
  });
  // O cliente real valida e executa a comparação Prisma entre colunas (sem mock).
  await verificar('Prisma aceita referência DateTime da partição da janela', async () => {
    const r = await sql.mensagemWhatsapp.findFirst({ where: { direcao: 'in', ocorridaEmProvedor: { lte: sql.mensagemWhatsapp.fields.registradaEm } },
      orderBy: [{ ocorridaEmProvedor: 'desc' }, { registradaEm: 'desc' }, { id: 'desc' }], select: { id: true } });
    assert.equal(r.id, 'antiga-vigencia');
  });
  fs.writeFileSync(path.join(run, 'resultado.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ checks, evidence: run }, null, 2));
  if (checks.some(c => !c.ok)) process.exitCode = 1;
} finally {
  if (sql) await sql.$disconnect();
  if (iniciou) comando('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
}
