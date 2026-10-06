jest.mock('../../../config.js', () => ({ NFSE_ENV: 'homolog' }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../NfseService.js', () => ({ NfseService: { issue: jest.fn() } }));
import { executarRecorrencia, criarRecorrencia, retomarRecorrencia } from '../NfseRecorrenciaService.js';

const modelo = { companyId: 'empresa', tomador: { doc: '11222333000181', nome: 'Tomador fixo' }, servico: { descricao: 'Mensalidade', valorServicos: 1500 }, totTrib: { pTotTribSN: 6 } };
const item = { id: 'rec', companyId: 'empresa', autorizadoPor: 'user', ambiente: 'homolog', versao: 0, ativa: true, dia: 31, proximaData: '2026-10-31', modelo };
function banco() {
  const db = {
    nfseRecorrencia: { updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn(), findUnique: jest.fn(async () => ({ ...item, versao: 1 })), findFirst: jest.fn(), create: jest.fn(async ({ data }) => data) },
    nfseRecorrenciaExecucao: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ ...data, id: 'run' })), update: jest.fn() },
  };
  db.$transaction = async fn => fn(db);
  return db;
}
const now = new Date('2026-10-31T12:00:00Z');
test('reserva mês antes de emitir, mantém valor/tomador e atualiza competência', async () => {
  const db = banco();
  const emitir = jest.fn(async () => {
    expect(db.nfseRecorrenciaExecucao.create).toHaveBeenCalled();
    return { status: 'issued', nfse: { id: 'nota' } };
  });
  await executarRecorrencia(item, { db, now, emitir, autorizar: async () => true });
  expect(emitir.mock.calls[0][0].data).toMatchObject({ companyId: 'empresa', tomador: { doc: modelo.tomador.doc }, servico: { valorServicos: 1500 }, competencia: new Date('2026-10-31T15:00:00Z') });
  expect(db.nfseRecorrenciaExecucao.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EMITIDA', invoiceId: 'nota' }) }));
});
test.each(['revogada', 'ambiente', 'pausada', 'mesAntigo', 'jaExecutando', 'concorrente'])('não envia: %s', async motivo => {
  const db = banco(); const emitir = jest.fn(); const alvo = { ...item };
  if (motivo === 'ambiente') alvo.ambiente = 'producao';
  if (motivo === 'pausada') db.nfseRecorrencia.findUnique.mockResolvedValue({ ...item, ativa: false });
  if (motivo === 'mesAntigo') alvo.proximaData = '2026-09-30';
  if (motivo === 'jaExecutando') db.nfseRecorrenciaExecucao.findFirst.mockResolvedValue({ id: 'anterior' });
  if (motivo === 'concorrente') db.nfseRecorrencia.updateMany.mockResolvedValue({ count: 0 });
  await executarRecorrencia(alvo, { db, now, emitir, autorizar: async () => motivo !== 'revogada' });
  expect(emitir).not.toHaveBeenCalled();
});
test.each(['pending', 'rejected', 'falha_envio'])('pausa ao receber %s sem tentar novamente', async status => {
  const db = banco(); const emitir = jest.fn(async () => ({ status, nfse: { id: 'nota' } }));
  const r = await executarRecorrencia(item, { db, now, emitir, autorizar: async () => true });
  expect(r.status).toBe('REVISAO');
  expect(db.nfseRecorrencia.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ativa: false }) }));
  expect(emitir).toHaveBeenCalledTimes(1);
});
test('timeout fica em revisão, sem retry automático', async () => {
  const db = banco();
  const r = await executarRecorrencia(item, { db, now, emitir: async () => { throw new Error('timeout'); }, autorizar: async () => true });
  expect(r).toMatchObject({ status: 'REVISAO', erro: 'timeout' });
});
test('criação elimina identificadores fiscais e exige confirmação', async () => {
  const db = banco(); db.nfseRecorrencia.findUnique.mockResolvedValue(null);
  const body = { requestId: '12345678-1234-4123-8123-123456789012', dia: 31, inicio: '2026-10-31', confirmada: true, modelo: { ...modelo, retryInvoiceId: 'antiga', numero: 42 } };
  const r = await criarRecorrencia({ companyId: 'empresa', userId: 'u', body, db, hoje: '2026-10-06' });
  expect(r.modelo.retryInvoiceId).toBeUndefined(); expect(r.modelo.numero).toBeUndefined(); expect(r.modelo.competencia).toBeUndefined();
  await expect(criarRecorrencia({ companyId: 'empresa', userId: 'u', body: { ...body, confirmada: false }, db })).rejects.toThrow('Confirme');
});
test('repetir a solicitação de criação devolve a mesma recorrência', async () => {
  const db = banco(); db.nfseRecorrencia.findUnique.mockResolvedValue(null);
  const body = { requestId: '12345678-1234-4123-8123-123456789012', dia: 31, inicio: '2026-10-31', confirmada: true, modelo };
  const existente = await criarRecorrencia({ companyId: 'empresa', userId: 'u', body, db, hoje: '2026-10-06' });
  db.nfseRecorrencia.findUnique.mockResolvedValue(existente);
  const r = await criarRecorrencia({ companyId: 'empresa', userId: 'u', body, db });
  expect(r.id).toBe(existente.id); expect(db.nfseRecorrencia.create).toHaveBeenCalledTimes(1);
  await expect(criarRecorrencia({ companyId: 'empresa', userId: 'u', body: { ...body, dia: 30 }, db })).rejects.toThrow('outros dados');
});
test('retomada não permite repetir o mês da última tentativa', async () => {
  const db = banco(); db.nfseRecorrencia.findFirst.mockResolvedValue({ ...item, ativa: false });
  db.nfseRecorrenciaExecucao.findFirst.mockResolvedValue({ competencia: '2026-10', status: 'REVISAO' });
  await expect(retomarRecorrencia({ companyId: 'empresa', id: 'rec', userId: 'u', inicio: '2026-10-31', db, hoje: '2026-10-06' })).rejects.toThrow('posterior');
});
