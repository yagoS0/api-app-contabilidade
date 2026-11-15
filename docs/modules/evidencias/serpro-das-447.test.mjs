import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Execute from the repository root. Only pure production functions are imported.
const read = p => import(pathToFileURL(resolve('apps/api/src', p)).href);
const { buildPgdasGuidePayload } = await read('modules/fiscal/domain/interpretacaoDas.js');
const { evidenciaCache445, projetarFiscal445 } = await read('modules/fiscal/domain/evidenciasConciliacaoDas445.js');
const { evidenciaGuia445, projetarGuias445 } = await read('modules/guides/domain/evidenciasConciliacaoDas445.js');
const { evidenciaLancamento445, projetarContabilidade445 } = await read('modules/accounting/domain/evidenciasConciliacaoDas445.js');
const { evidenciaExecucao445 } = await read('modules/operations/domain/evidenciasConciliacaoDas445.js');
const hash = 'a'.repeat(64);
const agora = new Date('2026-11-15T13:00:00Z');
const fonte = items => ({ consulta: 'ok', items, truncated: false, limit: 50 });
const response = () => ({ pdf: Buffer.from('SYNTHETIC NOT A PDF '.repeat(20)).toString('base64'),
  numeroDocumento: '07202619039520400', cnpj: '22222222000122', competencia: '2026-09', valorTotal: 125.5 });

test('C1 parser assigns caller identity despite conflicting response metadata', () => {
  const r = response(); const before = structuredClone(r);
  const result = buildPgdasGuidePayload({ response: r, contribuinteCnpj: '11111111000111', competencia: '2026-10' });
  assert.equal(result.parsed.cnpj, '11111111000111');
  assert.equal(result.parsed.competencia, '2026-10');
  assert.deepEqual(r, before);
});
test('C2 nonempty base64 is accepted without validating PDF structure', () => {
  const result = buildPgdasGuidePayload({ response: response(), contribuinteCnpj: null, competencia: '2026-10' });
  assert.ok(result.pdfBuffer.length > 0);
  assert.equal(result.pdfBuffer.subarray(0, 5).toString(), 'SYNTH');
});
test('C3 cache projection confirms presence, not content identity/integrity', () => {
  const result = evidenciaCache445({ chave: hash, resposta: response(), expiraEm: new Date('2026-11-15T14:00:00Z') }, { agora, competencia: '2026-10' });
  assert.equal(result.interpretacao, 'DOCUMENTO_NA_RESPOSTA_LOCAL');
  assert.equal(result.pdfNaResposta, true);
  assert.equal(result.vigente, true);
  assert.equal(Object.hasOwn(result, 'cnpj'), false);
});
test('C4 cache and uncertain reservation coexist without reconciliation', () => {
  const sources = { chamadas: fonte([{ estadoLocal: 'incerta' }]), cache: fonte([{ vigente: true }]), despachos: fonte([]) };
  const before = structuredClone(sources);
  const result = projetarFiscal445(sources);
  assert.equal(result.estado, 'Incerto');
  assert.ok(result.lacunas.includes('RESULTADO_EXTERNO_INCERTO_CACHE_NAO_RESOLVE_RESERVA'));
  assert.deepEqual(sources, before);
});
test('C5 expired cache remains historical and does not authorize retry', () => {
  const cache = evidenciaCache445({ chave: hash, resposta: response(), expiraEm: new Date('2026-11-15T12:00:00Z') }, { agora, competencia: '2026-10' });
  const result = projetarFiscal445({ chamadas: fonte([]), cache: fonte([cache]), despachos: fonte([]) });
  assert.equal(cache.vigente, false);
  assert.ok(result.lacunas.includes('CACHE_EXPIRADO_PRESERVADO_COMO_HISTORICO'));
  assert.ok(result.lacunas.includes('NENHUMA_AUTORIZACAO_DE_RETRY'));
});
test('C6 processed guide with storage reference does not validate bytes', () => {
  const guide = evidenciaGuia445({ id: 'synthetic-guide', competencia: '2026-10', status: 'PROCESSED', source: 'UPLOAD', storageKey: 'synthetic-only', updatedAt: agora, hash });
  const result = projetarGuias445(fonte([guide]), fonte([]));
  assert.equal(result.estado, 'Confirmado pela evidência local');
  assert.equal(guide.documento.conteudoVerificado, false);
  assert.equal(guide.documento.bytesLocais, false);
  assert.equal(guide.documento.referenciaStorage, true);
});
test('C7 same period without sourceGuideId is not an accounting association', () => {
  const entry = evidenciaLancamento445({ id: 'synthetic-entry', sourceGuideId: null, competencia: '2026-10', tipo: 'PROVISAO', lines: [] }, [{ id: 'synthetic-guide' }], 50);
  const result = projetarContabilidade445(fonte([]), fonte([entry]), fonte([{ id: 'synthetic-guide' }]));
  assert.equal(entry.associacao, 'SEM_VINCULO_DOCUMENTAL_INEQUIVOCO');
  assert.ok(result.lacunas.includes('LANCAMENTO_SEM_VINCULO_DOCUMENTAL_INEQUIVOCO'));
});
test('C8 completed with zero entries does not retain accounting.ok', () => {
  const result = evidenciaExecucao445({ id: 'synthetic-run', status: 'completed', entriesGenerated: 0, accounting: { ok: false } });
  assert.equal(result.resultadoContabil, 'NAO_PERSISTIDO_NESTE_LOG');
  assert.equal(Object.hasOwn(result, 'accounting'), false);
});
test('C9 absent, failed and truncated documents remain distinguishable', () => {
  const empty = projetarGuias445(fonte([]), fonte([]));
  const failed = projetarGuias445({ consulta: 'falhou', items: null, truncated: null }, fonte([]));
  const truncated = projetarGuias445({ ...fonte([]), truncated: true }, fonte([]));
  assert.ok(empty.lacunas.includes('SEM_DOCUMENTO_NO_RECORTE_NAO_AUTORIZA_RETRY'));
  assert.ok(failed.lacunas.includes('DOCUMENTOS_NAO_VERIFICAVEIS_POR_FALHA_DE_LEITURA'));
  assert.ok(truncated.lacunas.includes('RECORTE_DOCUMENTAL_TRUNCADO_UNICIDADE_NAO_VERIFICAVEL'));
});
test('C10 payment version does not detect due date or updatedAt change', async () => {
  const { versaoPagamentoGuia } = await read('application/guides/ConfirmacaoPagamentoClienteService.js');
  const original = { id: 'synthetic-guide', portalClientId: 'synthetic-company', hash, tipo: 'SIMPLES', competencia: '2026-10', valor: '125.50', vencimento: '2026-11-20', updatedAt: agora };
  const changed = { ...original, vencimento: '2026-11-30', updatedAt: new Date('2026-11-15T14:00:00Z') };
  assert.equal(versaoPagamentoGuia(original), versaoPagamentoGuia(changed));
});
