jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarEntregaExternaGuia, revisaoEntrega, entregaExternaVigente, reservarSemEntregaExterna } from '../EntregaExternaGuiaService.js';
import { foiEnviadaComLegado, STATUS_TERMINAL } from '../EnvioGuiaService.js';

function setup() {
  const g = { id: 'g', portalClientId: 'c', status: 'PROCESSED', hash: 'pdf', pdfBytes: Buffer.from('%PDF-1.4\nTeste'), tipo: 'SIMPLES', competencia: '2026-10', updatedAt: new Date(), paymentStatus: 'OPEN' };
  const envios = [], tentativas = [], auditoria = new Map();
  const db = { companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    guide: { findFirst: jest.fn(async ({ where }) => where.id === g.id && where.portalClientId === g.portalClientId ? { ...g } : null), findUnique: jest.fn(async () => ({ ...g })), updateMany: jest.fn(async () => ({ count: 1 })) },
    envioGuia: { findFirst: jest.fn(async ({ where }) => envios.find(e => e.guideId === where.guideId && (typeof where.canal === 'object' ? e.canal !== where.canal.not && e.status === where.status : e.canal === where.canal)) || null),
      create: jest.fn(async ({ data }) => { const e = { ...data, id: 'envio', historicoTentativas: tentativas }; envios.push(e); return e; }), update: jest.fn(async ({ data }) => Object.assign(envios[0], data)) },
    envioGuiaTentativa: { create: jest.fn(async ({ data }) => { const t = { ...data, id: `t${tentativas.length}` }; tentativas.push(t); return t; }) },
    appSetting: { findUnique: jest.fn(async ({ where }) => auditoria.has(where.key) ? { value: auditoria.get(where.key) } : null), create: jest.fn(async ({ data }) => auditoria.set(data.key, data.value)) } };
  db.$transaction = fn => fn(db);
  const user = { id: 'contador', accountType: 'FIRM' }, s = criarEntregaExternaGuia({ db, agora: () => new Date('2026-10-22T01:00:00Z') });
  const body = { revisaoDocumento: revisaoEntrega(g), idempotencyKey: 'chave-teste', dataEntrega: '2026-10-21', meio: 'PESSOAL', confirmado: true };
  return { db, g, user, s, body, envios, tentativas, auditoria };
}
test('declaração fecha envio pela revisão sem pagamento ou recibo Meta; repetição não duplica', async () => {
  const t = setup();
  await t.s.previa('c', 'g', t.user); expect(t.envios).toHaveLength(0);
  const r = await t.s.registrar('c', 'g', t.user, { ...t.body, atorId: 'forjado' });
  expect(r.entregaExterna).toMatchObject({ atorId: 'contador', registradoEm: '2026-10-22T01:00:00.000Z', dataEntrega: '2026-10-21', reciboProvedor: false });
  expect((await t.s.registrar('c', 'g', t.user, t.body)).jaRegistrada).toBe(true);
  expect(t.tentativas).toHaveLength(1); expect(t.auditoria.size).toBe(1);
  const e = { ...t.envios[0], entregaExterna: entregaExternaVigente(t.envios[0], t.g) };
  expect(foiEnviadaComLegado([e], t.g)).toBe(true);
  expect(STATUS_TERMINAL).not.toContain(e.status);
  expect(t.g.paymentStatus).toBe('OPEN'); expect(e.providerMessageId).toBeUndefined(); expect(e.entregueEm).toBeUndefined();
  t.g.hash = 'recalculada'; expect(entregaExternaVigente(e, t.g)).toBeNull();
});
test.each(['data', 'meio', 'versao', 'permissao', 'empresa', 'andamento', 'confirmacao'])('recusa %s sem registrar entrega', async caso => {
  const t = setup();
  if (caso === 'data') t.body.dataEntrega = '2026-10-22';
  if (caso === 'meio') t.body.meio = 'META';
  if (caso === 'versao') t.body.revisaoDocumento = 'antiga';
  if (caso === 'permissao') t.user.accountType = 'CLIENT';
  if (caso === 'andamento') t.g.emailStatus = 'SENDING';
  if (caso === 'confirmacao') t.body.confirmado = false;
  await expect(t.s.registrar(caso === 'empresa' ? 'outra' : 'c', 'g', t.user, t.body)).rejects.toBeTruthy();
  expect(t.envios).toHaveLength(0);
});
test('reserva automática não envia revisão declarada, mas reenvio explícito permanece possível', async () => {
  const t = setup(); await t.s.registrar('c', 'g', t.user, t.body);
  const reservar = jest.fn();
  await expect(reservarSemEntregaExterna(t.db, [t.g], reservar)).rejects.toMatchObject({ code: 'GUIA_ENTREGA_EXTERNA' });
  expect(reservar).not.toHaveBeenCalled();
  await reservarSemEntregaExterna(t.db, [t.g], reservar, true); expect(reservar).toHaveBeenCalledTimes(1);
});

test.each(['semPdf','pendente','status'])('documento inválido %s não registra nem mantém vigência',async caso=>{
 const t=setup();await t.s.registrar('c','g',t.user,t.body);
 if(caso==='semPdf')t.g.pdfBytes=null;
 if(caso==='pendente')t.g.extracted={conferenciaDocumentoPendente:true};
 if(caso==='status')t.g.status='ERROR';
 expect(entregaExternaVigente(t.envios[0],t.g)).toBeNull();
 await expect(t.s.previa('c','g',t.user)).rejects.toMatchObject({code:'guia_indisponivel'});
 await expect(t.s.registrar('c','g',t.user,{...t.body,idempotencyKey:'nova-chave'})).rejects.toMatchObject({code:'guia_indisponivel'});
 expect(t.tentativas).toHaveLength(1);
});
