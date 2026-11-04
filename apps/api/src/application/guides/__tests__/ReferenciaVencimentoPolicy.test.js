import { comandoReferencia, dataCivilReferencia, hashComandoReferencia, identidadeReferencia } from '../ReferenciaVencimentoPolicy.js';

const input = () => ({ identidade: { tributo: 'IRPJ', tipoPeriodo: 'MENSAL', competencia: '2026-09' }, acao: 'CONFIRMAR',
  expectedRevision: 0, requestId: 'teste_req_1', dataCivil: '2026-10-30', origem: 'CONFIRMADA_CONTADOR', descricaoFonte: 'Conferência fictícia', confirmacao: true, motivo: 'Teste fictício' });
describe('referência declarada sem inferência fiscal', () => {
  test('valida data civil e ano bissexto sem horário ou fuso implícito', () => {
    expect(dataCivilReferencia('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-30T00:00:00Z', null]) expect(() => dataCivilReferencia(date)).toThrow();
  });
  test('mensal e trimestral são explícitos; não decide periodicidade pelo tributo', () => {
    expect(comandoReferencia(input()).identidade.tipoPeriodo).toBe('MENSAL');
    expect(identidadeReferencia({ tributo: 'IRPJ', tipoPeriodo: 'TRIMESTRAL', competencia: '2026-T3' }).competencia).toBe('2026-T3');
    expect(() => identidadeReferencia({ tributo: 'IRPJ', competencia: '2026-09' })).toThrow();
    expect(() => identidadeReferencia({ tributo: 'IRPJ', tipoPeriodo: 'TRIMESTRAL', competencia: '2026-09' })).toThrow();
  });
  test.each(['confirmedBy', 'confirmedAt', 'capture', 'familiaCaptura', 'sourceDocumentId', 'targetKey'])('recusa campo de autoridade %s', field => {
    expect(() => comandoReferencia({ ...input(), [field]: 'alegado' })).toThrow();
  });
  test('sem fonte/confirmacao não há referência; não aceita documento alegado', () => {
    expect(() => comandoReferencia({ ...input(), confirmacao: false })).toThrow();
    expect(() => comandoReferencia({ ...input(), origem: 'DOCUMENTO_OFICIAL' })).toThrow();
    expect(() => comandoReferencia({ ...input(), dataCivil: undefined })).toThrow();
  });
  test('parcela não perde identidade em referência genérica', () => {
    expect(() => identidadeReferencia({ tributo: 'PARCELAMENTO', tipoPeriodo: 'MENSAL', competencia: '2026-09' })).toThrow();
  });
  test('revogação exige motivo e não troca data; hash inclui empresa e revisão', () => {
    const cmd = { identidade: input().identidade, acao: 'REVOGAR', expectedRevision: 1, requestId: 'revogar_1', motivo: 'Fonte revista' };
    expect(comandoReferencia(cmd).acao).toBe('REVOGAR');
    expect(() => comandoReferencia({ ...cmd, dataCivil: '2026-10-01' })).toThrow();
    expect(hashComandoReferencia('a', comandoReferencia(input()))).not.toBe(hashComandoReferencia('b', comandoReferencia(input())));
  });
});
