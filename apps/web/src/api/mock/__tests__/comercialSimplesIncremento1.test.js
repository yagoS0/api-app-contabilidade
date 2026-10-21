import { criarMockComercial } from '../comercialMock';

function setup() {
  const o = { id: 'o', origem: 'TRANSFERENCIA', status: 'RASCUNHO', versao: 2, cnpj: '11222333000181', dados: {} };
  const p = { id: 'p', onboardingId: 'o', versao: 3, status: 'ACEITA', opcaoAceita: 'RECORRENTE', snapshot: {} };
  const c = { id: 'c', onboardingId: 'o', propostaId: 'p', status: 'AGUARDANDO_ASSINATURA', aprovadoEm: '2026-10-21T12:00:00.000Z', dados: { politicaContratacao: 'R35', opcao: { chave: 'RECORRENTE', recorrente: true } } };
  const mock = criarMockComercial({ onboardings: new Map([['o', o]]), persistir: jest.fn(),
    estadoContratacao: { propostas: new Map([['p', p]]), contratos: new Map([['c', c]]) },
    atendimentosIniciais: [{ id: 'a', conversaId: 'conversa', onboardingId: 'o' }] });
  return { mock, o, c, body: { versao: 2, propostaVersao: 3, contratoId: 'c', contratoRevisao: c.aprovadoEm, confirmado: true, valorCentavos: 10000, referencia: 'Recebimento sintético' } };
}
test('mock confirma pagamento sem assinatura pela mesma projeção compartilhada', async () => {
  const t = setup();
  const a = await t.mock.comercial('/onboardings/o/jornada/pagamento', t.body);
  const b = await t.mock.comercial('/onboardings/o/jornada/pagamento', t.body);
  expect(a.marco.id).toBe(b.marco.id);
  const painel = await t.mock.comercial('/onboardings/o', null, 'GET');
  expect(painel.jornada.projecao.contratacao).toMatchObject({ ganha: true, carteiraPermitida: true, naCarteira: false });
  expect(t.c.status).toBe('AGUARDANDO_ASSINATURA'); expect(t.o.marcosComerciais).toHaveLength(1);
});
test('mock manual e pulado não inventam consulta nem pagamento', async () => {
  const t = setup();
  await t.mock.comercial('/onboardings/o/procuracao/manual', { versao: 2, confirmada: true });
  await t.mock.comercial('/onboardings/o/jornada/fiscal-alternativa', { versao: 3, modo: 'PULADA' });
  const p = await t.mock.comercial('/onboardings/o', null, 'GET');
  expect(p.atendimento.autorizacao).toMatchObject({ estado: 'NAO_VERIFICADA', validacaoManual: { origem: 'MANUAL', provaOficial: false } });
  expect(p.jornada.fiscalAlternativa.dados).toMatchObject({ modo: 'PULADA', consultaOficialValida: false });
  expect(p.jornada.analises).toEqual([]); expect(p.jornada.projecao.contratacao.ganha).toBe(false);
});
test('cobrança e upload não confirmam recebimento', async () => {
  const t = setup();
  await t.mock.comercial('/onboardings/o/jornada/cobranca-externa', { versao: 2, propostaVersao: 3, contratoId: 'c', valorCentavos: 10000, referencia: 'Cobrança fictícia', url: 'https://cobranca.example.com/001' });
  await t.mock.documentoComercial('o', new File(['%PDF-1.4 teste'], 'comprovante.pdf', { type: 'application/pdf' }));
  const p = await t.mock.comercial('/onboardings/o', null, 'GET');
  expect(p.jornada.projecao.contratacao.ganha).toBe(false);
  expect(p.marcos.some(m => m.tipo === 'PAGAMENTO_HONORARIOS_CONFERIDO')).toBe(false);
});
test('revisão errada é recusada', async () => {
  const t = setup();
  await expect(t.mock.comercial('/onboardings/o/jornada/pagamento', { ...t.body, propostaVersao: 2 })).rejects.toThrow();
  expect(t.o.marcosComerciais).toBeUndefined();
});
