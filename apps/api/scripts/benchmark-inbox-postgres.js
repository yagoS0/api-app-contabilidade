// Compara os dois leitores reais na mesma base sintética, sem HTTP ou provedor externo.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === '55443'
  && url.pathname === '/comunicacao_v2_check' && url.username === 'lead_test', 'Benchmark exclusivo do banco local descartável.');
globalThis.fetch = () => { throw new Error('Rede externa proibida.'); };
const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { createWhatsappConversasRouter } = await import('../src/routes/firm/whatsappConversas.js');
const prefixo = 'bench-inbox-' + randomUUID();
const ids = Array.from({ length: 200 }, (_, i) => prefixo + '-' + i);
const pessoa = i => 'p-' + i, vinculo = i => 'v-' + i;
let medir = false, consultas = 0, perfil = [];
prisma.$use(async (p, next) => { const ativo = medir, t = performance.now(); if (ativo) consultas++; const r = await next(p); if (ativo) perfil.push({ comando: (p.model || String(p.args?.[0]?.sql || p.args?.query || p.args?.[0] || "raw").slice(0,70)) + "." + p.action, ms: Math.round(performance.now() - t) }); return r; });
const companhia = await prisma.portalClient.create({ data: { cnpj: String(Date.now()).padStart(14, '0'), razao: prefixo } });
try {
  await prisma.interlocutorComunicacao.createMany({ data: ids.map(id => ({ id: pessoa(id) })) });
  await prisma.vinculoNumeroInterlocutor.createMany({ data: ids.map((id, n) => ({ id: vinculo(id), interlocutorId: pessoa(id), telefoneE164: '5511998' + String(n).padStart(6, '0') })) });
  await prisma.contatoWhatsapp.createMany({ data: ids.map((id, n) => ({ nome: prefixo + ' ' + n, portalClientId: companhia.id, telefoneE164: '5511998' + String(n).padStart(6, '0'), vinculoNumeroId: vinculo(id), ativo: true })) });
  await prisma.conversaWhatsapp.createMany({ data: ids.map((id, n) => ({ id, chaveEscopo: 'empresa:' + id, portalClientId: companhia.id, telefoneE164: '5511998' + String(n).padStart(6, '0'), escopoVerificado: true, canalId: 'principal', vinculoNumeroId: vinculo(id) })) });
  await prisma.mensagemWhatsapp.createMany({ data: ids.flatMap(id => Array.from({ length: 10 }, (_, n) => ({ conversaId: id, providerMessageId: id + '-m' + n, direcao: n % 2 ? 'out' : 'in', tipo: 'text', corpo: 'Mensagem sintética ' + n, registradaEm: new Date(Date.now() - n * 1000), ocorridaEmProvedor: new Date(Date.now() - n * 1000) }))) });
  // Dar ao planejador estatísticas da fixture; sem isso o PostgreSQL ainda estima o banco vazio.
  for (const tabela of ['conversas_whatsapp', 'mensagens_whatsapp', 'vinculos_numero_interlocutor', 'contatos_whatsapp', 'resolucoes_contexto_whatsapp', 'atendimentos_lead']) {
    await prisma.$executeRawUnsafe('ANALYZE "' + tabela + '"');
  }
  const resultados = [];
  for (const v2 of [false, true]) {
    const router = createWhatsappConversasRouter({ chatV2: v2 });
    const handle = router.stack.find(s => s.route?.path === '/whatsapp/conversas' && s.route.methods.get).route.stack[0].handle;
    for (const limite of [10, 100]) {
      const amostras = [], leituras = [];
      for (let n = 0; n < 9; n++) {
        consultas = 0; perfil = [];
        const req = { auth: { user: { id: 'benchmark-operador', role: 'admin', status: 'active', accountType: 'FIRM' } }, query: { limite: String(limite), empresa: companhia.id, v2: v2 ? '1' : '0' }, params: {} };
        let resposta, status = 200;
        const res = { status(s) { status = s; return this; }, json(body) { resposta = body; return this; } };
        medir = true;
        const inicio = performance.now();
        await handle(req, res);
        const duracao = performance.now() - inicio;
        medir = false;
        assert.equal(status, 200); assert.equal(resposta?.ok, true);
        assert.equal(resposta.conversas.length, limite);
        if (n) { amostras.push(duracao); leituras.push(consultas); }
      }
      amostras.sort((a, b) => a - b);
      resultados.push({ leitor: v2 ? 'v2' : 'legado', limite, amostras: amostras.length,
        p95Ms: Math.round(amostras[Math.ceil(amostras.length * .95) - 1] * 10) / 10,
        comandosMin: Math.min(...leituras), comandosMax: Math.max(...leituras), ...(v2 ? { perfilUltima: perfil } : {}) });
    }
  }
  const novos = resultados.filter(r => r.leitor === 'v2');
  assert.equal(novos[0].comandosMax, novos[1].comandosMax, 'Quantidade de consultas V2 não pode crescer por linha.');
  console.log(JSON.stringify({ pessoas: ids.length, mensagens: ids.length * 10, resultados }, null, 2));
} finally {
  medir = false;
  await prisma.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: ids } } });
  await prisma.conversaWhatsapp.deleteMany({ where: { id: { in: ids } } });
  await prisma.contatoWhatsapp.deleteMany({ where: { portalClientId: companhia.id } });
  await prisma.vinculoNumeroInterlocutor.deleteMany({ where: { id: { in: ids.map(vinculo) } } });
  await prisma.interlocutorComunicacao.deleteMany({ where: { id: { in: ids.map(pessoa) } } });
  await prisma.portalClient.delete({ where: { id: companhia.id } });
  await prisma.$disconnect();
}
