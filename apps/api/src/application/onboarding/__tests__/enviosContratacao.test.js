jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarContratoEnvio } from '../ContratoEnvioService.js';
import { criarCobrancaEnvio } from '../CobrancaEnvioService.js';
import { createHash } from 'node:crypto';
const user = { id: 'contador', role: 'contador' };
const clone = v => structuredClone(v);
function setup() {
  const ficha = { id: 'o', origem: 'TRANSFERENCIA', cnpj: '11222333000181', versao: 3, status: 'RASCUNHO', dados: { cadastroRevisao: 1, regimeAtual: 'SIMPLES', notasEmitidasMes: 10 } };
  const proposta = { id: 'p', onboardingId: 'o', versao: 2, status: 'ACEITA', opcaoAceita: 'mensal', snapshot: { diagnosticoId: 'd', cadastroRevisao: 1 } };
  const contrato = { id: 'ct', propostaId: 'p', proposta, modeloId: 'modelo', texto: 'Contrato sintético', aprovadoEm: '2026-10-21', status: 'AGUARDANDO_ASSINATURA', dados: { modeloVersao: 1, opcao: { chave: 'mensal' } } };
  const diagnostico = { id: 'd', dados: { cadastroRevisao: 1, roteiro: { versao: 1 }, perfilConferido: { regime: 'SIMPLES', notasEmitidasMes: 10 },
    contexto: createHash('sha256').update(JSON.stringify(['TRANSFERENCIA', '11222333000181', null, null, null, null, 'CADASTRO_REVISAO', 1, 'ROTEIRO', 1, [['notasEmitidasMes', 10], ['regime', 'SIMPLES']]])).digest('hex') } };
  const cobranca = { id: 'cb', dados: { contratoId: 'ct', propostaId: 'p', propostaVersao: 2, contextoContrato: 'contexto-vigente', url: 'https://asaas.com/cobranca-teste' } };
  const conversa = { id: 'c', canalId: 'comercial', telefoneE164: '5511999990000', vinculoNumeroId: null };
  const caso = { id: 'caso', conversaId: 'c' }, mensagens = [], eventos = [];
  const db = {
    onboarding: { findUnique: jest.fn(async () => clone(ficha)), updateMany: jest.fn(async ({ where }) => ({ count: where.versao === ficha.versao ? 1 : 0 })) },
    contratoComercial: { findFirst: jest.fn(async ({ where }) => where.id === 'ct' && where.onboardingId === 'o' ? clone(contrato) : null) },
    recursoComercial: { findUnique: jest.fn(async () => ({ aprovadoEm: '2026-10-21', versao: 1 })) },
    onboardingAnalise: { findMany: jest.fn(async () => []) },
    onboardingEvento: { findMany: jest.fn(async ({ where }) => where.tipo === 'JORNADA_DIAGNOSTICO' ? [clone(diagnostico)] : []), findFirst: jest.fn(async ({ where }) => where.tipo === 'JORNADA_DIAGNOSTICO' ? clone(diagnostico) : where.tipo === 'COBRANCA_EXTERNA_REGISTRADA' ? clone(cobranca) : eventos.find(e => e.dados.chave === where.dados.equals) || null), create: jest.fn(async ({ data }) => { const e = { ...data, id: 'evt' }; eventos.push(e); return e; }) },
    documentoOnboarding: { findFirst: jest.fn(async () => null) },
    atendimentoLead: { findFirst: jest.fn(async () => clone(caso)) },
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => where.id === 'c' ? clone(conversa) : null), update: jest.fn(async ({ data }) => Object.assign(conversa, data)) },
    canalWhatsapp: { findUnique: jest.fn(async () => ({ ativo: true, finalidade: 'COMERCIAL' })) }, contatoWhatsapp: { findFirst: jest.fn(async () => null) },
    mensagemWhatsapp: { findMany: jest.fn(async ({ where }) => clone(mensagens.filter(m => m.referenciaComercial.envioComercialChave === where.referenciaComercial.equals))) },
  };
  db.$transaction = fn => fn(db);
  const enviarDocumento = jest.fn(async () => ({ wamid: 'mock' })), enviarTexto = jest.fn(async () => ({ wamid: 'mock' }));
  const deps = { db, gerarPdf: jest.fn(async () => Buffer.from('%PDF-sintetico')), politica: { contextoContrato: jest.fn(() => 'contexto-vigente'), urlCobrancaSegura: jest.fn(v => v === cobranca.dados.url ? v : null) },
    decifrar: jest.fn(async () => null), janela: jest.fn(async () => ({ situacao: 'ABERTA' })), transportePara: jest.fn(async () => ({ enviarDocumento, enviarTexto })),
    enviarRastreada: jest.fn(async args => { await args.antesDeEnviar(); await args.enviar({ antesDeEnviar: args.antesDeEnviar }); const mensagem = { id: 'm' + mensagens.length, conversaId: 'c', statusEnvio: 'enviado', referenciaComercial: args.referenciaComercial }; mensagens.push(mensagem); return { mensagem }; }),
    leases: { adquirir: jest.fn(async () => ({ id: 'lease' })), renovar: jest.fn(async () => true), liberar: jest.fn(async () => {}) } };
  return { ficha, contrato, proposta, diagnostico, cobranca, conversa, db, deps, mensagens, eventos, enviarDocumento, enviarTexto, ct: criarContratoEnvio(deps), cb: criarCobrancaEnvio(deps) };
}
const body = { versao: 3, contratoId: 'ct', cobrancaId: 'cb', modo: 'ALTAN', conversaId: 'c' };
test('contrato aprovado envia PDF rastreado sem marcar assinatura; replay não envia', async () => {
  const t = setup(); const b = { conteudoHash: (await t.ct.carregar('o', 'ct', user)).conteudoHash, conversaId: 'c' };
  expect(await t.ct.enviar('o', 'ct', user, b)).toMatchObject({ enviado: true }); expect(await t.ct.enviar('o', 'ct', user, b)).toMatchObject({ jaEnviado: true });
  expect(t.enviarDocumento).toHaveBeenCalledTimes(1); expect(t.enviarDocumento.mock.calls[0][0].antesDeEnviar).toEqual(expect.any(Function));
  expect(t.mensagens[0].referenciaComercial).toMatchObject({ tipo: 'CONTRATO_COMERCIAL', contratoId: 'ct', propostaId: 'p', onboardingId: 'o' }); expect(t.contrato.status).toBe('AGUARDANDO_ASSINATURA');
});
test.each(['minuta', 'revogada', 'diagnostico', 'cadastro', 'modelo', 'regime', 'volumes'])('contrato %s bloqueia envio', async alvo => {
  const t = setup(); const b = { conteudoHash: (await t.ct.carregar('o', 'ct', user)).conteudoHash };
  if (alvo === 'minuta') t.contrato.status = 'MINUTA'; if (alvo === 'revogada') t.proposta.revogadaEm = '2026-10-21';
  if (alvo === 'diagnostico') t.diagnostico.id = 'novo'; if (alvo === 'cadastro') t.ficha.dados.cadastroRevisao++;
  if (alvo === 'modelo') t.db.recursoComercial.findUnique.mockResolvedValue({ versao: 2, aprovadoEm: '2026-10-21' });
  if (alvo === 'regime') t.ficha.dados.regimeAtual = 'LUCRO_PRESUMIDO'; if (alvo === 'volumes') t.ficha.dados.notasEmitidasMes = 50;
  await expect(t.ct.enviar('o', 'ct', user, b)).rejects.toMatchObject({ status: 409 }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('alteração entre gerar PDF e enviar impede rede e libera lease', async () => {
  const t = setup(); const b = { conteudoHash: (await t.ct.carregar('o', 'ct', user)).conteudoHash };
  t.deps.gerarPdf.mockImplementation(async () => { t.contrato.texto = 'Alterado'; return Buffer.from('%PDF'); });
  await expect(t.ct.enviar('o', 'ct', user, b)).rejects.toMatchObject({ code: 'contrato_alterado' }); expect(t.enviarDocumento).not.toHaveBeenCalled(); expect(t.deps.leases.liberar).toHaveBeenCalled();
});
test('incerteza de contrato impede repetição', async () => {
  const t = setup(); const b = { conteudoHash: (await t.ct.carregar('o', 'ct', user)).conteudoHash };
  t.mensagens.push({ statusEnvio: 'indeterminado', referenciaComercial: { envioComercialChave: b.conteudoHash } });
  await expect(t.ct.enviar('o', 'ct', user, b)).rejects.toMatchObject({ code: 'envio_incerto' }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('cobrança salva envia link uma vez sem confirmar pagamento', async () => {
  const t = setup(); expect(await t.cb.enviar('o', user, body)).toMatchObject({ enviado: true }); expect(await t.cb.enviar('o', user, body)).toMatchObject({ jaEnviado: true });
  expect(t.enviarTexto).toHaveBeenCalledTimes(1); expect(t.enviarTexto.mock.calls[0][0].texto).toContain('https://asaas.com/cobranca-teste'); expect(t.eventos).toHaveLength(0);
});
test.each(['versao', 'cobranca', 'contrato', 'url', 'documento'])('cobrança inválida por %s não envia', async alvo => {
  const t = setup(); const b = { ...body };
  if (alvo === 'versao') b.versao = 2; if (alvo === 'cobranca') b.cobrancaId = 'antiga'; if (alvo === 'contrato') t.cobranca.dados.contextoContrato = 'antigo';
  if (alvo === 'url') t.deps.politica.urlCobrancaSegura.mockReturnValue(null); if (alvo === 'documento') { t.cobranca.dados.documentoId = 'outro'; t.cobranca.dados.url = null; }
  await expect(t.cb.enviar('o', user, b)).rejects.toMatchObject({ status: 409 }); expect(t.enviarTexto).not.toHaveBeenCalled();
});
test('envio externo registra declaração auditada idempotente, não entrega nem pagamento', async () => {
  const t = setup(); const b = { ...body, modo: 'EXTERNO', canal: 'WHATSAPP' };
  expect(await t.cb.enviar('o', user, b)).toMatchObject({ registrado: true, pagamentoConfirmado: false, envio: { estado: 'INFORMADO_EXTERNAMENTE' } });
  await t.cb.enviar('o', user, b); expect(t.eventos).toHaveLength(1); expect(t.eventos[0]).toMatchObject({ atorId: 'contador', dados: { origem: 'DECLARACAO_CONTADOR', entregaComprovada: false } }); expect(t.enviarTexto).not.toHaveBeenCalled();
});
test('cobrança PDF usa documento da mesma ficha e confere hash antes do transporte', async () => {
  const t = setup(); const pdf = Buffer.from('%PDF-comprovante-sintetico');
  t.cobranca.dados.url = null; t.cobranca.dados.documentoId = 'doc';
  t.db.documentoOnboarding.findFirst.mockImplementation(async ({ where }) => where.id === 'doc' && where.onboardingId === 'o' ? { id: 'doc', nome: 'cobranca.pdf', mime: 'application/pdf', conteudoCifrado: 'cifra', sha256: createHash('sha256').update(pdf).digest('hex') } : null);
  t.deps.decifrar.mockResolvedValue(pdf.toString('base64'));
  expect(await t.cb.enviar('o', user, body)).toMatchObject({ enviado: true });
  expect(t.enviarDocumento).toHaveBeenCalledWith(expect.objectContaining({ conteudo: pdf, nomeArquivo: 'cobranca.pdf', antesDeEnviar: expect.any(Function) }));
  expect(t.enviarTexto).not.toHaveBeenCalled();
});
test('alteração da cobrança após preparar transporte impede envio', async () => {
  const t = setup(); t.deps.transportePara.mockImplementation(async () => { t.cobranca.id = 'nova'; return { enviarTexto: t.enviarTexto }; });
  await expect(t.cb.enviar('o', user, body)).rejects.toMatchObject({ code: 'cobranca_alterada' }); expect(t.enviarTexto).not.toHaveBeenCalled();
});
test('troca de telefone antes de assumir atendimento não redefine o destinatário autorizado', async () => {
  const t = setup(); t.deps.transportePara.mockImplementation(async () => { t.conversa.telefoneE164 = '5511888880000'; return { enviarTexto: t.enviarTexto }; });
  await expect(t.cb.enviar('o', user, body)).rejects.toMatchObject({ code: 'destino_alterado' }); expect(t.enviarTexto).not.toHaveBeenCalled();
});
test('janela fechada, destino trocado e cliente não autorizam saídas', async () => {
  const t = setup(); t.deps.janela.mockResolvedValue({ situacao: 'FECHADA' });
  await expect(t.cb.enviar('o', user, body)).rejects.toMatchObject({ code: 'FORA_DA_JANELA' });
  await expect(t.cb.enviar('o', { id: 'cliente', role: 'cliente' }, body)).rejects.toMatchObject({ status: 403 });
  await expect(t.cb.enviar('o', user, { ...body, conversaId: 'outra' })).rejects.toMatchObject({ code: 'canal_comercial_necessario' }); expect(t.enviarTexto).not.toHaveBeenCalled();
});
