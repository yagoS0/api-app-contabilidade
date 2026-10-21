jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarFiscalLead } from '../FiscalLeadService.js';
import { criarJornadaLead } from '../JornadaLeadService.js';
import { criarPropostasComerciais } from '../PropostasComerciaisService.js';
import { montarJornadaComercial } from '../PoliticaJornadaComercial.js';
import { projetarContratacao, contextoContrato, urlCobrancaSegura } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
import { evidenciasDiagnostico } from '../ProjecaoComercialService.js';

const user = { id: 'contador-teste', role: 'contador' };

test('ficha inicial sem autorização não lança TypeError nem inventa procuração', () => {
  const onboarding = { origem: 'ABERTURA', dados: {} };
  expect(() => montarJornadaComercial({ onboarding })).not.toThrow();
  expect(evidenciasDiagnostico(onboarding, {}, null)).toEqual([]);
});

test.each(['ficha', 'atendimento'])('procuração manual em %s exige mesma revisão cadastral', origem => {
  const ficha = { id: 'o', origem: 'TRANSFERENCIA', cnpj: '11222333000181', dados: { cadastroRevisao: 0 } };
  const manual = { cnpj: ficha.cnpj, atorId: user.id, registradaEm: '2026-10-21', cadastroRevisao: 0 };
  const atendimento = origem === 'atendimento' ? { id: 'a', autorizacao: { cnpj: ficha.cnpj, estado: 'NAO_VERIFICADA', validacaoManual: manual } } : null;
  if (origem === 'ficha') ficha.dados.procuracaoManual = manual;
  const concluida = () => montarJornadaComercial({ onboarding: ficha, atendimento }).passos.find(p => p.id === 'autorizacao').concluido;
  const provas = () => evidenciasDiagnostico(ficha, {}, atendimento).filter(e => e.estado === 'VALIDADA_MANUALMENTE');
  expect(concluida()).toBe(true); expect(provas()).toHaveLength(1);
  ficha.dados.cadastroRevisao = 1;
  expect(concluida()).toBe(false); expect(provas()).toHaveLength(0);
  manual.cadastroRevisao = 1;
  expect(concluida()).toBe(true); expect(provas()).toHaveLength(1);
});

test('manual sem conversa grava confirmação identificada na ficha, sem criar consentimento', async () => {
  const t = setup(); t.state.atendimento = null;
  await t.fiscal.validarProcuracaoManual('o', user, { versao: 2, confirmada: true });
  expect(t.state.ficha.dados.procuracaoManual).toMatchObject({ cnpj: t.state.ficha.cnpj, atorId: user.id, cadastroRevisao: 0, provaOficial: false });
  expect(t.db.atendimentoLead.updateMany).not.toHaveBeenCalled();
  expect(montarJornadaComercial({ onboarding: t.state.ficha }).passos.find(p => p.id === 'autorizacao').concluido).toBe(true);
  expect(evidenciasDiagnostico(t.state.ficha, {}, null)[0]).toMatchObject({ origem: 'MANUAL', satisfaz: false });
});

test('SITFIS disponível libera diagnóstico sem simular conferência', () => {
  const t = setup(); const jornada = { publicaConferida: true, publicaConferencia: { cnpj: t.state.ficha.cnpj, modo: 'MANUAL' }, analises: [{ id: 'f', cnpj: t.state.ficha.cnpj, tipo: 'SITFIS', status: 'CONCLUIDA', resultado: { relatorioDisponivel: true } }], fiscalConferido: false };
  t.state.ficha.dados.procuracaoManual = { cnpj: t.state.ficha.cnpj, atorId: user.id, registradaEm: '2026-10-21', cadastroRevisao: 0 };
  const p = montarJornadaComercial({ onboarding: t.state.ficha, jornada });
  expect(p.passos.find(e => e.id === 'diagnostico').acessivel).toBe(true);
  expect(p.comandosPermitidos.aprovarProposta).toBe(false);
});

test('cadastro material novo bloqueia recebimento da proposta antiga sem alterar seu aceite', async () => {
  const t = setup(); t.state.ficha.dados.cadastroRevisao = 2;
  await expect(t.jornada.confirmarPagamento('o', user, t.pagamento)).rejects.toMatchObject({ code: 'contrato_desatualizado' });
  expect(t.proposta.status).toBe('ACEITA'); expect(t.state.eventos).toHaveLength(0);
});
function setup() {
  let state = {
    ficha: { id: 'o', origem: 'TRANSFERENCIA', cnpj: '11222333000181', versao: 2, status: 'RASCUNHO', dados: {} },
    atendimento: { id: 'a', onboardingId: 'o', autorizacao: {}, representanteVerificadoEm: null },
    eventos: [], trabalhos: [], etapas: [], documentos: [{ id: 'doc', onboardingId: 'o' }],
  };
  const proposta = { id: 'p', onboardingId: 'o', versao: 3, status: 'ACEITA', opcaoAceita: 'RECORRENTE', snapshot: { escopo: 'Escopo sintético' } };
  const contrato = { id: 'c', onboardingId: 'o', propostaId: 'p', status: 'AGUARDANDO_ASSINATURA', aprovadoEm: new Date('2026-10-21T12:00:00Z'), texto: 'Contrato sintético',
    dados: { politicaContratacao: 'R35', opcao: { chave: 'RECORRENTE', recorrente: true, unicoCentavos: 10000 } }, proposta };
  const matchEvento = (e, w) => e.onboardingId === w.onboardingId && (typeof w.tipo === 'string' ? e.tipo === w.tipo : !w.tipo || w.tipo.in.includes(e.tipo))
    && (!w.dados || e.dados[w.dados.path[0]] === w.dados.equals);
  const db = {
    onboarding: {
      findUnique: jest.fn(async ({ where }) => where.id === 'o' ? structuredClone(state.ficha) : null),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.id !== state.ficha.id || where.versao != null && where.versao !== state.ficha.versao
          || where.status?.notIn?.includes(state.ficha.status)) return { count: 0 };
        const versao = state.ficha.versao + (data.versao?.increment || 0);
        Object.assign(state.ficha, data, { versao }); return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(state.ficha, data)),
    },
    atendimentoLead: { findFirst: jest.fn(async () => structuredClone(state.atendimento)), updateMany: jest.fn(async ({ data }) => { Object.assign(state.atendimento, data); return { count: 1 }; }) },
    onboardingEvento: {
      findFirst: jest.fn(async ({ where }) => [...state.eventos].reverse().find(e => matchEvento(e, where)) || null),
      findMany: jest.fn(async ({ where }) => [...state.eventos].reverse().filter(e => matchEvento(e, where))),
      create: jest.fn(async ({ data }) => { const e = { ...data, id: 'e' + state.eventos.length, createdAt: new Date() }; state.eventos.push(e); return e; }),
    },
    onboardingEtapa: { createMany: jest.fn(async ({ data }) => { state.etapas.push(...data); return { count: data.length }; }) },
    contratoComercial: { findFirst: jest.fn(async ({ where }) => where.id === 'c' && where.onboardingId === 'o' ? contrato : null) },
    documentoOnboarding: { findFirst: jest.fn(async ({ where }) => state.documentos.find(d => d.id === where.id && d.onboardingId === where.onboardingId)), create: jest.fn(async ({ data }) => { const d = { id: 'novo', ...data }; state.documentos.push(d); return d; }) },
    onboardingAnalise: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    trabalhoFiscalLead: { findFirst: jest.fn(async () => state.trabalhos[0] || null), create: jest.fn(async ({ data }) => { const j = { id: 'j', ...data }; state.trabalhos.push(j); return j; }) },
    mensagemWhatsapp: { findMany: jest.fn(async () => []) },
  };
  // Modelo serial e rollback para exercitar comandos; PostgreSQL tem suíte própria.
  let fila = Promise.resolve();
  db.$transaction = fn => {
    const executar = async () => { const antes = structuredClone(state); try { return await fn(db); } catch (e) { state = antes; throw e; } };
    const proxima = fila.then(executar); fila = proxima.catch(() => {}); return proxima;
  };
  const jornada = criarJornadaLead({ db });
  return { db, get state() { return state; }, proposta, contrato, jornada, fiscal: criarFiscalLead({ db, flag: true }),
    pagamento: { versao: 2, propostaVersao: 3, contratoId: 'c', contratoRevisao: contrato.aprovadoEm.toISOString(), confirmado: true, valorCentavos: 10000, referencia: 'Recebimento sintético 001' } };
}

test('T54: validação manual sem narrativa audita ator/data e não fabrica prova SERPRO', async () => {
  const t = setup();
  const out = await t.fiscal.validarProcuracaoManual('o', user, { versao: 2, confirmada: true });
  expect(out).toMatchObject({ origem: 'MANUAL', atorId: user.id, provaOficial: false });
  expect(out.registradaEm).toBeTruthy();
  expect(t.state.atendimento.autorizacao).toMatchObject({ estado: 'NAO_VERIFICADA' });
  expect(t.state.atendimento.autorizacao.prova).toBeUndefined();
  expect(t.state.atendimento.representanteVerificadoEm).toBeNull();
  expect(t.state.eventos).toHaveLength(1);
  expect(montarJornadaComercial({ onboarding: t.state.ficha, atendimento: t.state.atendimento }).passos.find(p => p.id === 'autorizacao').concluido).toBe(true);
  await expect(t.fiscal.enfileirar('o', user, 'SITFIS')).rejects.toMatchObject({ code: 'representante_nao_verificado' });
  expect(t.state.trabalhos).toHaveLength(0);
});

test('autorização explícita permite consultar procuração sem narrativa e não comprova sucesso', async () => {
  const t = setup();
  await t.fiscal.enfileirar('o', user, 'PROCURACAO', { autorizada: true, versao: 2 });
  expect(t.state.atendimento.autorizacao).toMatchObject({ consultaAutorizadaPor: user.id, estado: 'NAO_VERIFICADA' });
  expect(t.state.trabalhos[0]).toMatchObject({ tipo: 'PROCURACAO', resultado: { fichaVersao: 2 } });
  await expect(t.fiscal.enfileirar('o', user, 'SITFIS')).rejects.toMatchObject({ code: 'procuracao_nao_verificada' });
});

test('validação manual concorrente e repetida tem um evento; auditoria falha desfaz o comando', async () => {
  const t = setup(), body = { versao: 2, confirmada: true };
  await Promise.all([t.fiscal.validarProcuracaoManual('o', user, body), t.fiscal.validarProcuracaoManual('o', user, body)]);
  expect(t.state.eventos).toHaveLength(1); expect(t.state.ficha.versao).toBe(3);
  const f = setup(); f.db.onboardingEvento.create.mockRejectedValue(Error('auditoria indisponível'));
  await expect(f.fiscal.validarProcuracaoManual('o', user, body)).rejects.toThrow('auditoria');
  expect(f.state.ficha.versao).toBe(2); expect(f.state.atendimento.autorizacao).toEqual({});
});

test.each(['MANUAL', 'PULADA'])('T55: fiscal %s preserva limitação sem inventar consulta', async modo => {
  const t = setup(), body = { versao: 2, modo, ...(modo === 'MANUAL' ? { informacao: 'Pendência informada pelo contador.' } : {}) };
  await t.jornada.registrarFiscalAlternativa('o', user, body);
  await t.jornada.registrarFiscalAlternativa('o', user, body);
  const j = await t.jornada.carregar('o', user);
  expect(j.fiscalAlternativa).toMatchObject({ atorId: user.id, dados: { modo, consultaOficialValida: false } });
  expect(j.fiscalAlternativa.dados.limitacao).toContain('sem consulta oficial válida');
  expect(j.fiscalConferido).toBe(false); expect(j.analises).toEqual([]);
  expect(t.state.eventos).toHaveLength(1);
});

test('T59/T60: pagamento sem assinatura, repetição concorrente e ganho consistente', async () => {
  const t = setup();
  const [a, b] = await Promise.all([t.jornada.confirmarPagamento('o', user, t.pagamento), t.jornada.confirmarPagamento('o', user, t.pagamento)]);
  expect(a.id).toBe(b.id); expect(t.state.eventos).toHaveLength(1);
  expect(a).toMatchObject({ atorId: user.id, dados: { politica: 'R35', valorCentavos: 10000, contextoContrato: contextoContrato(t.proposta, t.contrato) } });
  const c = projetarContratacao({ onboarding: t.state.ficha, propostas: [t.proposta], contratos: [t.contrato], marcos: t.state.eventos });
  expect(c).toMatchObject({ ganha: true, implantacaoPermitida: true, carteiraPermitida: true, naCarteira: false });
  expect(t.contrato.status).toBe('AGUARDANDO_ASSINATURA'); expect(t.contrato.assinaturaConferidaEm).toBeUndefined();
  expect(t.state.ficha.faseComercial).toBe('CONTRATADO');
  expect(t.state.etapas.every(e => !e.concluidaEm)).toBe(true);
});

test.each([{ versao: 1 }, { propostaVersao: 2 }, { contratoId: 'outro' }, { contratoRevisao: 'antiga' }, { confirmado: false }, { valorCentavos: 0 }, { valorCentavos: 1.1 }])('T60: confirmação inválida %j não ganha', async patch => {
  const t = setup(); await expect(t.jornada.confirmarPagamento('o', user, { ...t.pagamento, ...patch })).rejects.toBeTruthy();
  expect(t.state.eventos).toEqual([]); expect(t.state.etapas).toEqual([]); expect(t.state.ficha.versao).toBe(2);
});

test('falha de auditoria reverte ganho, versão e checklist', async () => {
  const t = setup(); t.db.onboardingEvento.create.mockRejectedValue(Error('auditoria falhou'));
  await expect(t.jornada.confirmarPagamento('o', user, t.pagamento)).rejects.toThrow('auditoria');
  expect(t.state.ficha).toMatchObject({ versao: 2, status: 'RASCUNHO' }); expect(t.state.ficha.faseComercial).toBeUndefined(); expect(t.state.etapas).toEqual([]);
});

test('alteração de conteúdo contratual invalida pagamento anterior, sem apagá-lo', async () => {
  const t = setup(); await t.jornada.confirmarPagamento('o', user, t.pagamento);
  t.contrato.texto = 'Outra revisão';
  expect(projetarContratacao({ propostas: [t.proposta], contratos: [t.contrato], marcos: t.state.eventos }).ganha).toBe(false);
  await expect(t.jornada.confirmarPagamento('o', user, t.pagamento)).rejects.toMatchObject({ code: 'pagamento_divergente' });
  expect(t.state.eventos).toHaveLength(1);
});

test('T58: cobrança externa com documento da ficha não confirma pagamento', async () => {
  const t = setup(), body = { versao: 2, contratoId: 'c', propostaVersao: 3, valorCentavos: 10000, referencia: 'Cobrança sintética', documentoId: 'doc' };
  const a = await t.jornada.registrarCobrancaExterna('o', user, body);
  const b = await t.jornada.registrarCobrancaExterna('o', user, body);
  expect(a.id).toBe(b.id); expect(a.dados.pagamentoConfirmado).toBe(false);
  expect(projetarContratacao({ propostas: [t.proposta], contratos: [t.contrato], marcos: t.state.eventos }).ganha).toBe(false);
  await expect(t.jornada.registrarCobrancaExterna('o', user, { ...body, versao: 3, documentoId: 'outra-ficha' })).rejects.toMatchObject({ code: 'documento_invalido' });
});

test.each(['http://cobranca.example.com', 'https://user:pass@cobranca.example.com', 'https://127.0.0.1/a', 'https://[::1]', 'javascript:alert(1)', 'https://localhost', 'https://site.local'])('link inseguro recusado: %s', url => expect(urlCobrancaSegura(url)).toBeNull());
test('link HTTPS é armazenável sem fetch', () => expect(urlCobrancaSegura('https://cobranca.example.com/123')).toBe('https://cobranca.example.com/123'));

test('comprovante enviado e marco genérico não confirmam pagamento', async () => {
  const t = setup(), service = criarPropostasComerciais({ db: t.db, cifrar: async () => 'cifrado-sintetico' });
  await service.salvarDocumento('o', user, { buffer: Buffer.from('%PDF-1.4\nteste sintético'), mimetype: 'application/pdf', originalname: 'comprovante.pdf' });
  expect(t.state.eventos.some(e => e.tipo === 'PAGAMENTO_HONORARIOS_CONFERIDO')).toBe(false);
  await expect(service.registrarMarco('o', user, 'PAGAMENTO_HONORARIOS_CONFERIDO', 'Comprovante recebido')).rejects.toMatchObject({ code: 'marco_invalido' });
});

test('papel de cliente e ficha inexistente não podem confirmar', async () => {
  const t = setup();
  await expect(t.jornada.confirmarPagamento('o', { id: 'cliente', role: 'cliente' }, t.pagamento)).rejects.toMatchObject({ code: 'forbidden' });
  await expect(t.jornada.confirmarPagamento('outra', user, t.pagamento)).rejects.toMatchObject({ status: 404 });
  expect(t.state.eventos).toEqual([]);
});
