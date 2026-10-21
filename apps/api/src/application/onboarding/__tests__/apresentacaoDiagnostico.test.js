jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarApresentacaoDiagnostico } from '../ApresentacaoDiagnosticoService.js';
import { apresentarDiagnostico, gerarApresentacaoDiagnosticoPdf } from '../ApresentacaoDiagnosticoPdf.js';
import { carregarEvidenciasJornada } from '../JornadaLeadService.js';
import { createHash } from 'node:crypto';

const user = { id: 'contador', role: 'contador' };
const clone = v => structuredClone(v);
function setup() {
  const ficha = { id: 'o', cnpj: '11222333000181', versao: 3, status: 'RASCUNHO', origem: 'TRANSFERENCIA', dados: { razaoSocial: 'Empresa sintética', cadastroCnpj: { fonte: 'Cadastro público', municipio: 'Rio de Janeiro' } } };
  const diagnostico = { id: 'diag', createdAt: '2026-10-21T12:00:00Z', dados: { servicos: 'Serviços contábeis de teste', dispensaConsultaPrivada: 'Consulta indisponível; dados fiscais a conferir.', devolutiva: { certo: 'Cadastro conferido pelo escritório.', atencao: 'Situação fiscal ainda não consultada.', corrigir: 'Conferir documentos e obrigações.' }, roteiro: { dados: { notasEmitidasMes: 0 } } } };
  const conversa = { id: 'c', canalId: 'comercial', telefoneE164: '5511999990000', vinculoNumeroId: null, portalClientId: null };
  const caso = { id: 'caso', onboardingId: 'o', conversaId: 'c', encerradoEm: null };
  const mensagens = [], analises = [];
  const eventos = [];
  const db = {
    onboarding: { findUnique: jest.fn(async ({ where }) => where.id === ficha.id ? clone(ficha) : null), updateMany: jest.fn(async ({ where }) => ({ count: where.versao === ficha.versao && !where.status.notIn.includes(ficha.status) ? 1 : 0 })) },
    onboardingEvento: { findFirst: jest.fn(async () => eventos.at(-1) || null), create: jest.fn(async ({ data }) => { const e = { ...data, id: `evento-${eventos.length}`, createdAt: new Date() }; eventos.push(e); return e; }) },
    atendimentoLead: { findFirst: jest.fn(async () => clone(caso)) },
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => where.id === conversa.id ? clone(conversa) : null), update: jest.fn(async ({ data }) => Object.assign(conversa, data)) },
    canalWhatsapp: { findUnique: jest.fn(async () => ({ ativo: true, finalidade: 'COMERCIAL' })) },
    contatoWhatsapp: { findFirst: jest.fn(async () => null) },
    mensagemWhatsapp: { findMany: jest.fn(async ({ where }) => clone(mensagens.filter(m => m.referenciaComercial.apresentacaoChave === where.referenciaComercial.equals))) },
  };
  db.$transaction = fn => fn(db);
  const enviarDocumento = jest.fn(async () => ({ wamid: 'teste' }));
  const enviarRastreada = jest.fn(async args => { await args.antesDeEnviar(); await args.enviar(); const mensagem = { id: 'm', conversaId: args.conversa.id, statusEnvio: 'enviado', referenciaComercial: args.referenciaComercial }; mensagens.push(mensagem); return { mensagem }; });
  const deps = { db, jornada: jest.fn(async () => ({ diagnostico: clone(diagnostico), diagnosticoPendencias: [], analises: clone(analises) })), gerarPdf: jest.fn(async () => Buffer.from('%PDF-fixture')), fiscal: { conferirEnvioFiscal: jest.fn(async () => 'prova') },
    janela: jest.fn(async () => ({ situacao: 'ABERTA' })), transportePara: jest.fn(async () => ({ enviarDocumento })), enviarRastreada,
    leases: { adquirir: jest.fn(async () => ({ id: 'lease' })), renovar: jest.fn(async () => true), liberar: jest.fn(async () => {}) } };
  return { ficha, diagnostico, caso, conversa, db, deps, mensagens, analises, eventos, enviarDocumento, s: criarApresentacaoDiagnostico(deps) };
}
async function body(t) { return { conteudoHash: (await t.s.carregar('o', user)).conteudoHash, conversaId: 'c' }; }

test('conferência explícita persiste autor/data/hash e libera projeção sem envio; repetição é idempotente', async () => {
  const t = setup();
  t.diagnostico.dados.contexto = createHash('sha256').update(JSON.stringify(['TRANSFERENCIA', t.ficha.cnpj, null, null, null, null])).digest('hex');
  const b = { ...await body(t), versao: 3, confirmado: true };
  await t.s.documento('o', 'diag', user, b.conteudoHash);
  expect(t.eventos).toHaveLength(0);
  const r = await t.s.conferir('o', 'diag', user, b);
  expect(r.conferencia).toMatchObject({ atorId: user.id, createdAt: expect.any(Date), dados: { origem: 'PDF_CONTADOR', diagnosticoId: 'diag', conteudoHash: b.conteudoHash, enviadoAoCliente: false } });
  expect(await t.s.conferir('o', 'diag', user, b)).toMatchObject({ jaConferida: true });
  expect(t.eventos).toHaveLength(1); expect(t.deps.enviarRastreada).not.toHaveBeenCalled();
  const leituras = { analises: [], registros: [t.diagnostico], conferencias: [], apresentacoes: t.eventos, saidas: [] };
  expect((await carregarEvidenciasJornada(t.ficha, t.db, leituras)).devolutiva).toMatchObject({ concluida: true, conferenciaPdf: { id: r.conferencia.id }, apresentacaoEnviada: null });
  t.ficha.versao++;
  expect((await carregarEvidenciasJornada(t.ficha, t.db, leituras)).devolutiva.concluida).toBe(true);
  t.diagnostico.dados.servicos = 'Escopo revisado';
  expect((await carregarEvidenciasJornada(t.ficha, t.db, leituras)).devolutiva.concluida).toBe(false);
});

test.each(['confirmacao', 'versao', 'hash', 'diagnostico', 'permissao', 'encerrado'])('conferência recusa %s inválida sem persistência', async motivo => {
  const t = setup(), b = { ...await body(t), versao: 3, confirmado: true };
  if (motivo === 'confirmacao') b.confirmado = false;
  if (motivo === 'versao') b.versao = 2;
  if (motivo === 'hash') b.conteudoHash = 'antigo';
  if (motivo === 'encerrado') t.ficha.status = 'DESISTIU';
  await expect(t.s.conferir('o', motivo === 'diagnostico' ? 'outra' : 'diag', motivo === 'permissao' ? { role: 'cliente' } : user, b)).rejects.toBeTruthy();
  expect(t.eventos).toHaveLength(0);
});

test('envio da apresentação alimenta projeção vigente sem conferir versões antigas', async () => {
  const t = setup();
  t.diagnostico.dados.contexto = createHash('sha256').update(JSON.stringify(['TRANSFERENCIA', t.ficha.cnpj, null, null, null, null])).digest('hex');
  await t.s.enviar('o', 'diag', user, await body(t));
  const leituras = { analises: [], registros: [t.diagnostico], conferencias: [], apresentacoes: [], saidas: t.mensagens };
  const j = await carregarEvidenciasJornada(t.ficha, t.db, leituras);
  expect(j.devolutiva.concluida).toBe(true);
  expect(j.devolutiva.apresentacaoEnviada.id).toBe('m');
  t.ficha.dados.cadastroRevisao = 1;
  expect((await carregarEvidenciasJornada(t.ficha, t.db, leituras)).devolutiva.concluida).toBe(false);
});

test('download usa diagnóstico vigente e limitações sem consultar provedor ou marcar envio', async () => {
  const t = setup(); const b = await body(t);
  expect((await t.s.documento('o', 'diag', user, b.conteudoHash)).toString()).toBe('%PDF-fixture');
  expect(t.deps.gerarPdf).toHaveBeenCalledWith(expect.objectContaining({ limitacao: t.diagnostico.dados.dispensaConsultaPrivada, fonteFiscal: expect.stringContaining('Sem consulta fiscal oficial') }));
  expect(t.deps.fiscal.conferirEnvioFiscal).not.toHaveBeenCalled(); expect(t.deps.enviarRastreada).not.toHaveBeenCalled();
});
test('envio é rastreado por ficha, diagnóstico e conteúdo; repetição não envia novamente', async () => {
  const t = setup(); const b = await body(t);
  expect(await t.s.enviar('o', 'diag', user, b)).toMatchObject({ enviado: true });
  expect(await t.s.enviar('o', 'diag', user, b)).toMatchObject({ jaEnviado: true });
  expect(t.enviarDocumento).toHaveBeenCalledTimes(1);
  expect(t.mensagens[0].referenciaComercial).toMatchObject({ onboardingId: 'o', diagnosticoId: 'diag', parte: 'APRESENTACAO', fichaVersao: 3, apresentacaoChave: b.conteudoHash });
});
test.each(['enviando', 'indeterminado', 'estado_desconhecido'])('resultado %s nunca autoriza repetição', async statusEnvio => {
  const t = setup(); const b = await body(t); t.mensagens.push({ statusEnvio, referenciaComercial: { apresentacaoChave: b.conteudoHash } });
  await expect(t.s.enviar('o', 'diag', user, b)).rejects.toMatchObject({ code: 'envio_incerto' }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test.each(['diagnostico', 'ficha', 'cnpj'])('mudança de %s após prévia bloqueia documento antigo', async alvo => {
  const t = setup(); const b = await body(t);
  if (alvo === 'diagnostico') t.diagnostico.dados.servicos = 'Escopo alterado';
  if (alvo === 'ficha') t.ficha.versao++;
  if (alvo === 'cnpj') t.ficha.cnpj = '04252011000110';
  await expect(t.s.enviar('o', 'diag', user, b)).rejects.toMatchObject({ code: 'apresentacao_alterada' }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('troca durante geração invalida download e envio', async () => {
  const t = setup(); const b = await body(t); t.deps.gerarPdf.mockImplementation(async () => { t.diagnostico.id = 'nova'; return Buffer.from('%PDF'); });
  await expect(t.s.documento('o', 'diag', user, b.conteudoHash)).rejects.toMatchObject({ code: 'diagnostico_alterado' });
  expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('troca de destino durante geração impede envio', async () => {
  const t = setup(); const b = await body(t); t.deps.gerarPdf.mockImplementation(async () => { t.conversa.telefoneE164 = '5511888880000'; return Buffer.from('%PDF'); });
  await expect(t.s.enviar('o', 'diag', user, b)).rejects.toMatchObject({ code: 'destino_alterado' }); expect(t.enviarDocumento).not.toHaveBeenCalled(); expect(t.deps.leases.liberar).toHaveBeenCalled();
});
test('permissão, outra ficha, diagnóstico antigo e hash ausente são recusados', async () => {
  const t = setup();
  await expect(t.s.carregar('o', { id: 'cliente', role: 'cliente' })).rejects.toMatchObject({ status: 403 });
  await expect(t.s.carregar('outra', user)).rejects.toMatchObject({ status: 404 });
  await expect(t.s.documento('o', 'antigo', user, 'hash')).rejects.toMatchObject({ code: 'diagnostico_alterado' });
  await expect(t.s.enviar('o', 'diag', user, {})).rejects.toMatchObject({ code: 'apresentacao_alterada' });
});
test.each(['janela', 'lease'])('bloqueio de %s impede rede', async motivo => {
  const t = setup(); const b = await body(t);
  if (motivo === 'janela') t.deps.janela.mockResolvedValue({ situacao: 'FECHADA' }); else t.deps.leases.adquirir.mockResolvedValue(null);
  await expect(t.s.enviar('o', 'diag', user, b)).rejects.toMatchObject({ status: 409 }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('SITFIS conserva guardas e recusa relatório de outro CNPJ', async () => {
  const t = setup(); t.diagnostico.dados.analiseId = 'f';
  t.analises.push({ id: 'f', cnpj: t.ficha.cnpj, tipo: 'SITFIS', status: 'CONCLUIDA', createdAt: '2026-10-20', resultado: { relatorioDisponivel: true, leitura: { relatorio: { contribuinte: { cnpj: t.ficha.cnpj }, diagnosticos: [] } } } });
  const b = await body(t); t.deps.fiscal.conferirEnvioFiscal.mockRejectedValue(Object.assign(new Error('revogada'), { code: 'procuracao_nao_verificada' }));
  await expect(t.s.enviar('o', 'diag', user, b)).rejects.toMatchObject({ code: 'procuracao_nao_verificada' });
  t.analises[0].resultado.leitura.relatorio.contribuinte.cnpj = '04252011000110';
  await expect(t.s.carregar('o', user)).rejects.toMatchObject({ code: 'relatorio_cnpj_divergente' }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('PDF real inclui dados e zero declarado; projeção não vaza campos internos', async () => {
  const t = setup(); t.ficha.dados.tokenInterno = 'segredo'; t.diagnostico.dados.triagem = { segredo: true };
  const p = apresentarDiagnostico({ ficha: t.ficha, diagnostico: t.diagnostico });
  expect(p.roteiro).toContainEqual(['Notas emitidas por mês', 0]); expect(JSON.stringify(p)).not.toContain('segredo');
  const pdf = await gerarApresentacaoDiagnosticoPdf(p);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.length).toBeGreaterThan(2000);
});
test('apresentação preserva situação fiscal manual integral, identificada como declaração', () => {
  const t = setup(); t.diagnostico.dados.fiscalAlternativa = { dados: { modo: 'MANUAL', informacao: 'Há pendência declarada pelo contador, ainda sem comprovação oficial.' } };
  const p = apresentarDiagnostico({ ficha: t.ficha, diagnostico: t.diagnostico });
  expect(p.situacaoManual).toBe(t.diagnostico.dados.fiscalAlternativa.dados.informacao); expect(p.fiscal).toBeNull(); expect(p.fonteFiscal).toContain('Sem consulta fiscal oficial válida');
});
