jest.mock('../../fiscal/serpro/PgdasHistoricoService.js', () => ({ arquivoHistoricoPgdas: jest.fn(async () => 'private/file.pdf') }));
import { arquivoHistoricoPgdas } from '../../fiscal/serpro/PgdasHistoricoService.js';
import { readTransmissionDocuments, downloadTransmissionDocument, prepareTransmissionArchive } from '../OperationsTransmissionDocuments.js';

// Minimal real PDF, with object offsets and cross-reference table, no fiscal data.
function pdfFixture() {
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, content] of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'].entries()) {
    offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${content}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}
function setup() {
  const selection = { companyId: 'a', competencia: '2026-10', releaseId: 'release', versionId: 'a'.repeat(64), tipo: 'extrato' };
  const version = { id: selection.versionId, companyId: 'a', competencia: '2026-10', numeroDeclaracao: '123', receitaBruta: 0, dasTotal: 17, declaracaoFileId: 'private/file.pdf', reciboFileId: 'private/receipt.pdf' };
  const execution = { companyId: 'a', competencia: '2026-10', status: 'DONE', evolucaoDocumental: { releaseId: 'release', calculoId: 'old-calculation', proofHash: 'b'.repeat(64), documento: { portalClientId: 'a', competencia: '2026-10', numeroDeclaracao: '123', declaracaoFileId: version.declaracaoFileId, reciboFileId: version.reciboFileId } } };
  const records = [{ key: 'operations_execution:a:2026-10:release', value: execution }, { key: `pgdas_historico:a:2026-10:${version.id}`, value: version }];
  const db = { appSetting: { findMany: jest.fn(async ({ where }) => records.filter(r => r.key.startsWith(where.key.startsWith))) }, apuracaoSnapshot: { findUnique: jest.fn(() => { throw Error('Mutable snapshot must not be read'); }) } };
  const storage = { downloadBuffer: jest.fn(async () => pdfFixture()) };
  return { selection, version, execution, records, db, storage };
}
beforeEach(() => jest.clearAllMocks());
test('binds historical values to calculation/document identity, never current reopened snapshot or storage keys', async () => {
  const { db } = setup();
  const data = await readTransmissionDocuments(db, 'a', '2026-10');
  expect(data.items).toHaveLength(1);
  expect(data.items[0]).toMatchObject({ calculoId: 'old-calculation', receitaBruta: 0, dasTotal: 17, documentos: { extrato: true, recibo: true } });
  expect(JSON.stringify(data)).not.toContain('private/');
  expect(db.apuracaoSnapshot.findUnique).not.toHaveBeenCalled();
});
test.each(['company', 'period', 'file', 'receipt', 'proof', 'release', 'legacy', 'missing', 'ambiguous', 'key'])('refuses incomplete or conflicting join: %s', async kind => {
  const { db, execution, version, records } = setup();
  if (kind === 'company') version.companyId = 'other';
  if (kind === 'period') version.competencia = '2026-09';
  if (kind === 'file') version.declaracaoFileId = 'other';
  if (kind === 'receipt') version.reciboFileId = 'other';
  if (kind === 'proof') execution.evolucaoDocumental.proofHash = null;
  if (kind === 'release') execution.evolucaoDocumental.releaseId = 'other';
  if (kind === 'legacy') version.legado = true;
  if (kind === 'missing') delete execution.evolucaoDocumental;
  if (kind === 'ambiguous') records.push({ key: `pgdas_historico:a:2026-10:${'c'.repeat(64)}`, value: { ...version, id: 'c'.repeat(64) } });
  if (kind === 'key') version.id = 'd'.repeat(64);
  const out = await readTransmissionDocuments(db, 'a', '2026-10');
  expect(out.items).toEqual([]); expect(out.unavailable).toHaveLength(1);
});
test('download resolves exact immutable version; receipt is distinct from extract', async () => {
  const { db, storage, selection } = setup();
  const result = await downloadTransmissionDocument(db, storage, { ...selection, tipo: 'recibo' });
  expect(result.buffer).toEqual(pdfFixture());
  expect(arquivoHistoricoPgdas).toHaveBeenCalledWith('a', '2026-10', selection.versionId, 'recibo', db);
  expect(storage.downloadBuffer).toHaveBeenCalledWith({ key: 'private/file.pdf' });
});
test.each(['corrupt', 'fake-pdf', 'large', 'missing', 'changed'])('download refuses %s without external recovery', async kind => {
  const { db, storage, selection, version } = setup();
  if (kind === 'corrupt') storage.downloadBuffer.mockResolvedValue(Buffer.from('<html>not PDF</html>'));
  if (kind === 'fake-pdf') storage.downloadBuffer.mockResolvedValue(Buffer.from('%PDF-1.4\nnot a document\n%%EOF\n'));
  if (kind === 'large') storage.downloadBuffer.mockResolvedValue(Buffer.alloc(8 * 1024 * 1024 + 1));
  if (kind === 'missing') storage.downloadBuffer.mockRejectedValue(Error('private/path'));
  if (kind === 'changed') version.declaracaoFileId = 'replaced';
  await expect(downloadTransmissionDocument(db, storage, selection)).rejects.toMatchObject({ status: kind === 'missing' || kind === 'changed' ? 404 : 422 });
});
test('partial archive authorizes every item, hides denied identity and reports missing file', async () => {
  const { db, storage, selection } = setup();
  const authorize = jest.fn(async id => id === 'a');
  const out = await prepareTransmissionArchive(db, storage, [selection, { ...selection, companyId: 'secret-company' }, { ...selection, versionId: 'c'.repeat(64) }], authorize);
  expect(out.files).toHaveLength(1);
  expect(out.manifest).toMatchObject({ completo: false, incluidos: 1, solicitados: 3 });
  expect(out.manifest.results[1]).toEqual({ item: 2, status: 'INDISPONIVEL' });
  expect(JSON.stringify(out.manifest)).not.toContain('secret-company');
  expect(storage.downloadBuffer).toHaveBeenCalledTimes(1);
});
test('ACL revoked after storage prevents inclusion; duplicate selection rejected', async () => {
  const { db, storage, selection } = setup();
  const authorize = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const out = await prepareTransmissionArchive(db, storage, [selection], authorize);
  expect(out.files).toEqual([]); expect(out.manifest.completo).toBe(false);
  await expect(prepareTransmissionArchive(db, storage, [selection, selection], authorize)).rejects.toMatchObject({ status: 422 });
});
test('bounds count and rejects invalid competence before database reads', async () => {
  const { db, storage, selection } = setup();
  await expect(prepareTransmissionArchive(db, storage, Array(31).fill(selection), jest.fn())).rejects.toMatchObject({ status: 422 });
  await expect(readTransmissionDocuments(db, 'a', '2026-13')).rejects.toMatchObject({ status: 422 });
  expect(db.appSetting.findMany).not.toHaveBeenCalled();
});

test('confirmation comes only from a persisted confirm result, never schedule timestamp', async()=>{
 const f=setup();f.records.push({key:'operations_request:u:confirm',value:{companyId:'a',competencia:'2026-10',action:'confirm',userId:'u',result:{companyId:'a',competencia:'2026-10',status:'CONFIRMED',changedAt:'2026-11-01T12:00:00Z',fingerprint:'revision'}}});
 expect((await readTransmissionDocuments(f.db,'a','2026-10')).confirmation).toEqual({at:'2026-11-01T12:00:00Z',by:'u',fingerprint:'revision'});
 f.records.at(-1).value.action='schedule';expect((await readTransmissionDocuments(f.db,'a','2026-10')).confirmation).toBeNull();
});
