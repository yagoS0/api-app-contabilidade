import { identificarDeclaracaoNoIndice, validarExtratoDocumentalPgdas, validarDasDocumentalPgdas, projetarEstadoDocumentalPgdas } from '../evidenciaDocumentalPgdas.js';
const ctx = { competencia: '2026-10', contribuinteCnpj: '12345678000199' };
const envelope = dados => ({ status: 200, dados: JSON.stringify(dados) });
test('índice sem ecos aceita identidade da requisição, sem atribuir cálculo', () => {
  expect(identificarDeclaracaoNoIndice(envelope([{ numeroDeclaracao: '1' }]), ctx)).toEqual({ confirmada: true, numeroDeclaracao: '1' });
});
test('índice oficial anual seleciona competência exata', () => {
  expect(identificarDeclaracaoNoIndice(envelope({ periodos: [{ periodoApuracao: '202610', operacoes: [{ indiceDeclaracao: { numeroDeclaracao: '2' } }] }] }), ctx).numeroDeclaracao).toBe('2');
});
test.each([{ cnpj: '99999999000199' }, { pa: '202611' }])('eco divergente não comprova declaração %j', echo => {
  expect(() => identificarDeclaracaoNoIndice(envelope([{ numeroDeclaracao: '1', ...echo }]), ctx)).toThrow();
});
test('múltiplas revisões não escolhem silenciosamente', () => {
  expect(() => identificarDeclaracaoNoIndice(envelope([{ numeroDeclaracao: '1' }, { numeroDeclaracao: '2' }]), ctx)).toThrow();
});
test('ausência oficial explícita não vira confirmação', () => {
  expect(identificarDeclaracaoNoIndice({ status: 200, dados: '', mensagens: [{ codigo: '[EntradaIncorreta-PGDASD-MSG_ISN_005]' }] }, ctx)).toBeNull();
});
test('envelope sem identidade documental ou erro não confirma', () => {
  expect(() => identificarDeclaracaoNoIndice(envelope({}), ctx)).toThrow();
  expect(() => identificarDeclaracaoNoIndice({ ...envelope([{ numeroDeclaracao: '1' }]), status: 500 }, ctx)).toThrow();
});
test('extrato de declaração diferente não pode ser salvo', () => {
  expect(() => validarExtratoDocumentalPgdas({ numeroDeclaracao: '2' }, { numeroDeclaracao: '1' })).toThrow();
});
test('DAS incompleto não recebe valor ou vencimento presumidos', () => {
  expect(() => validarDasDocumentalPgdas(envelope({}), { pdfBuffer: Buffer.from('%PDF'), numeroDocumento: 'das', parsed: { valor: null } }, {})).toThrow();
});
test('marca manual não comprova transmissão; zero exige extrato completo', () => {
  const out = projetarEstadoDocumentalPgdas({ entregaExterna: { transmitidaEm: new Date() }, circular: { dasTotal: 0 } });
  expect(out.transmissao.confirmada).toBe(false);
  expect(out.documentos.guia.estado).toBe('PENDENTE');
});
test('extrato zerado, pagamento e tentativa incerta permanecem independentes', () => {
  const out = projetarEstadoDocumentalPgdas({ circular: { pgdasNumeroDeclaracao: '1', pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r', dasTotal: 0 }, snapshot: { estado: 'erro_transmissao' } });
  expect(out.documentos.guia.estado).toBe('NAO_DEVIDO');
  expect(out.transmissao.tentativaLocalIncerta).toBe(true);
  expect(out.pagamento.estado).toBe('NAO_CONFIRMADO');
});

test('snapshot histórico sem evidência não confirma origem ou transmissão atual', () => {
  const out = projetarEstadoDocumentalPgdas({ snapshot: { estado: 'transmitida', numeroDeclaracao: 'antiga' } });
  expect(out.transmissao.confirmada).toBe(false); expect(out.transmissao.numeroHistorico).toBe('antiga'); expect(out.origem).toBeNull();
});
test('índice novo não reutiliza PDF de declaração anterior', () => {
  const out = projetarEstadoDocumentalPgdas({ consulta: { numeroDeclaracao: 'nova' }, circular: { pgdasNumeroDeclaracao: 'antiga' }, guide: { pdfBytes: Buffer.from('%PDF') } });
  expect(out.documentos.guia.ok).toBe(false); expect(out.documentos.extrato.ok).toBe(false);
});
test('DAS de número ou empresa diferente permanece pendente', () => {
  const out = projetarEstadoDocumentalPgdas({ company: { id: 'p1' }, circular: { dasNumeroDocumento: 'novo' }, guide: { portalClientId: 'p2', sourceFileId: 'serpro:velho', pdfBytes: Buffer.from('%PDF') } });
  expect(out.documentos.guia.ok).toBe(false);
});

test('pagamento de guia antiga não confirma guia retificada', () => {
  const out = projetarEstadoDocumentalPgdas({ consulta: { numeroDeclaracao: 'nova' }, circular: { pgdasNumeroDeclaracao: 'antiga' }, guide: { pdfBytes: Buffer.from('%PDF'), paymentStatus: 'PAID', paymentStatusSource: 'SERPRO' } });
  expect(out.documentos.guia.estado).toBe('PENDENTE'); expect(out.pagamento.estado).toBe('NAO_CONFIRMADO'); expect(out.pagamento.origem).toBeNull();
});
test.each(['', ' ', -1, Infinity, NaN, false, null])('valor inválido estrito não vira zero: %p', valor => {
  expect(() => validarDasDocumentalPgdas({ dados: { detalhamentoDas: { numeroDocumento: '123', dataVencimento: '20261120' } } }, { pdfBuffer: Buffer.from('%PDF-1.4'), numeroDocumento: '123', parsed: { valor, vencimento: '2026-11-20T00:00:00.000Z' } }, {})).toThrow();
});

test('zero comprovado novo prevalece sobre PDF antigo pago', () => {
  const out = projetarEstadoDocumentalPgdas({ consulta: { numeroDeclaracao: 'nova' }, circular: { pgdasNumeroDeclaracao: 'nova', pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r', dasTotal: 0, dasNumeroDocumento: null }, guide: { id: 'velha', pdfBytes: Buffer.from('%PDF'), paymentStatus: 'PAID' } });
  expect(out.documentos.guia.estado).toBe('NAO_DEVIDO'); expect(out.documentos.guia.guideId).toBeNull(); expect(out.pagamento.estado).toBe('NAO_CONFIRMADO');
});
test('sem número DAS, apenas vínculo documental explícito permite PDF corrente', () => {
  const state = { consulta: { numeroDeclaracao: 'nova' }, circular: { pgdasNumeroDeclaracao: 'nova', dasTotal: 100 }, guide: { id: 'g', pdfBytes: Buffer.from('%PDF'), paymentStatus: 'PAID' } };
  expect(projetarEstadoDocumentalPgdas(state).documentos.guia.estado).toBe('PENDENTE');
  state.guide.extracted = { pgdasNumeroDeclaracao: 'antiga' };
  expect(projetarEstadoDocumentalPgdas(state).pagamento.estado).toBe('NAO_CONFIRMADO');
  state.guide.extracted.pgdasNumeroDeclaracao = 'nova';
  expect(projetarEstadoDocumentalPgdas(state).documentos.guia.estado).toBe('DISPONIVEL');
});
