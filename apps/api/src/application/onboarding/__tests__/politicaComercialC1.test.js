import { POLITICA_COMERCIAL_C1, projetarContratacao, resumirContratacao, contextoContrato } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';

function caso() {
  return { onboarding: { id: 'o', politicaComercial: POLITICA_COMERCIAL_C1, origem: 'TRANSFERENCIA', status: 'RECEBIDO', dados: {} },
    propostas: [{ id: 'p', versao: 2, status: 'ACEITA', opcaoAceita: 'mensal', snapshot: {} }],
    contratos: [{ id: 'c', propostaId: 'p', status: 'AGUARDANDO_ASSINATURA', aprovadoPor: 'contador', aprovadoEm: '2026-10-25T12:00:00Z',
      texto: 'Pagamento em 10/11/2026 conforme condições contratadas.',
      dados: { politicaContratacao: 'R35', opcao: { chave: 'mensal', recorrente: true },
        condicaoPagamento: { versao: 1, tipo: 'PAGAMENTO_FUTURO', carteiraAntesDoPagamento: true, vencimento: '2026-11-10',
          clausula: 'Pagamento em 10/11/2026 conforme condições contratadas.', propostaId: 'p', propostaVersao: 2 } } }],
    marcos: [] };
}
test('C1: carteira antecipada não comprova Ganha, execução ou pagamento; DTO não expõe cláusula', () => {
  const e = caso(), p = projetarContratacao(e);
  expect(p).toMatchObject({ carteiraPermitida: true, ganha: false, pagamento: null, execucaoIndependePagamento: true });
  expect(JSON.stringify(resumirContratacao(p))).not.toContain('clausula');
  expect(e.marcos).toHaveLength(0);
});
test.each(['ausente', 'texto', 'versao', 'proposta', 'minuta', 'autor', 'data', 'clausula', 'cadastro'])('C1: %s não libera carteira', tipo => {
  const e = caso(), c = e.contratos[0];
  if (tipo === 'ausente') delete c.dados.condicaoPagamento;
  if (tipo === 'texto') c.dados.condicaoPagamento = 'pagamento futuro';
  if (tipo === 'versao') c.dados.condicaoPagamento.versao = 99;
  if (tipo === 'proposta') c.dados.condicaoPagamento.propostaVersao = 1;
  if (tipo === 'minuta') c.status = 'MINUTA';
  if (tipo === 'autor') c.aprovadoPor = null;
  if (tipo === 'data') c.dados.condicaoPagamento.vencimento = '2026-02-30';
  if (tipo === 'clausula') c.texto = 'Outro documento.';
  if (tipo === 'cadastro') e.onboarding.dados.cadastroRevisao = 8;
  expect(projetarContratacao(e)).toMatchObject({ carteiraPermitida: false, ganha: false });
});
test('C1: null mantém assinatura legada; política desconhecida recusa', () => {
  const e = caso(); e.onboarding.politicaComercial = null;
  e.contratos[0].status = 'ASSINADO_CONFERIDO'; delete e.contratos[0].dados.politicaContratacao;
  expect(projetarContratacao(e)).toMatchObject({ ganha: true, carteiraPermitida: false });
  e.onboarding.politicaComercial = POLITICA_COMERCIAL_C1;
  expect(projetarContratacao(e).ganha).toBe(false);
  e.onboarding.politicaComercial = '';
  expect(() => projetarContratacao(e)).toThrow('Política comercial desconhecida');
});
test('C1: pagamento vigente ganha; alterar condição invalida o contexto financeiro', () => {
  const e = caso();
  e.marcos.push({ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', atorId: 'contador',
    dados: { contratoId: 'c', politica: 'R35', confirmadoEm: '2026-11-10', contextoContrato: contextoContrato(e.propostas[0], e.contratos[0]) } });
  expect(projetarContratacao(e).ganha).toBe(true);
  e.contratos[0].dados.condicaoPagamento.vencimento = '2026-12-10';
  expect(projetarContratacao(e).ganha).toBe(false);
});
test('C1: abertura paga e CNPJ consultado não comprovam constituição; PF nunca cria PJ', () => {
  const e = caso(); e.onboarding.origem = 'ABERTURA'; e.onboarding.cnpj = '11222333000181';
  e.marcos.push({ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', atorId: 'contador',
    dados: { contratoId: 'c', politica: 'R35', confirmadoEm: '2026-11-10', contextoContrato: contextoContrato(e.propostas[0], e.contratos[0]) } });
  expect(projetarContratacao(e)).toMatchObject({ ganha: true, carteiraPermitida: false, implantacaoPermitida: false });
  e.onboarding.etapas = ['viabilidade_registro', 'cnpj_definitivo'].map(chave => ({ chave, concluidaEm: '2026-11-10', concluidaPorId: 'contador' }));
  expect(projetarContratacao(e)).toMatchObject({ carteiraPermitida: true, implantacaoPermitida: true });
  e.onboarding.origem = 'PESSOA_FISICA';
  expect(projetarContratacao(e)).toMatchObject({ carteiraPermitida: false, implantacaoPermitida: false });
});
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../ContextoComercialService.js', () => ({
  ...jest.requireActual('../ContextoComercialService.js'),
  emTransacaoComercial: (db, fn) => fn(db),
  identidadeDoCaso: async () => null,
  filtroCasoDaConversa: c => ({ conversaId: c.id }),
}));
import { iniciarAtendimento } from '../LeadService.js';
test('C1: produtor LeadService atribui política sem aceitar parâmetro externo', async () => {
  const db = {
    conversaWhatsapp: { findUnique: async () => ({ id: 'conversa', telefoneE164: '5511999990000' }), updateMany: async () => ({ count: 1 }) },
    mensagemWhatsapp: { findFirst: async () => ({ id: 'entrada' }) },
    atendimentoLead: { findFirst: async () => null, create: async () => ({ id: 'lead' }), update: async ({ data }) => data },
    onboarding: { create: jest.fn(async ({ data }) => ({ ...data, id: 'o' })) },
    onboardingEvento: { create: jest.fn(async ({ data }) => data) },
  };
  await iniciarAtendimento({ conversaId: 'conversa', origem: 'TRANSFERENCIA', client: db, politicaComercial: 'forjada' });
  expect(db.onboarding.create.mock.calls[0][0].data).toMatchObject({ politicaComercial: POLITICA_COMERCIAL_C1, origemPreenchimento: 'WHATSAPP' });
});
