jest.mock('../../../../accounting/fechamentoContabil.js', () => ({ bloquearFechamentoContabil: jest.fn(), isMonthClosed: jest.fn(async () => false) }));
jest.mock('../../../pendenciasDoPeriodo.js', () => ({ registrarPendenciaDoPeriodo: jest.fn(), mesFiscal: value => new Date(value).toISOString().slice(0, 7) }));
jest.mock('../../../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn(async () => ({ cnpj: '53742042000164' })) },
  $transaction: jest.fn(),
  portalInvoice: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
  companyMonthlyCircular: { findUnique: jest.fn(async () => ({ id: 'circular' })), update: jest.fn() },
  apuracaoSnapshot: { findUnique: jest.fn(async () => ({ id: 'snapshot', conferenciaStatus: 'divergente', conferenciaResultado: { faltantes: ['anterior'] } })), update: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
} }));
jest.mock('../../../CertResolver.js', () => ({ SERVICOS: { NFSE: 'NFSE' }, resolveCertForCompany: jest.fn() }));
jest.mock('../../../adn-nacional/AdnNacionalClient.js', () => ({ fetchDfeNFSe: jest.fn() }));
jest.mock('../../../../nfse/AdnXmlMetadata.js', () => ({ parseXmlMetadata: jest.fn(), parseNfseEvento: jest.fn() }));
jest.mock('../FechamentoService.js', () => ({ faturamentoEmitDaCompetencia: jest.fn(async () => 0) }));
import { bloquearFechamentoContabil, isMonthClosed } from '../../../../accounting/fechamentoContabil.js';
import { registrarPendenciaDoPeriodo } from '../../../pendenciasDoPeriodo.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../../infrastructure/db/prisma.js';
import { resolveCertForCompany } from '../../../CertResolver.js';
import { fetchDfeNFSe } from '../../../adn-nacional/AdnNacionalClient.js';
import { parseXmlMetadata } from '../../../../nfse/AdnXmlMetadata.js';
import { conferirCompetencia, scanAdnAutoritativo } from '../ConferenciaAdnService.js';
import { marcarSemFaturamento } from '../../../../accounting/semFaturamento.js';
const args = { portalClientId: 'empresa-a', competencia: '2026-10' };
const item = nsu => ({ NSU: String(nsu), TipoDocumento: 'NFSE', ArquivoXml: Buffer.from('<teste/>').toString('base64') });
beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async fn => fn(prisma));
  prisma.portalInvoice.findMany.mockResolvedValue([]);
  prisma.portalInvoice.updateMany.mockResolvedValue({ count: 1 });
  prisma.apuracaoSnapshot.updateMany.mockReset().mockResolvedValue({ count: 1 });
  isMonthClosed.mockResolvedValue(false);
  registrarPendenciaDoPeriodo.mockReset().mockResolvedValue(null);
  resolveCertForCompany.mockResolvedValue({ source: 'company_a1', pfxBuffer: Buffer.from('fake'), password: 'fake' });
  fetchDfeNFSe.mockReset();
  parseXmlMetadata.mockReturnValue({ chaveAcesso: 'chave', competencia: '2026-10-01', cnpjPrestador: '53742042000164' });
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue({ id: 'snapshot', conferenciaStatus: 'divergente', conferenciaResultado: { faltantes: ['anterior'] } });
  prisma.apuracaoSnapshot.updateMany.mockResolvedValue({ count: 1 });
});

test.each([undefined, [], [{ Codigo: 'E2220', Descricao: 'privado' }]].map(errors => [errors]))('fim vazio oficial aceita erros %j', async errors => {
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors });
  expect(await conferirCompetencia(args)).toMatchObject({ status: 'ok', resultado: { alcancouFim: true }, persistido: true });
  expect(prisma.apuracaoSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'ok', conferidaEm: expect.any(Date) }) }));
});

test.each([
  { status: 'REJEICAO', items: [], errors: [{ Codigo: 'E2220' }] },
  { status: 'DESCONHECIDO', items: [], errors: [{ Codigo: 'E2220' }] },
  { status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [item(1)], errors: [{ Codigo: 'E2220' }] },
  { status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: [{ Codigo: 'E2220' }, { Codigo: 'E2245' }] },
  { status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: [{ Codigo: 'E2220' }, { Codigo: 'segredo' }] },
  { status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: [{ Codigo: 'E2230' }] },
])('fim incoerente não conclui conferência %j', async batch => {
  fetchDfeNFSe.mockResolvedValueOnce(batch);
  await expect(conferirCompetencia(args)).rejects.toHaveProperty('code');
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
});

test.each(['ok', 'divergente'])('%s anterior seguido de falhas mantém evidência limitada e contrato de ausência', async status => {
  const dataAnterior = new Date('2026-11-01T10:00:00Z');
  const resultadoAnterior = { nossoTotal: 0, adnTotal: status === 'ok' ? 0 : 1, faltantes: status === 'ok' ? [] : ['faltante'], extras: ['extra'], canceladasNoAdn: ['cancelada'] };
  let snapshot = { id: 'snapshot', conferenciaStatus: status, conferidaEm: dataAnterior, conferenciaResultado: resultadoAnterior };
  prisma.apuracaoSnapshot.findUnique.mockImplementation(async () => snapshot);
  prisma.apuracaoSnapshot.updateMany.mockImplementation(async ({ data }) => { snapshot = { ...snapshot, ...data }; return { count: 1 }; });
  fetchDfeNFSe.mockResolvedValue({ status: 'REJEICAO', items: [], errors: [{ Codigo: 'E2245', Descricao: 'segredo' }] });
  for (let i = 0; i < 3; i++) await expect(conferirCompetencia(args)).rejects.toMatchObject({ code: 'ADN_REJEICAO' });
  expect(snapshot.conferidaEm).toBeNull();
  expect(snapshot.conferenciaStatus).toBe(status === 'ok' ? 'nao_conferivel' : 'divergente');
  expect(snapshot.conferenciaResultado.evidenciaAnterior).toEqual({ status, conferidaEm: dataAnterior.toISOString(), resultado: resultadoAnterior });
  expect(snapshot.conferenciaResultado.ultimaTentativa).toMatchObject({ motivo: 'ADN_REJEICAO', errors: [{ code: 'E2245' }] });
  expect(JSON.stringify(snapshot)).not.toContain('segredo');
  const ausencia = await marcarSemFaturamento({ ...args, ok: true, userId: 'contador' });
  if (status === 'divergente') {
    expect(snapshot.conferenciaResultado).toMatchObject({ faltantes: ['faltante'], extras: ['extra'], canceladasNoAdn: ['cancelada'] });
    expect(ausencia).toMatchObject({ ok: false, error: 'SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE', faltantes: 1 });
  } else {
    expect(ausencia).toMatchObject({ ok: true, conferencia: 'nao_conferivel' });
  }
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: [{ Codigo: 'E2220' }] });
  expect(await conferirCompetencia(args)).toMatchObject({ status: 'ok', persistido: true });
  expect(prisma.apuracaoSnapshot.update).toHaveBeenLastCalledWith({ where: { id: 'snapshot' }, data: expect.objectContaining({ conferenciaStatus: 'ok', conferidaEm: expect.any(Date), conferenciaResultado: expect.objectContaining({ faltantes: [], adnTotal: 0 }) }) });
});

test('falha tardia usa revisão lida antes do transporte e não sobrescreve gravação concorrente', async () => {
  const snap = { id: 'snapshot', conferenciaStatus: 'ok', conferidaEm: new Date('2026-11-01'), conferenciaResultado: { faltantes: [] } };
  prisma.apuracaoSnapshot.findUnique.mockResolvedValueOnce(snap);
  prisma.apuracaoSnapshot.updateMany.mockResolvedValueOnce({ count: 0 });
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'REJEICAO', items: [] });
  await expect(conferirCompetencia(args)).rejects.toMatchObject({ code: 'ADN_REJEICAO' });
  expect(prisma.apuracaoSnapshot.updateMany.mock.calls[0][0].where).toMatchObject({ id: snap.id, conferenciaStatus: 'ok', conferidaEm: snap.conferidaEm, conferenciaResultado: { equals: snap.conferenciaResultado } });
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
});

test('sem snapshot a rejeição continua falha, sem inventar conferência persistida', async () => {
  prisma.apuracaoSnapshot.findUnique.mockResolvedValueOnce(null);
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'REJEICAO', items: [] });
  await expect(conferirCompetencia(args)).rejects.toMatchObject({ code: 'ADN_REJEICAO' });
  expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
});

test('falha na gravação da tentativa não anuncia sucesso', async () => {
  prisma.apuracaoSnapshot.updateMany.mockRejectedValueOnce(new Error('persistência indisponível'));
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'REJEICAO', items: [] });
  await expect(conferirCompetencia(args)).rejects.toThrow('persistência indisponível');
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test.each([
  [{ status: 'REJEICAO', items: [], errors: [{ Codigo: 'E0718', Descricao: 'segredo' }] }, 'ADN_REJEICAO'],
  [{ status: 'DESCONHECIDO', items: [] }, 'ADN_RESPOSTA_INCONCLUSIVA'],
  [{ status: 'DOCUMENTOS_LOCALIZADOS', items: [] }, 'ADN_RESPOSTA_INCONCLUSIVA'],
  [{ status: 'DOCUMENTOS_LOCALIZADOS', items: [item(1)], errors: [{ code: 'E001' }] }, 'ADN_COLETA_INCOMPLETA'],
  [{ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: ['segredo'] }, 'ADN_COLETA_INCOMPLETA'],
  [{ status: 'DOCUMENTOS_LOCALIZADOS', items: [{ NSU: '1' }] }, 'ADN_COLETA_INCOMPLETA'],
  [{ status: 'DOCUMENTOS_LOCALIZADOS', items: [item(0)] }, 'ADN_CURSOR_SEM_AVANCO'],
])('falha %j preserva evidência anterior', async (batch, code) => {
  fetchDfeNFSe.mockResolvedValueOnce(batch);
  await expect(conferirCompetencia(args)).rejects.toMatchObject({ code });
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'divergente', conferidaEm: null, conferenciaResultado: expect.objectContaining({ faltantes: ['anterior'] }) }) }));
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test.each(['CERT_STORAGE_UNAVAILABLE', 'CERT_PASSWORD_DECRYPT_FAILED', 'CERT_CNPJ_MISMATCH'])("certificado %s preserva erro tipado", async code => {
  resolveCertForCompany.mockRejectedValueOnce(Object.assign(new Error('segredo 12345678000199'), { code }));
  await expect(conferirCompetencia(args)).rejects.toMatchObject({ code });
  expect(fetchDfeNFSe).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'divergente', conferidaEm: null, conferenciaResultado: expect.objectContaining({ faltantes: ['anterior'] }) }) }));
});
test('ausência explícita conserva evidência anterior sem transporte', async () => {
  resolveCertForCompany.mockRejectedValueOnce(Object.assign(new Error('ausente'), { code: 'NO_CERT_AVAILABLE' }));
  expect(await conferirCompetencia(args)).toMatchObject({ status: 'divergente', persistido: true });
  expect(fetchDfeNFSe).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'divergente', conferidaEm: null, conferenciaResultado: expect.objectContaining({ faltantes: ['anterior'] }) }) }));
});
test('fim comprovado vazio pode registrar conferência', async () => {
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: [] });
  expect(await conferirCompetencia(args)).toMatchObject({ status: 'ok', persistido: true });
  expect(prisma.apuracaoSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'ok', conferidaEm: expect.any(Date) }) }));
});
test('paginação usa último NSU exclusivo, sem pular o seguinte', async () => {
  const timer = jest.spyOn(global, 'setTimeout').mockImplementation(fn => { queueMicrotask(fn); return 0; });
  try {
    fetchDfeNFSe.mockResolvedValueOnce({ status: 'DOCUMENTOS_LOCALIZADOS', items: Array.from({ length: 50 }, (_, i) => item(i + 1)) })
      .mockResolvedValueOnce({ status: 'DOCUMENTOS_LOCALIZADOS', items: [item(51)] });
    expect(await scanAdnAutoritativo(args)).toMatchObject({ disponivel: true, alcancouFim: true });
    expect(fetchDfeNFSe.mock.calls[1][0].ultNSU).toBe('50');
    expect(parseXmlMetadata).toHaveBeenCalledTimes(51);
  } finally { timer.mockRestore(); }
});
test('limite de páginas não grava sucesso ou cancelamentos', async () => {
  const timer = jest.spyOn(global, 'setTimeout').mockImplementation(fn => { queueMicrotask(fn); return 0; });
  try {
    let page = 0;
    fetchDfeNFSe.mockImplementation(async () => ({ status: 'DOCUMENTOS_LOCALIZADOS', items: Array.from({ length: 50 }, (_, i) => item(++page)) }));
    await expect(conferirCompetencia(args)).rejects.toMatchObject({ code: 'ADN_LIMITE_PAGINACAO' });
    expect(fetchDfeNFSe).toHaveBeenCalledTimes(400);
    expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'divergente', conferidaEm: null, conferenciaResultado: expect.objectContaining({ faltantes: ['anterior'] }) }) }));
    expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
  } finally { timer.mockRestore(); }
});

const cancelamento = () => {
  const nota = { id: 'nota', chaveAcesso: 'chave', competencia: new Date('2026-10-01'),
    updatedAt: new Date('2026-11-01'), papel: 'EMIT', total: 25 };
  prisma.portalInvoice.findMany.mockResolvedValue([nota]);
  parseXmlMetadata.mockReturnValue({ chaveAcesso: 'chave', competencia: '2026-10-01', cnpjPrestador: '53742042000164', situacao: 'CANCELADA' });
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'DOCUMENTOS_LOCALIZADOS', items: [item(1)] });
  return nota;
};
test.each(['divergencia', 'invalidacao'])('sucesso tardio após %s é recusado antes dos efeitos', async () => {
  cancelamento();
  prisma.apuracaoSnapshot.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(conferirCompetencia(args)).rejects.toMatchObject({ code: 'CONFERENCIA_ADN_OBSOLETA', status: 409 });
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
  expect(registrarPendenciaDoPeriodo).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
});
test('CAS trata JSON SQL/JSON nulo explicitamente', async () => {
  const snap = { id: 'snapshot', conferenciaStatus: null, conferenciaResultado: null, updatedAt: new Date('2026-11-01'), estado: 'calculada', idempotencyKey: 'calculo' };
  prisma.apuracaoSnapshot.findUnique.mockResolvedValueOnce(snap);
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [] });
  await conferirCompetencia(args);
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ updatedAt: snap.updatedAt, estado: snap.estado, idempotencyKey: snap.idempotencyKey, conferenciaResultado: { equals: Prisma.AnyNull } }) }));
});
test('snapshot criado durante o scan recusa sucesso sem efeitos', async () => {
  prisma.apuracaoSnapshot.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'novo' });
  cancelamento();
  await expect(conferirCompetencia(args)).rejects.toHaveProperty('code', 'CONFERENCIA_ADN_OBSOLETA');
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test('sem snapshot não fabrica apuração', async () => {
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [] });
  expect(await conferirCompetencia(args)).toMatchObject({ persistido: false, status: 'ok' });
  expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
});
test('mês fechado recusa cancelamento sem sucesso final', async () => {
  cancelamento(); isMonthClosed.mockResolvedValueOnce(true);
  await expect(conferirCompetencia(args)).rejects.toHaveProperty('code', 'MES_CONTABIL_FECHADO_REQUER_REVISAO');
  expect(bloquearFechamentoContabil).toHaveBeenCalledWith(prisma, args.portalClientId);
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
});
test('cancelamento e aviso usam a mesma transação; falha de aviso impede conclusão', async () => {
  const nota = cancelamento(); registrarPendenciaDoPeriodo.mockRejectedValueOnce(new Error('aviso indisponível'));
  await expect(conferirCompetencia(args)).rejects.toThrow('aviso indisponível');
  expect(registrarPendenciaDoPeriodo).toHaveBeenCalledWith(prisma, expect.objectContaining({ notaId: nota.id, evento: 'evento_retroativo', origem: 'EVENTO_ADN', competencia: nota.competencia }));
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
});
test('cancelamento válido registra contagem real e aviso na mesma transação', async () => {
  cancelamento();
  expect(await conferirCompetencia(args)).toMatchObject({ status: 'ok', persistido: true, resultado: { marcadasCanceladas: 1 } });
  expect(registrarPendenciaDoPeriodo).toHaveBeenCalledTimes(1);
  expect(prisma.apuracaoSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaResultado: expect.objectContaining({ marcadasCanceladas: 1 }) }) }));
});
test('serialização recusada não repete transporte', async () => {
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [] });
  prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('serialização'), { code: 'P2034' }));
  await expect(conferirCompetencia(args)).rejects.toHaveProperty('code', 'CONFERENCIA_ADN_OBSOLETA');
  expect(fetchDfeNFSe).toHaveBeenCalledTimes(1);
});
