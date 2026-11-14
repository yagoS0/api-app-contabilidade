jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  $transaction: jest.fn(), guide: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
} }));
jest.mock('../GuideCompanyEmailService.js', () => ({ sendCompanyGuidesEmail: jest.fn() }));
jest.mock('../GuiaParcelaEnvioGuard.js', () => ({ conferirParcelasParaEnvio: jest.fn() }));

import { prisma } from '../../../infrastructure/db/prisma.js';
import { sendCompanyGuidesEmail } from '../GuideCompanyEmailService.js';
import { conferirParcelasParaEnvio } from '../GuiaParcelaEnvioGuard.js';
import { liberarGuiasCliente, liberarGuiaCliente, revogarLiberacaoCliente } from '../GuideLiberacaoService.js';
import { documentoValido, entregaExternaVigente, revisaoEntrega } from '../EntregaExternaGuiaService.js';
import { conferirEntregaGuiaWhatsapp } from '../EntregaGuiaWhatsappService.js';
import { revisaoDocumentoGuia } from '../../whatsapp/EnvioDocumentoGuiaWhatsappService.js';

const guia = () => ({ id: 'g', portalClientId: 'empresa', competencia: '2026-10', tipo: 'IRPJ',
  status: 'PROCESSED', hash: 'hash-documental', valor: '10.00', vencimento: '2026-11-20',
  pdfBytes: Buffer.from('%PDF-documento-sintetico'), updatedAt: new Date('2026-11-01Z'), liberadaCliente: false });
const pedido = { portalClientId: ' empresa ', competencia: ' 2026-10 ', userId: 42 };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.guide.findMany.mockResolvedValue([]);
  prisma.guide.updateMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation(fn => fn(prisma));
  conferirParcelasParaEnvio.mockResolvedValue(undefined);
  sendCompanyGuidesEmail.mockResolvedValue({ ok: true });
});

test('liberação normaliza entrada, confere todos os documentos e só escreve os ainda não liberados', async () => {
  const pendente = guia(), liberada = { ...guia(), id: 'liberada', liberadaCliente: true };
  const ordem = [];
  prisma.guide.findMany.mockImplementation(async query => { ordem.push('leitura'); return [pendente, liberada]; });
  conferirParcelasParaEnvio.mockImplementation(async () => { ordem.push('conferencia'); });
  prisma.$transaction.mockImplementation(async fn => { ordem.push('transacao'); const r = await fn(prisma); ordem.push('commit'); return r; });
  prisma.guide.updateMany.mockImplementation(async () => { ordem.push('escrita'); return { count: 1 }; });
  sendCompanyGuidesEmail.mockImplementation(async () => { ordem.push('email'); return { ok: true }; });
  expect(await liberarGuiasCliente(pedido)).toEqual({ liberadas: 1, emailResult: { ok: true } });
  expect(ordem).toEqual(['leitura', 'conferencia', 'transacao', 'escrita', 'commit', 'email']);
  expect(prisma.guide.findMany).toHaveBeenCalledWith({ where: { portalClientId: 'empresa', competencia: '2026-10', status: 'PROCESSED' } });
  expect(conferirParcelasParaEnvio).toHaveBeenCalledWith([pendente, liberada]);
  expect(prisma.guide.updateMany).toHaveBeenCalledTimes(1);
  expect(prisma.guide.updateMany).toHaveBeenCalledWith({ where: { id: 'g', portalClientId: 'empresa', updatedAt: pendente.updatedAt,
    competencia: '2026-10', status: 'PROCESSED', liberadaCliente: false }, data: { liberadaCliente: true, liberadaEm: expect.any(Date), liberadaPor: '42' } });
  expect(sendCompanyGuidesEmail).toHaveBeenCalledWith({ portalClientId: 'empresa', competencia: '2026-10' });
});

test('lote já liberado mantém count zero e ainda chama o e-mail depois da transação', async () => {
  prisma.guide.findMany.mockResolvedValue([{ ...guia(), liberadaCliente: true }]);
  expect(await liberarGuiasCliente(pedido)).toEqual({ liberadas: 0, emailResult: { ok: true } });
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(sendCompanyGuidesEmail).toHaveBeenCalledTimes(1);
});

test.each([['SMTP_INCERTO', 'SMTP_INCERTO'], [undefined, 'GUIDE_EMAIL_SEND_FAILED']])('falha de e-mail não desfaz a liberação: %s', async (code, esperado) => {
  prisma.guide.findMany.mockResolvedValue([guia()]);
  prisma.guide.updateMany.mockResolvedValue({ count: 1 });
  sendCompanyGuidesEmail.mockRejectedValue(Object.assign(new Error('falha fictícia'), { code }));
  expect(await liberarGuiasCliente(pedido)).toEqual({ liberadas: 1, emailResult: { ok: false, error: esperado, message: 'falha fictícia' } });
  expect(prisma.guide.updateMany).toHaveBeenCalledTimes(1);
});

test('guarda da parcela precede transação e e-mail; preserva a instância do erro', async () => {
  const erro = Object.assign(new Error('conferir parcela'), { code: 'PARCELA_DOCUMENTO_PENDENTE' });
  conferirParcelasParaEnvio.mockRejectedValue(erro);
  await expect(liberarGuiasCliente(pedido)).rejects.toBe(erro);
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
  expect(sendCompanyGuidesEmail).not.toHaveBeenCalled();
});

test.each([liberarGuiasCliente, revogarLiberacaoCliente])('entrada inválida recusa antes de qualquer acesso', async executar => {
  await expect(executar({ portalClientId: ' ', competencia: '2026-10' })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'portalClientId/competencia inválidos' });
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
});

test('revogação limpa somente os campos de liberação no escopo da empresa/competência', async () => {
  prisma.guide.updateMany.mockResolvedValue({ count: 2 });
  expect(await revogarLiberacaoCliente(pedido)).toEqual({ revogadas: 2 });
  expect(prisma.guide.updateMany).toHaveBeenCalledWith({ where: { portalClientId: 'empresa', competencia: '2026-10', liberadaCliente: true },
    data: { liberadaCliente: false, liberadaEm: null, liberadaPor: null } });
  expect(conferirParcelasParaEnvio).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(sendCompanyGuidesEmail).not.toHaveBeenCalled();
});

test.each([null, { ...guia(), liberadaCliente: true }])('liberação individual mantém count zero e não envia: %j', async documento => {
  prisma.guide.findUnique.mockResolvedValue(documento);
  expect(await liberarGuiaCliente({ guideId: ' g ' })).toEqual({ liberadas: 0 });
  expect(prisma.guide.findUnique).toHaveBeenCalledWith({ where: { id: 'g' } });
  expect(conferirParcelasParaEnvio).toHaveBeenCalledWith(documento ? [documento] : []);
  expect(prisma.guide.updateMany).toHaveBeenCalledWith({ where: { id: 'g', ...(documento ? { updatedAt: documento.updatedAt } : {}), status: 'PROCESSED', liberadaCliente: false },
    data: { liberadaCliente: true, liberadaEm: expect.any(Date), liberadaPor: null } });
  expect(sendCompanyGuidesEmail).not.toHaveBeenCalled();
});

test.each([
  [null, false], [{}, false], [{ status: 'PROCESSED', hash: '' }, false],
  [{ status: 'PROCESSED', hash: 'h' }, false],
  [{ status: 'PROCESSED', hash: 'h', pdfBytes: Buffer.alloc(0) }, false],
  [{ status: 'PROCESSED', hash: 'h', pdfBytes: Buffer.from('outro'), storageKey: 'legado' }, true],
  [{ ...guia(), extracted: { conferenciaDocumentoPendente: true } }, false],
])('documentoValido preserva valor exato sem impor liberação/pagamento: %j', (documento, esperado) => {
  expect(documentoValido(documento)).toBe(esperado);
});

function provaExterna(g) {
  const snapshot = { guideId: g.id, companyId: g.portalClientId, revisaoDocumento: revisaoEntrega(g), atorId: 'contador', registradoEm: '2026-11-14T12:00:00Z' };
  return { snapshot, envio: { canal: 'EXTERNO', status: 'declarado_externo', tentativaAtualId: 'atual', historicoTentativas: [{ id: 'anterior', snapshot: { ...snapshot, atorId: 'anterior' } }, { id: 'atual', snapshot }] } };
}
test('prova externa devolve o snapshot da tentativa atual por identidade, mesmo com guia não liberada', () => {
  const g = guia(), { snapshot, envio } = provaExterna(g);
  expect(entregaExternaVigente(envio, g)).toBe(snapshot);
  expect(entregaExternaVigente({ ...envio, tentativaAtualId: 'ausente' }, g)).toBeNull();
  expect(entregaExternaVigente(envio, { ...g, hash: 'substituida' })).toBeNull();
  expect(entregaExternaVigente(envio, { ...g, portalClientId: 'outra' })).toBeNull();
});

const telefone = '5511999999999';
function recibo(g) {
  return { arquivoSha256: g.hash, snapshot: { revisaoDocumento: revisaoDocumentoGuia(g), guideId: g.id, portalClientId: g.portalClientId,
    telefone, vinculoNumeroId: 'vinculo', competencia: g.competencia, valor: '10', vencimento: '2026-11-20T12:00:00Z' } };
}
const banco = rows => ({ envioGuiaTentativa: { findMany: jest.fn().mockResolvedValue(rows) } });
test('WhatsApp mantém consulta exata, procura qualquer prova válida e retorna undefined sem alterar recibos', async () => {
  const g = guia(), atual = recibo(g), rows = [{ ...atual, arquivoSha256: 'antigo' }, atual], db = banco(rows);
  const antes = JSON.stringify(rows);
  expect(await conferirEntregaGuiaWhatsapp(db, g, telefone, 'vinculo')).toBeUndefined();
  expect(db.envioGuiaTentativa.findMany).toHaveBeenCalledWith({ where: { envioGuia: { guideId: 'g', canal: 'WHATSAPP', destino: telefone },
    status: { in: ['entregue', 'lido'] }, OR: [{ entregueEm: { not: null } }, { lidoEm: { not: null } }] }, select: { arquivoSha256: true, snapshot: true } });
  expect(JSON.stringify(rows)).toBe(antes);
});

test.each([{ revisaoDocumento: 'antiga' }, { guideId: 'outra' }, { portalClientId: 'outra' }, { telefone: 'outro' },
  { vinculoNumeroId: 'anterior' }, { competencia: '2026-09' }, { valor: '10.01' }, { vencimento: '2026-11-21' }])('WhatsApp rejeita prova divergente %j', async patch => {
  const g = guia(), t = recibo(g); Object.assign(t.snapshot, patch);
  await expect(conferirEntregaGuiaWhatsapp(banco([t]), g, telefone, 'vinculo')).rejects.toMatchObject({ code: 'GUIA_WHATSAPP_NAO_ENTREGUE',
    message: 'Guia sem entrega confirmada da versão atual no WhatsApp final 9999. Confira o envio da guia; o lembrete não será enviado.' });
});

test('vínculo omitido não acrescenta exigência e hash ausente não elimina a consulta anterior', async () => {
  const g = guia(), t = recibo(g); t.snapshot.vinculoNumeroId = 'legado';
  expect(await conferirEntregaGuiaWhatsapp(banco([t]), g, telefone)).toBeUndefined();
  const db = banco([t]);
  await expect(conferirEntregaGuiaWhatsapp(db, { ...g, hash: null }, telefone)).rejects.toMatchObject({ code: 'GUIA_WHATSAPP_NAO_ENTREGUE' });
  expect(db.envioGuiaTentativa.findMany).toHaveBeenCalledTimes(1);
});
