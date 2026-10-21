import { versaoPagamentoGuia } from '../ConfirmacaoPagamentoClienteService.js';
import { revisaoDocumentoGuia } from '../../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { avisarPagamentoNaoConfirmado } from "../AvisoPagamentoService.js";
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z")));
afterEach(() => jest.useRealTimers());
function setup(patch = {}) {
  const records = new Map();
  const guide = { status: "PROCESSED", hash: "pdf-atual", valor: 100, id: "g", portalClientId: "c", competencia: "2026-09", tipo: "INSS", paymentStatus: "OPEN", liberadaCliente: true, vencimento: "2026-09-23", ...patch };
  // Recibo imutável da entrega anterior: a leitura nunca o reconstrói da guia atual.
  const entrega = { arquivoSha256: guide.hash, snapshot: { revisaoDocumento: revisaoDocumentoGuia(guide), guideId:guide.id,portalClientId:guide.portalClientId,telefone:'5511000000000',competencia:guide.competencia,tipo:guide.tipo,valor:guide.valor,vencimento:guide.vencimento} };
  const db = { envioGuiaTentativa: { findMany: jest.fn(async ({where}) => where.envioGuia.destino === entrega.snapshot.telefone ? [entrega] : []) }, feriado: { findMany: jest.fn(async () => []) }, guide: { findUnique: jest.fn(async () => ({ ...guide })) }, portalClient: { findUnique: jest.fn(async () => ({ razao: "Empresa sintética" })) },
    appSetting: { create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error("duplicado"), { code: "P2002" }); records.set(data.key, data); return data; }),
      findUnique: jest.fn(async ({ where }) => records.get(where.key)), update: jest.fn(async ({ where, data }) => { records.set(where.key, { key: where.key, ...data }); return data; }) } };
  const transporte = { canais: jest.fn(async () => ({ escolha: "EMAIL" })), destinatarios: jest.fn(async () => ({ emails: ["fixture@example.invalid"], telefones: [{ id: "contato", telefoneE164: "5511000000000" }] })),
    email: jest.fn(), whatsapp: jest.fn(async ({ conferir }) => { await conferir(); }) };
  const run = extra => avisarPagamentoNaoConfirmado({ guideId: "g", scheduledAt: "2026-09-24T11:00:00Z", ...extra }, { db, transporte, portalUrl: "https://portal.example.invalid/" });
  return { guide, db, transporte, records, run };
}
test("aviso neutro só aos destinatários cadastrados e uma vez sob concorrência/reinício", async () => {
  const f = setup();
  await Promise.all([f.run(), f.run()]);
  await f.run({ scheduledAt: "2026-10-24T11:00:00Z" });
  expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
  expect(f.transporte.whatsapp.mock.calls[0][0]).toMatchObject({ contato: expect.objectContaining({ id: "contato" }), texto: expect.stringContaining("Não é necessário pagar novamente") });
  expect(f.transporte.whatsapp.mock.calls[0][0].texto).toContain("toque em Confirmar pagamento");
});
test.each(["MANUAL", "CLIENTE"])("confirmação %s impede aviso antes de qualquer transporte", async origem => {
  const f = setup(); Object.assign(f.guide, { paymentStatus: "PAID", paymentStatusSource: origem });
  expect(await f.run()).toMatchObject({ status: "IGNORADO", motivo: "PAGAMENTO_JA_CONFIRMADO" });
  expect(f.transporte.whatsapp).not.toHaveBeenCalled();
});
test("confirmação do cliente ocorrida durante preparação cancela antes de enviar", async () => {
  const f = setup(); let enviadas = 0;
  f.transporte.whatsapp.mockImplementation(async ({ conferir }) => { f.guide.paymentStatus = "PAID"; await conferir(); enviadas++; });
  await f.run(); expect(enviadas).toBe(0);
  expect([...f.records.values()][0].value.status).toBe("CANCELADO");
});
test.each(["SEM_EMAIL", "JANELA_FECHADA"])("%s informa pendência sem falso envio", async caso => {
  const f = setup();
  if (caso === "PERGUNTAR") f.transporte.canais.mockResolvedValue({ escolha: null });
  if (caso === "SEM_EMAIL") f.transporte.destinatarios.mockResolvedValue({ emails: [], telefones: [] });
  if (caso === "JANELA_FECHADA") {
    f.transporte.canais.mockResolvedValue({ escolha: "WHATSAPP" });
    f.transporte.destinatarios.mockResolvedValue({ emails: [], telefones: [{ id: "contato", telefoneE164: "5511000000000" }] });
    f.transporte.whatsapp.mockRejectedValue(Object.assign(Error("janela"), { code: "WHATSAPP_JANELA_FECHADA" }));
  }
  expect(await f.run()).toMatchObject({ status: "PENDENTE" }); expect(f.transporte.email).not.toHaveBeenCalled();
  expect([...f.records.values()].some(v => v.value.status === "ENVIADO")).toBe(false);
});
test("timeout preserva indeterminação e não reenfileira envio", async () => {
  const f = setup(); f.transporte.whatsapp.mockImplementation(async ({ conferir }) => { await conferir(); throw Error("timeout"); });
  await f.run(); await f.run();
  expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
  expect([...f.records.values()][0].value.status).toBe("INDETERMINADO");
});
test("consulta manual e lease perdida não enviam", async () => {
  const f = setup(); await f.run({ scheduledAt: null }); await expect(f.run({ assertActive: () => { throw Error("lease"); } })).rejects.toThrow("lease");
  expect(f.transporte.whatsapp).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
});
test("falha de banco não é tratada como aviso ignorado", async () => {
  const f = setup(); f.db.guide.findUnique.mockRejectedValue(Error("banco indisponível"));
  await expect(f.run()).rejects.toThrow("banco indisponível"); expect(f.transporte.whatsapp).not.toHaveBeenCalled();
});
test("guia não liberada fica pendente; guia DAS oferece dois botões sem URL", async () => {
  const f = setup({ tipo: 'SIMPLES', source: 'SERPRO' }); f.guide.liberadaCliente = false;
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "GUIA_NAO_LIBERADA" });
  Object.assign(f.guide, { liberadaCliente: true, source: "SERPRO", tipo: "SIMPLES" }); await f.run();
  const { acoes } = f.transporte.whatsapp.mock.calls[0][0]; expect(acoes).toHaveLength(1);
  expect(acoes[0]).toMatchObject({ id: expect.stringMatching(/^altan\.payment\.recalculate\./), label: 'Atualizar guia' });
  expect(acoes[0].url).toBeUndefined();
});
test("vínculo posterior da mesma guia não duplica aviso", async () => {
  const f = setup(); await f.run();
  f.db.parcela = { findUnique: jest.fn(async () => ({ id: "parcela-nova", portalClientId: "c", anoMesParcela: "202609", guia: f.guide, parcelamento: { numeroParcelamento: "123" } })) };
  expect(await f.run({ parcelaId: "parcela-nova" })).toMatchObject({ status: "JA_ENVIADO" });
  expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
});

test('preferência EMAIL não envia e-mail e confirmação não contém link de portal',async()=>{const f=setup();await f.run();expect(f.transporte.email).not.toHaveBeenCalled();const envio=f.transporte.whatsapp.mock.calls[0][0];expect(envio.botaoId).toMatch(/^altan\.payment\.confirm\./);expect(envio.acoes.some(a=>a.acao==='confirmar')).toBe(false);});

test('um aviso em cada fase, sem duplicar na mesma fase e sem recálculo antecipado', async () => {
  const f = setup({ vencimento: '2026-09-25', source: 'SERPRO', tipo: 'SIMPLES' });
  await f.run(); await f.run();
  expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
  expect(f.transporte.whatsapp.mock.calls[0][0]).toMatchObject({ fase: 'ANTES', acoes: [] });
  jest.setSystemTime(new Date('2026-09-28T15:00:00Z'));
  await f.run(); await f.run();
  expect(f.transporte.whatsapp).toHaveBeenCalledTimes(2);
  expect(f.transporte.whatsapp.mock.calls[1][0]).toMatchObject({ fase: 'DEPOIS', acoes: [{ acao: 'recalcular' }] });
});

test('nenhum aviso no vencimento ou fora dos dois dias definidos', async () => {
  const f = setup(); f.guide.vencimento = '2026-09-24';
  expect(await f.run()).toMatchObject({ status: 'IGNORADO', motivo: 'FORA_DO_DIA_DO_AVISO' });
  f.guide.vencimento = '2026-08-01'; await f.run();
  expect(f.transporte.whatsapp).not.toHaveBeenCalled();
});


test('sem entrega fica pendente sem reservar; entrega posterior permite avaliar novamente', async () => {
  const f=setup(); const original=f.db.envioGuiaTentativa.findMany.getMockImplementation();
  f.db.envioGuiaTentativa.findMany.mockResolvedValue([]);
  expect(await f.run()).toMatchObject({status:'PENDENTE',resultados:[{motivo:'GUIA_WHATSAPP_NAO_ENTREGUE'}]});
  expect(f.transporte.whatsapp).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
  f.db.envioGuiaTentativa.findMany.mockImplementation(original);
  await f.run(); expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
});
test('entrega de um contato não habilita o lembrete do outro', async () => {
 const f=setup(); const original=f.db.envioGuiaTentativa.findMany.getMockImplementation();
 f.transporte.destinatarios.mockResolvedValue({telefones:[{id:'a',telefoneE164:'5511000000000'},{id:'b',telefoneE164:'5511000000001'}]});
 f.db.envioGuiaTentativa.findMany.mockImplementation(a=>a.where.envioGuia.destino.endsWith('1')?[]:original(a));
 expect(await f.run()).toMatchObject({status:'PENDENTE'}); expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
 expect(f.transporte.whatsapp.mock.calls[0][0].contato.id).toBe('a');
});
test('recibo deixa de valer durante preparação: não chega ao transporte', async () => {
 const f=setup(); let enviado=false;
 f.transporte.whatsapp.mockImplementation(async ({conferir})=>{f.db.envioGuiaTentativa.findMany.mockResolvedValue([]);await conferir();enviado=true;});
 await f.run();expect(enviado).toBe(false);
});
test.each([{status:'ERROR'},{status:'VAZIO'},{paymentConfirmedAt:new Date()}])('estado inelegível %j não envia',async patch=>{
 const f=setup();Object.assign(f.guide,patch);await f.run();expect(f.transporte.whatsapp).not.toHaveBeenCalled();
});

test('emissão persiste versão integral e recusa mudança na composição antes da rede',async()=>{const f=setup();await f.run();const token=f.records.get(f.transporte.whatsapp.mock.calls[0][0].botaoId).value;expect(token.versaoPagamento).toBe(versaoPagamentoGuia(f.guide));const outro=setup();let enviado=false;outro.transporte.whatsapp.mockImplementation(async({conferir})=>{outro.guide.extracted={fields:{principal:90,juros:5,multa:5,total:100}};await conferir();enviado=true;});const r=await outro.run();expect(enviado).toBe(false);expect(r.resultados[0].motivo).toBe('GUIA_ALTERADA');});

test.each([
  [{ pagamentoStatus: 'CONFIRMADO' }, {}, 'IGNORADO', 'PARCELA_PAGA'],
  [{ origemBaixa: 'CLIENTE' }, {}, 'IGNORADO', 'PARCELA_PAGA'],
  [{ baixadaEm: new Date() }, {}, 'IGNORADO', 'PARCELA_PAGA'],
  [{ pagamentoStatus: 'DIVERGENTE' }, {}, 'PENDENTE', 'CONSULTA_NAO_CONCLUIDA'],
  [{ pagamentoErro: 'falha' }, {}, 'PENDENTE', 'CONSULTA_NAO_CONCLUIDA'],
  [{}, { formaPagamento: 'DEBITO_AUTOMATICO' }, 'IGNORADO', 'PARCELA_DEBITO_AUTOMATICO'],
  [{}, { status: 'EXCLUIDO' }, 'IGNORADO', 'PARCELAMENTO_EXCLUIDO'],
])('guideId resolve parcela real %j %j antes de reservar lembrete', async (parcela, contrato, status, motivo) => {
  const f = setup(); Object.assign(f.guide, { parcelamentoId: 'acordo', parcela: { portalClientId: 'c', guiaId: 'g', ...parcela }, parcelamento: { id: 'acordo', ...contrato } });
  expect(await f.run()).toMatchObject({ status, motivo }); expect(f.transporte.whatsapp).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
  expect(f.db.guide.findUnique).toHaveBeenCalledWith({ where: { id: 'g' }, include: { parcela: { include: { parcelamento: true } }, parcelamento: true } });
});
test('parcela entra em débito automático durante preparação: cancela sem saída', async () => {
  const f = setup({ parcelamentoId: 'acordo', parcela: { portalClientId: 'c', guiaId: 'g' }, parcelamento: { id: 'acordo', formaPagamento: 'GUIA' } });
  let enviou = false;
  f.transporte.whatsapp.mockImplementation(async ({ conferir }) => { f.guide.parcelamento.formaPagamento = 'DEBITO_AUTOMATICO'; await conferir(); enviou = true; });
  const r = await f.run(); expect(enviou).toBe(false); expect(r.resultados[0]).toMatchObject({ status: 'CANCELADO', motivo: 'PARCELA_DEBITO_AUTOMATICO' });
});
test('vínculo de outra empresa fica pendente sem saída', async () => {
  const f = setup(); f.guide.parcela = { portalClientId: 'outra', guiaId: 'g' };
  expect(await f.run()).toMatchObject({ status: 'PENDENTE', motivo: 'DOCUMENTO_ESCOPO_DIVERGENTE' }); expect(f.transporte.whatsapp).not.toHaveBeenCalled();
});

test.each([
  [{ formaPagamento: 'DEBITO_AUTOMATICO' }, 'IGNORADO', 'PARCELA_DEBITO_AUTOMATICO'],
  [{ status: 'EXCLUIDO' }, 'IGNORADO', 'PARCELAMENTO_EXCLUIDO'],
])('contrato alcançado somente pela parcela conserva bloqueio %j', async (contrato, status, motivo) => {
  const f = setup();
  f.guide.parcela = { id: 'p', portalClientId: 'c', guiaId: 'g', parcelamentoId: 'acordo',
    parcelamento: { id: 'acordo', portalClientId: 'c', ...contrato } };
  expect(await f.run()).toMatchObject({ status, motivo });
  expect(f.transporte.whatsapp).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
});

test('contratos diferentes da mesma empresa não autorizam aviso', async () => {
  const f = setup(); Object.assign(f.guide, { parcelamentoId: 'a', parcelamento: { id: 'a', portalClientId: 'c' },
    parcela: { id: 'p', portalClientId: 'c', guiaId: 'g', parcelamentoId: 'b', parcelamento: { id: 'b', portalClientId: 'c' } } });
  expect(await f.run()).toMatchObject({ status: 'PENDENTE', motivo: 'DOCUMENTO_ESCOPO_DIVERGENTE' });
  expect(f.transporte.whatsapp).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
});

test('vínculo da parcela muda antes da saída: não envia e preserva motivo de conferência', async () => {
  const f = setup({ parcelamentoId: 'a', parcelamento: { id: 'a', portalClientId: 'c' },
    parcela: { id: 'p', portalClientId: 'c', guiaId: 'g', parcelamentoId: 'a', parcelamento: { id: 'a', portalClientId: 'c' } } });
  let enviou = false;
  f.transporte.whatsapp.mockImplementation(async ({ conferir }) => {
    f.guide.parcela.parcelamentoId = 'b'; f.guide.parcela.parcelamento = { id: 'b', portalClientId: 'c' };
    await conferir(); enviou = true;
  });
  const r = await f.run(); expect(enviou).toBe(false);
  expect(r.resultados[0]).toMatchObject({ status: 'PENDENTE', motivo: 'DOCUMENTO_ESCOPO_DIVERGENTE' });
});


test.each([false, true])('débito da indicação impede lembrete, inclusive se declarado antes da rede (%s)', async durante => {
 const f = setup({ parcelamentoId: 'avulsa', parcelamento: { id: 'avulsa', origem: 'GUIA_AVULSA', formaPagamento: 'GUIA_MENSAL', portalClientId: 'c' }, extracted: { indicacaoParcelamentoId: 'i' } });
 f.db.parcelamentoIndicacao = { findFirst: jest.fn(async () => ({ id: 'i', portalClientId: 'c' })) };
 const declarar = () => f.records.set('parcelamento_indicacao_forma:v1:i', { value: { periodos: [{ desde: '2026-09', formaPagamento: 'DEBITO_AUTOMATICO', usuarioId: 'u', em: '2026-09-01' }] } });
 let rede = 0;
 f.transporte.whatsapp.mockImplementation(async ({ conferir }) => { if (durante) declarar(); await conferir(); rede++; });
 if (!durante) declarar();
 const result = await f.run();
 expect(rede).toBe(0);
 if (!durante) { expect(result).toMatchObject({ status: 'IGNORADO', motivo: 'PARCELA_DEBITO_AUTOMATICO' }); expect(f.transporte.whatsapp).not.toHaveBeenCalled(); }
 else expect(result.resultados[0]).toMatchObject({ status: 'CANCELADO', motivo: 'PARCELA_DEBITO_AUTOMATICO' });
});
