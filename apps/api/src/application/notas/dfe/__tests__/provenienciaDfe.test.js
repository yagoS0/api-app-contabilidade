import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { xmlResumoData, xmlNfeData, CHAVE_NFE, CNPJ_DATAS } from '../../__fixtures__/dataEmissaoNotas.js';
import { evidenciaDaNota } from '../../dataEmissaoNota.js';
import { reconciliarDatasNotas } from '../../reconciliarDatasNotas.js';
import { criarCapturaDfe, provaDaCapturaDfe } from '../provenienciaDfe.js';
import { upsertNfeFromParsed } from '../../ingestaoNfe.js';
import { parseDocZip } from '../DfeParser.js';
jest.mock('../../CertResolver.js', () => ({ SERVICOS: { DFE: 'DFE' }, resolveCertForCompany: jest.fn(async () => ({ source: 'company_a1', pfxBuffer: Buffer.from('synthetic'), password: 'synthetic' })) }));
jest.mock('../DfeClient.js', () => ({ fetchDistNSU: jest.fn(), DfeClientError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));
jest.mock('../NfeManifestacaoService.js', () => ({ enqueueManifestacao: jest.fn(async () => null) }));
import { fetchDistNSU } from '../DfeClient.js';
import { syncDfeForCompany } from '../DfeSyncService.js';

const recipient = '44555666000177';
const context = { clientId: 'recipient', cnpj: recipient, chave: CHAVE_NFE, xml: xmlResumoData() };
const proof = () => criarCapturaDfe({ ...context, ambiente: 'prod', nsu: '1' });
const row = () => ({ clientId: context.clientId, chaveAcesso: CHAVE_NFE, emitenteDoc: CNPJ_DATAS,
  papel: 'DEST', xmlResumo: context.xml, provenienciaDfe: proof() });
test('receiver summary needs capture evidence; role and row CNPJ alone never prove receipt', () => {
  expect(evidenciaDaNota(row(), { documentoEmpresa: recipient }).civil).toBe('2026-09-27');
  expect(evidenciaDaNota({ ...row(), provenienciaDfe: null }, { documentoEmpresa: recipient }).motivo).toBe('EMPRESA_DIVERGENTE');
  expect(() => provaDaCapturaDfe({ ...proof() }, context)).toThrow('Proveniência DFe inválida');
});
test.each([{ clientId: 'other' }, { cnpj: CNPJ_DATAS }, { chave: '9'.repeat(44) }, { hash: 'fake' }, { ambiente: 'hom' }, { nsu: '' }])('rejects changed proof %j', changed => {
  expect(evidenciaDaNota({ ...row(), provenienciaDfe: { ...proof(), ...changed } }, { documentoEmpresa: recipient }).motivo).toBe('EMPRESA_DIVERGENTE');
});
test('mutated source invalidates persisted proof', () => {
  expect(evidenciaDaNota({ ...row(), xmlResumo: xmlResumoData('2026-09-29T00:00:00Z') }, { documentoEmpresa: recipient }).motivo).toBe('EMPRESA_DIVERGENTE');
});
test('import DTO cannot manufacture a capture capability', async () => {
  let saved;
  const tx = { portalClient: { findUnique: async () => ({ cnpj: recipient }) },
    companyMonthlyCircular: { findFirst: async () => null }, apuracaoSnapshot: { findUnique: async () => null }, apuracao: { findUnique: async () => null },
    portalInvoice: { findUnique: async () => null, upsert: async ({ create }) => (saved = { id: 'n', ...create }) } };
  const parsed = parseDocZip({ schema: 'resNFe_v1.01.xsd', xml: context.xml }, { companyCnpj: recipient }).parsed;
  await upsertNfeFromParsed(tx, { portalClientId: context.clientId, parsed: { ...parsed, provenienciaDfe: proof() }, items: [] });
  expect(saved.dataEmissaoCivil).toBeNull();
  expect(saved.provenienciaDfe).toEqual({});
});

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) && new URL(url).pathname.endsWith('_governance_test');
const suite = local ? describe : describe.skip;
const envelope = (xml, nsu, code = '138') => `<Envelope><Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult><retDistDFeInt><cStat>${code}</cStat><ultNSU>${nsu}</ultNSU><maxNSU>${nsu}</maxNSU>${xml ? `<loteDistDFeInt><docZip NSU="${nsu}" schema="${xml.includes('resNFe') ? 'resNFe_v1.01.xsd' : 'procNFe_v4.00.xsd'}">${gzipSync(xml).toString('base64')}</docZip></loteDistDFeInt>` : ''}</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></Body></Envelope>`;
suite('authenticated capture service, simulated transport and actual PostgreSQL', () => {
  test('supplier summary persists atomically, rereads, reconciles and never replaces full XML', async () => {
    const id = randomUUID(); let created = false;
    const errors = [];
    try {
      await prisma.portalClient.create({ data: { id, cnpj: recipient, razao: 'PROVENIENCIA SINTETICA', status: 'ATIVA' } }); created = true;
      const circular = await prisma.companyMonthlyCircular.create({ data: { portalClientId: id, competencia: '2026-08', estado: 'fechado' } });
      fetchDistNSU.mockResolvedValueOnce({ status: 200, xml: envelope(context.xml, '1') })
        .mockResolvedValueOnce({ status: 200, xml: envelope(null, '1', '137') });
      expect(await syncDfeForCompany({ portalClientId: id })).toMatchObject({ ok: true });
      let saved = await prisma.portalInvoice.findUnique({ where: { clientId_chaveAcesso: { clientId: id, chaveAcesso: CHAVE_NFE } } });
      expect(saved.xmlRaw).toBeNull(); expect(saved.xmlResumo).toBe(context.xml);
      expect(saved.provenienciaDfe).toMatchObject({ clientId: id, cnpj: recipient, nsu: '1', ambiente: 'prod' });
      expect(saved.dataEmissaoCivil).toBe('2026-09-27');
      expect((await reconciliarDatasNotas(prisma, { clientId: id, ids: [saved.id] })).contagens).toEqual({ SEM_ALTERACAO: 1 });
      expect(evidenciaDaNota({ ...saved, clientId: 'other' }, { documentoEmpresa: recipient }).motivo).toBe('EMPRESA_DIVERGENTE');
      const full = parseDocZip({ schema: 'procNFe_v4.00.xsd', xml: xmlNfeData() }, { companyCnpj: recipient });
      await prisma.$transaction(tx => upsertNfeFromParsed(tx, { portalClientId: id, parsed: full.parsed, items: [] }));
      const summary = parseDocZip({ schema: 'resNFe_v1.01.xsd', xml: context.xml }, { companyCnpj: recipient });
      await prisma.$transaction(tx => upsertNfeFromParsed(tx, { portalClientId: id, parsed: summary.parsed, items: [] }));
      saved = await prisma.portalInvoice.findUnique({ where: { id: saved.id } });
      expect(saved.xmlRaw).toBe(xmlNfeData()); expect(saved.provenienciaDfe).toEqual({});
      expect(await prisma.companyMonthlyCircular.findUnique({ where: { id: circular.id } })).toEqual(circular);
      expect(fetchDistNSU).toHaveBeenCalledWith(expect.objectContaining({ cnpj: recipient, env: 'prod', pfxBuffer: expect.any(Buffer) }));
      const beforeError = saved;
      await prisma.portalSyncState.update({ where: { clientId: id }, data: { dfeLastAttemptAt: null, dfeBackoffUntil: null } });
      fetchDistNSU.mockResolvedValueOnce({ status: 200, xml: envelope(context.xml, '2', '593') });
      expect(await syncDfeForCompany({ portalClientId: id })).toMatchObject({ ok: false });
      expect(await prisma.portalInvoice.findUnique({ where: { id: saved.id } })).toEqual(beforeError);
    } catch (error) { errors.push(error); }
    finally {
      try { if (created) await prisma.portalClient.deleteMany({ where: { id, razao: 'PROVENIENCIA SINTETICA' } }); } catch (error) { errors.push(error); }
      try { await prisma.$disconnect(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Captura/limpeza', { cause: errors[0] });
  }, 40000);
});
