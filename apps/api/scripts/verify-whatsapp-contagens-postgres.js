import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const url = new URL(process.argv[2] || process.env.DATABASE_URL || 'postgresql://invalid');
const local = url.hostname === '127.0.0.1' && url.port === '55443' && url.pathname === '/lead_flow_check_v2' && url.username === 'lead_test';
const ci = url.hostname === '127.0.0.1' && url.port === '55439' && url.pathname === '/whatsapp_delivery_check' && url.username === 'whatsapp_check' && url.password === 'ci_test_only';
if (!local && !ci) throw new Error('Use exclusivamente o PostgreSQL descartável local autorizado ou da CI.');
process.env.DATABASE_URL = url.href;
const bloquearRede = () => { throw new Error('Provedores HTTP externos proibidos neste teste.'); };
globalThis.fetch = bloquearRede;
http.request = http.get = https.request = https.get = bloquearRede;

const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { garantirIdentidadeWhatsapp } = await import('../src/application/whatsapp/IdentidadeComunicacaoService.js');
const { listarInboxWhatsapp, resumoInboxWhatsapp, registrarLeituraIdentidade } = await import('../src/application/whatsapp/InboxWhatsappService.js');
const rollback = new Error('ROLLBACK_CONTAGENS_TESTE');
const checks = [];
const conferir = (nome, executar) => { executar(); checks.push(nome); };
try {
  await prisma.$transaction(async tx => {
    const prefixo = `contagens-${randomUUID()}`, stamp = String(Date.now()).slice(-9);
    const empresas = [];
    for (let n = 0; n < 3; n++) empresas.push(await tx.portalClient.create({ data: { id: `${prefixo}-empresa-${n}`, razao: `Empresa sintética ${n}`, cnpj: `88${stamp}00${n}` } }));
    const visiveis = empresas.slice(0, 2).map(e => e.id), parcial = [empresas[0].id];
    const antes = await resumoInboxWhatsapp(visiveis, { client: tx });
    const antesParcial = await resumoInboxWhatsapp(parcial, { client: tx });
    const antesSemCarteira = await resumoInboxWhatsapp([], { client: tx });
    let sequencia = 0;
    async function pessoa(n) { return garantirIdentidadeWhatsapp({ telefone: `55219${stamp.slice(-6)}${n}0`, client: tx }); }
    async function conversa(ident, sufixo, dados = {}) {
      return tx.conversaWhatsapp.create({ data: { telefoneE164: ident.vinculoNumero.telefoneE164, vinculoNumeroId: ident.vinculoNumero.id,
        nomePerfilProvedor: `${prefixo} ${sufixo}`, canalId: 'principal', chaveEscopo: `sem-empresa:${prefixo}-${sufixo}`, ...dados } });
    }
    async function mensagens(c, total, dados = {}) {
      const resultado = [];
      for (let n = 0; n < total; n++) resultado.push(await tx.mensagemWhatsapp.create({ data: { conversaId: c.id, direcao: 'in', tipo: 'text', corpo: 'Entrada sintética',
        providerMessageId: `${prefixo}-${++sequencia}`, registradaEm: new Date(Date.now() - 60000 + sequencia * 100), ...dados } }));
      return resultado;
    }
    async function caso(ident, c) {
      const onboarding = await tx.onboarding.create({ data: { origem: 'ABERTURA' } });
      return tx.atendimentoLead.create({ data: { interlocutorId: ident.interlocutor.id, conversaId: c.id, onboardingId: onboarding.id } });
    }
    const cliente = await pessoa(1);
    const segmentos = [];
    for (let n = 0; n < 2; n++) {
      await tx.contatoWhatsapp.create({ data: { nome: 'Cliente sintético', ativo: true, portalClientId: empresas[n].id, telefoneE164: cliente.vinculoNumero.telefoneE164, vinculoNumeroId: cliente.vinculoNumero.id } });
      segmentos.push(await conversa(cliente, `cliente-${n}`, { portalClientId: empresas[n].id, escopoVerificado: true, chaveEscopo: `empresa:${prefixo}-${n}` }));
    }
    const neutra = await conversa(cliente, 'neutra');
    await mensagens(segmentos[0], 2); await mensagens(segmentos[1], 3);
    const neutras = await mensagens(neutra, 4);
    await mensagens(segmentos[0], 1, { direcao: 'out' });
    // A leitura é do instante da mensagem, não da última atualização do fio.
    await mensagens(segmentos[0], 1, { registradaEm: new Date('2020-01-01') });
    await tx.conversaWhatsapp.update({ where: { id: segmentos[0].id }, data: { lidaAteEm: new Date('2020-01-02') } });
    await caso(cliente, segmentos[0]); // Um novo caso não deixa de ser Cliente.
    const lead = await pessoa(2), leadPrincipal = await conversa(lead, 'lead-principal');
    const canal = await tx.canalWhatsapp.create({ data: { chave: `${prefixo}-comercial`, finalidade: 'COMERCIAL' } });
    const leadComercial = await conversa(lead, 'lead-comercial', { canalId: canal.id });
    await mensagens(leadPrincipal, 2); await mensagens(leadComercial, 3);
    const atendimentoLead = await caso(lead, leadComercial);
    const desconhecido = await pessoa(3), semNome = await conversa(desconhecido, 'a-identificar'); await mensagens(semNome, 1);
    const fora = await pessoa(4), fioFora = await conversa(fora, 'fora', { portalClientId: empresas[2].id });
    await mensagens(fioFora, 6);
    const historica = await conversa(cliente, 'historica', { portalClientId: empresas[0].id, chaveEscopo: `legado:${prefixo}` });
    await mensagens(historica, 1);
    const excluida = await conversa(cliente, 'excluida', { portalClientId: empresas[0].id, excluidaEm: new Date() });
    await mensagens(excluida, 2);

    const atual = await resumoInboxWhatsapp(visiveis, { client: tx });
    const diferenca = (resumo, base) => Object.fromEntries(Object.keys(resumo.contagensNaoLidas).map(k => [k, resumo.contagensNaoLidas[k] - base.contagensNaoLidas[k]]));
    conferir('Agrupa duas empresas e dois canais; não duplica a pessoa nem a mensagem', () => {
      assert.deepEqual(diferenca(atual, antes), { TODOS: 15, LEAD: 5, CLIENTE: 9, A_IDENTIFICAR: 1 });
      assert.equal(atual.conversas - antes.conversas, 3); assert.equal(atual.conversasNaoLidas - antes.conversasNaoLidas, 3);
    });
    conferir('Histórico, lixeira, saída e entradas já lidas ficam fora dos contadores atuais', () => {
      assert.equal(atual.historicoMensagensNaoLidas - antes.historicoMensagensNaoLidas, 1);
      assert.equal(atual.lixeiraMensagensNaoLidas - antes.lixeiraMensagensNaoLidas, 2);
    });
    const restrito = await resumoInboxWhatsapp(parcial, { client: tx });
    conferir('Carteira parcial exclui mensagens da outra empresa e recibos neutros compartilhados', () => {
      assert.deepEqual(diferenca(restrito, antesParcial), { TODOS: 8, LEAD: 5, CLIENTE: 2, A_IDENTIFICAR: 1 });
    });
    const semCarteira = await resumoInboxWhatsapp([], { client: tx });
    const listaSemCarteira = await listarInboxWhatsapp({ visiveis: [], operadorId: 'teste', q: prefixo, client: tx });
    conferir('Sem empresas visíveis permanece apenas a fila autorizada, sem revelar clientes', () => {
      assert.deepEqual(diferenca(semCarteira, antesSemCarteira), { TODOS: 6, LEAD: 5, CLIENTE: 0, A_IDENTIFICAR: 1 });
      assert.deepEqual(new Set(listaSemCarteira.conversas.map(c => c.interlocutorId)), new Set([lead.interlocutor.id, desconhecido.interlocutor.id]));
    });
    const pagina = await listarInboxWhatsapp({ visiveis, operadorId: 'teste', q: prefixo, limite: 1, client: tx });
    const vazia = await listarInboxWhatsapp({ visiveis, operadorId: 'teste', q: `${prefixo}-ausente`, relacionamento: 'LEAD', limite: 1, client: tx });
    const semFiltros = await resumoInboxWhatsapp(visiveis, { client: tx });
    conferir('Cursor, busca sem resultados e filtro da página não truncam os totais globais', () => {
      assert.equal(pagina.conversas.length, 1); assert.equal(pagina.temMais, true); assert.equal(vazia.conversas.length, 0);
      assert.deepEqual(semFiltros.contagensNaoLidas, atual.contagensNaoLidas);
    });
    const lista = await listarInboxWhatsapp({ visiveis, operadorId: 'teste', q: prefixo, limite: 100, client: tx });
    conferir('Cada categoria coincide com as linhas da inbox, incluindo cliente com caso de abertura', () => {
      const somas = { TODOS: 0, LEAD: 0, CLIENTE: 0, A_IDENTIFICAR: 0 };
      for (const c of lista.conversas) { somas.TODOS += c.naoLidas; somas[c.relacionamento.tipo] += c.naoLidas; }
      assert.deepEqual(somas, diferenca(atual, antes));
    });
    const atendimento = await tx.atendimentoResponsavelWhatsapp.create({ data: { telefoneE164: cliente.vinculoNumero.telefoneE164, canal: `${prefixo}-sessao` } });
    await tx.resolucaoContextoWhatsapp.create({ data: { mensagemId: neutras[0].id, atendimentoId: atendimento.id, conversaId: segmentos[0].id, portalClientId: empresas[0].id, versao: 1, estado: 'RESOLVIDA' } });
    const resolvido = await resumoInboxWhatsapp(parcial, { client: tx });
    const resolvidoCompleto = await resumoInboxWhatsapp(visiveis, { client: tx });
    conferir('Resolução de contexto usa o destino autorizado e conta o recibo uma única vez', () => {
      assert.equal(resolvido.contagensNaoLidas.CLIENTE, restrito.contagensNaoLidas.CLIENTE + 1);
      assert.deepEqual(resolvidoCompleto.contagensNaoLidas, atual.contagensNaoLidas);
    });
    await registrarLeituraIdentidade({ conversaId: segmentos[0].id, mensagemId: neutras.at(-1).id, visiveis, client: tx });
    const lido = await resumoInboxWhatsapp(visiveis, { client: tx });
    conferir('Reconhecer leitura no grupo reduz os totais sem apagar pendências de outros contatos', () => {
      assert.deepEqual(diferenca(lido, antes), { TODOS: 6, LEAD: 5, CLIENTE: 0, A_IDENTIFICAR: 1 });
    });
    await tx.atendimentoLead.update({ where: { id: atendimentoLead.id }, data: { encerradoEm: new Date() } });
    const encerrado = await resumoInboxWhatsapp(visiveis, { client: tx });
    conferir('Encerrar o único caso altera a categoria sem perder mensagens não lidas', () => {
      assert.deepEqual(diferenca(encerrado, antes), { TODOS: 6, LEAD: 0, CLIENTE: 0, A_IDENTIFICAR: 6 });
    });
    const listar = extras => listarInboxWhatsapp({ visiveis, operadorId: 'teste', q: prefixo, client: tx, ...extras });
    const ordemEsperada = [desconhecido.interlocutor.id, lead.interlocutor.id, cliente.interlocutor.id];
    const aposLeitura = await listar();
    conferir('Leitura, encerramento e cadastro não promovem conversas sem mensagem nova', () => {
      assert.deepEqual(aposLeitura.conversas.map(c => c.interlocutorId), ordemEsperada);
    });
    const paginados = [];
    let cursor = null;
    do {
      const paginaOrdenada = await listar({ limite: 1, cursor });
      paginados.push(...paginaOrdenada.conversas.map(c => c.interlocutorId));
      cursor = paginaOrdenada.proximoCursor;
    } while (cursor);
    conferir('Paginação usa a última mensagem antes do limite, sem repetir nem pular contatos', () => {
      assert.deepEqual(paginados, ordemEsperada);
    });
    await mensagens(segmentos[0], 1, { direcao: 'out', registradaEm: new Date() });
    const aposSaida = await listar();
    conferir('Resposta enviada coloca o cliente no topo, mesmo com leads não lidos', () => {
      assert.equal(aposSaida.conversas[0].interlocutorId, cliente.interlocutor.id);
    });
    await mensagens(leadComercial, 1, { registradaEm: new Date(Date.now() + 1000) });
    const aposEntrada = await listar();
    conferir('Nova entrada em outro canal coloca a pessoa no topo sem duplicá-la', () => {
      assert.equal(aposEntrada.conversas[0].interlocutorId, lead.interlocutor.id);
      assert.equal(aposEntrada.conversas.length, 3);
    });
    throw rollback;
  }, { timeout: 60000 });
} catch (err) { if (err !== rollback) throw err; }
finally { await prisma.$disconnect(); }
console.log(JSON.stringify({ ok: true, checks, total: checks.length, redeExterna: false, transacaoRevertida: true }, null, 2));
