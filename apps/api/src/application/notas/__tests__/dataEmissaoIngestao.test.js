import { xmlNfeData, xmlResumoData, CNPJ_DATAS } from "../__fixtures__/dataEmissaoNotas.js";
jest.mock('../pendenciasDoPeriodo.js', () => ({ situacaoDoPeriodo: jest.fn(async () => ({ exigeRevisao: false })), registrarPendenciaDoPeriodo: jest.fn() }));
jest.mock('../notaItens.js', () => ({ substituirItensPreservandoClassificacao: jest.fn() }));
import { upsertNfeFromParsed } from '../ingestaoNfe.js';
import { parseDocZip } from '../dfe/DfeParser.js';
import { situacaoDoPeriodo } from '../pendenciasDoPeriodo.js';
const summaryXml = xmlResumoData();
const fullXml = xmlNfeData();
test('summary → complete → summary retains stronger civil source and full XML', async () => {
  let saved;
  const tx = { portalInvoice: { findUnique: jest.fn(async () => saved || null), upsert: jest.fn(async ({ create, update }) => {
    saved = { id: 'n', ...(saved ? { ...saved, ...update } : create) }; return saved;
  }) } };
  const summary = parseDocZip({ xml: summaryXml, schema: 'resNFe_v1.01' }, { companyCnpj: CNPJ_DATAS });
  expect(summary.parsed.xmlRaw).toBeNull(); expect(summary.parsed.xmlResumo).toBe(summaryXml);
  await upsertNfeFromParsed(tx, { portalClientId: 'a', parsed: summary.parsed, items: [] });
  expect(saved.dataEmissaoCivil).toBe('2026-09-27'); expect(saved.xmlRaw).toBeNull();
  const full = parseDocZip({ xml: fullXml, schema: 'procNFe_v4.00' }, { companyCnpj: CNPJ_DATAS });
  await upsertNfeFromParsed(tx, { portalClientId: 'a', parsed: full.parsed, items: [] });
  await upsertNfeFromParsed(tx, { portalClientId: 'a', parsed: summary.parsed, items: [] });
  expect(saved.dataEmissaoCivil).toBe('2026-09-28'); expect(saved.xmlRaw).toBe(fullXml);
  expect(saved.dataEmissaoEvidencia.origem).toBe('NFE_COMPLETA');
  expect(saved.tomadorNome).toBe('Tomador preservado');
});
test('closed period does not replace source or legacy fiscal data', async () => {
  situacaoDoPeriodo.mockResolvedValueOnce({ exigeRevisao: true });
  const tx = { portalInvoice: { findUnique: jest.fn(async () => ({ id: 'n', statusEfetivo: 'autorizada' })), upsert: jest.fn(async () => ({ id: 'n' })) } };
  const full = parseDocZip({ xml: fullXml, schema: 'procNFe_v4.00' }, { companyCnpj: CNPJ_DATAS });
  await upsertNfeFromParsed(tx, { portalClientId: 'a', parsed: full.parsed, items: [] });
  expect(tx.portalInvoice.upsert.mock.calls[0][0].update).toEqual({ statusEfetivo: 'autorizada' });
});
