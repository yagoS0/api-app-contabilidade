import { hashCanonico, nsuDocumento, processarDocumentoSyncLocal, upsertPortalInvoiceSafe } from '../ProcessadorDocumentoSyncLocal.js';
import { xmlNfseData, CHAVE_NFSE, CNPJ_DATAS } from '../../notas/__fixtures__/dataEmissaoNotas.js';
import { parseXmlMetadata } from '../../nfse/AdnXmlMetadata.js';

test('canonical hash is independent of object order but preserves arrays and content', () => {
  expect(hashCanonico({ b: 2, a: { d: 4, c: 3 } })).toBe(hashCanonico({ a: { c: 3, d: 4 }, b: 2 }));
  expect(hashCanonico([1, 2])).not.toBe(hashCanonico([2, 1]));
});
test.each([undefined, '', '-1', '1.1', 9007199254740992, {}, true])('invalid NSU %j never invents an identity', value => {
  expect(() => nsuDocumento({ NSU: value })).toThrow('DOCUMENTO_SEM_NSU');
});
test('NSU retains integer precision and normalizes leading zeroes', () => {
  expect(nsuDocumento({ NSU: '0009007199254740993' })).toBe('9007199254740993');
});
test('delivery replay excludes receive time/cursor and does not mutate invoice or event', async () => {
  let saved;
  const tx = { portalClient: { findUnique: async () => ({ id: 'a', cnpj: CNPJ_DATAS }) },
    syncDocumentoEntrega: { findUnique: async () => saved } };
  const snapshot = { clientId: 'a', origem: 'ADN_SYNC', recebidoEm: 'today', cursor: '1',
    item: { NSU: '2', ChaveAcesso: CHAVE_NFSE, ArquivoXml: Buffer.from(xmlNfseData()).toString('base64') } };
  saved = { chaveAcesso: CHAVE_NFSE, conteudoHash: hashCanonico({ tipoDocumento: null, tipoEvento: null,
    dataHoraGeracao: null, chaveAcesso: CHAVE_NFSE, xmlRaw: xmlNfseData() }), resultado: { invoiceId: 'n', nsu: '2' } };
  expect(await processarDocumentoSyncLocal(tx, snapshot)).toEqual({ invoiceId: 'n', nsu: '2', action: 'duplicate' });
  expect(await processarDocumentoSyncLocal(tx, { ...snapshot, recebidoEm: 'tomorrow', cursor: '0' })).toMatchObject({ action: 'duplicate' });
  await expect(processarDocumentoSyncLocal(tx, { ...snapshot, item: { ...snapshot.item,
    ArquivoXml: Buffer.from(xmlNfseData({ data: '2026-10-01T00:00:00Z' })).toString('base64') } }))
    .rejects.toMatchObject({ code: 'NSU_CONTEUDO_CONFLITANTE' });
});

function documentDb({ closed = [], existing = true, fiscal = 'aberto' } = {}) {
  const row = existing ? { id: 'n', clientId: 'a', chaveAcesso: CHAVE_NFSE, xmlRaw: xmlNfseData(),
    competencia: new Date('2026-08-01'), status: 'EMITIDA', total: 100 } : null;
  const tx = { $executeRaw: jest.fn(async () => 1),
    portalClient: { findUnique: async () => ({ cnpj: CNPJ_DATAS }) },
    companyMonthlyCircular: {
      findUnique: jest.fn(async ({ where }) => ({ fechadoContabilEm: closed.includes(where.portalClientId_competencia.competencia) ? new Date() : null })),
      findFirst: async () => ({ estado: fiscal }),
    }, apuracaoSnapshot: { findUnique: async () => null }, apuracao: { findUnique: async () => null },
    portalInvoice: { findUnique: async () => row, findFirst: async () => row,
      updateMany: jest.fn(async ({ data }) => { Object.assign(row, data); return { count: 1 }; }),
      create: jest.fn(async ({ data }) => ({ id: 'n', ...data })) },
    pendenciaPosFechamento: { upsert: jest.fn() },
  };
  return { tx, row };
}
const doc = patch => ({ type: 'NFSE', chaveAcesso: CHAVE_NFSE, xmlRaw: xmlNfseData(),
  competencia: new Date('2026-08-01'), emitenteDoc: CNPJ_DATAS, status: 'EMITIDA', total: 200, ...patch });

test.each([true, false])('mês contábil fechado recusa documento existente=%s antes de gravar', async existing => {
  const { tx, row } = documentDb({ existing, closed: ['2026-08'] });
  const before = JSON.stringify(row);
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc() }))
    .rejects.toMatchObject({ code: 'MES_CONTABIL_FECHADO_REQUER_REVISAO', status: 409 });
  expect(JSON.stringify(row)).toBe(before);
  expect(tx.portalInvoice.updateMany).not.toHaveBeenCalled(); expect(tx.portalInvoice.create).not.toHaveBeenCalled();
  expect(tx.companyMonthlyCircular.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { portalClientId_competencia: { portalClientId: 'a', competencia: '2026-08' } },
  }));
});
test('fiscal fechado também não resolve recaptura conflitante mediante status-only', async () => {
  const { tx } = documentDb({ fiscal: 'fechado' });
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc() }))
    .rejects.toMatchObject({ code: 'PERIODO_FISCAL_FECHADO_REQUER_REVISAO' });
  expect(tx.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test('competência desconhecida não é substituída pela emissão', async () => {
  const { tx } = documentDb();
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc({
    competencia: null, issueDate: new Date('2026-08-01'), xmlRaw: xmlNfseData().replace('<dCompet>2026-08-01</dCompet>', ''),
  }) })).rejects.toMatchObject({ code: 'COMPETENCIA_DOCUMENTAL_DESCONHECIDA' });
  expect(tx.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test('guarda confere mês documental e persistido antes de recusar divergência', async () => {
  const { tx } = documentDb({ closed: ['2026-09'] });
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc({ competencia: new Date('2026-09-01'),
    xmlRaw: xmlNfseData().replace('2026-08-01', '2026-09-01') }) }))
    .rejects.toMatchObject({ code: 'MES_CONTABIL_FECHADO_REQUER_REVISAO' });
  expect(tx.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test('ambos abertos preservam competência e aceitam atualização documental', async () => {
  const { tx, row } = documentDb();
  await upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc() });
  expect(row.total).toBe(200); expect(row.competencia).toEqual(new Date('2026-08-01'));
});

test.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-02-00', '2026-02',
  '2026-02-28suffix', '2026-02-28T00:00:00Z'].flatMap(literal =>
  [false, true].flatMap(existing => [undefined, new Date('2026-03-02')].map(payload => [literal, existing, payload]))))(
  'literal %s, existente=%s, payload=%s: nunca normaliza nem grava', async (literal, existing, payload) => {
    const { tx, row } = documentDb({ existing, closed: ['2026-02'] });
    const before = JSON.stringify(row);
    const source = xmlNfseData().replace('2026-08-01', literal);
    expect(parseXmlMetadata(source).competenciaOriginal).toBe(literal);
    await expect(upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc({ competencia: payload, xmlRaw: source }) }))
      .rejects.toMatchObject({ code: 'COMPETENCIA_DOCUMENTAL_INVALIDA', status: 409 });
    expect(JSON.stringify(row)).toBe(before);
    expect(tx.portalInvoice.updateMany).not.toHaveBeenCalled(); expect(tx.portalInvoice.create).not.toHaveBeenCalled();
  });

test.each(['2026-02-28', '2028-02-29'])('data civil válida %s permanece no mês documental', async literal => {
  const { tx } = documentDb({ existing: false });
  const result = await upsertPortalInvoiceSafe({ clientId: 'a', tx,
    data: doc({ competencia: undefined, xmlRaw: xmlNfseData().replace('2026-08-01', literal) }) });
  expect(result.invoice.competencia).toEqual(new Date(`${literal}T00:00:00Z`));
});

test.each([
  xmlNfseData().replace('<dCompet>2026-08-01</dCompet>', '').replace('</infNFSe>', '<dCompet>2026-02-28</dCompet></infNFSe>'),
  xmlNfseData().replace('<dCompet>2026-08-01</dCompet>', '<other><dCompet>2026-02-28</dCompet></other>'),
])('dCompet em caminho errado não fornece competência', async source => {
  const { tx } = documentDb({ existing: false });
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc({ xmlRaw: source, competencia: undefined }) }))
    .rejects.toMatchObject({ code: 'COMPETENCIA_DOCUMENTAL_DESCONHECIDA' });
  expect(tx.portalInvoice.create).not.toHaveBeenCalled();
});

test.each(['2026-02-28', '2026-02-28T10:00:00', '2028-02-29T10:00:00-03:00'])(
  'Competencia ABRASF conserva formato ISO suportado %s', async literal => {
    const { tx } = documentDb({ existing: false });
    const source = `<CompNfse><Nfse><InfNfse><Competencia>${literal}</Competencia></InfNfse></Nfse></CompNfse>`;
    const result = await upsertPortalInvoiceSafe({ clientId: 'a', tx, data: doc({ xmlRaw: source, competencia: undefined }) });
    expect(result.invoice.competencia).toEqual(new Date(`${literal.slice(0, 10)}T00:00:00Z`));
  });
