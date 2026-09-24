jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "00000000000000" } })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: class {} }));
jest.mock("../lerRelatorioSitfis.js", () => ({ montarRelatorioSitfis: ({ texto }) => ({ relatorio: JSON.parse(texto) }), lerLeituraPosicionalGravada: () => null }));
import { extrairIndicacoesParcelamento, reprocessarSitfisParcelamentos, reconciliarPedidosFiscais, resolverIndicacaoParcelamento, cadastrarAcompanhamentoFiscal, localizarParcelamentosFiscais } from "../ParcelamentoDescobertaService.js";

const relatorio = qtd => ({ diagnosticos: [{ chave: "RFB", blocos: [{ titulo: "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)", descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"], registros: [{ "Parcelas em atraso": String(qtd) }], anotacoes: [] }] }] });
describe("descoberta fiscal independente", () => {
  test.each([3,2])("indício com %i atrasadas não inventa número/modalidade/data de prestações", qtd => {
    const [i] = extrairIndicacoesParcelamento(relatorio(qtd));
    expect(i).toMatchObject({ parcelasEmAtraso: qtd, modalidade: null, numeroParcelamento: null });
    expect(i).not.toHaveProperty("vencimento");
  });
  test("quantidade mudada não cria outra identidade", () => expect(extrairIndicacoesParcelamento(relatorio(3))[0].chaveOrigem).toBe(extrairIndicacoesParcelamento(relatorio(2))[0].chaveOrigem));
  test("texto sem parcelamento não fabrica indicação", () => expect(extrairIndicacoesParcelamento({diagnosticos:[{blocos:[{titulo:"Débitos em aberto",registros:[{Valor:200}]}]}]})).toEqual([]));
  test("reprocessamento do mesmo relatório não reabre indicação descartada", async () => {
    const data = new Date("2026-09-24T12:00:00Z");
    const client = { companyFiscalStatus: {findUnique:jest.fn(async()=>({texto:JSON.stringify(relatorio(3)),ultimoRelatorioEm:data}))}, parcelamentoIndicacao: {findUnique:jest.fn(async()=>({id:"i",status:"DESCARTADO",evidenciaEm:data})),upsert:jest.fn()}, parcelamentoIndicacaoEvento:{create:jest.fn()} };
    client.$transaction = fn => fn(client);
    expect(await reprocessarSitfisParcelamentos({portalClientId:"empresa",client})).toMatchObject({identificadas:1});
    expect(client.parcelamentoIndicacao.upsert).not.toHaveBeenCalled();
  });
  test("pedido confirmado preserva estado local e não grava contabilidade", async () => {
    const client={parcelamento:{upsert:jest.fn(async({create})=>({id:"c",...create}))},parcelamentoIndicacao:{findMany:jest.fn(async()=>[])}};
    await reconciliarPedidosFiscais({portalClientId:"e",tipo:"PARCSN",pedidos:[{numeroParcelamento:"7",fiscalSituacao:"ATIVO",dataAdesao:null}],raw:{status:200},client});
    const input=client.parcelamento.upsert.mock.calls[0][0];
    expect(input.create).not.toHaveProperty("totalValue");
    expect(input.create).not.toHaveProperty("competenciaInicial");
    expect(input.update).not.toHaveProperty("status");
    expect(input.update).not.toHaveProperty("aberturaEntryId");
  });
  test("cadastro fiscal não preenche zero nem calendário fictício", async()=>{
    const client={parcelamento:{upsert:jest.fn(async x=>x.create)}};
    const c=await cadastrarAcompanhamentoFiscal({portalClientId:"e",tipo:"PARCMEI",numeroParcelamento:"4",client});
    expect(c.fiscalSituacao).toBe("NAO_CONFERIDO");
    expect(c).not.toHaveProperty("principalPerParcela");
    expect(c).not.toHaveProperty("numParcelas");
  });
  test("resolução exige motivo e impede vínculo entre empresas",async()=>{
    await expect(resolverIndicacaoParcelamento({portalClientId:"e",status:"DESCARTADO",motivo:""})).rejects.toMatchObject({code:"MOTIVO_OBRIGATORIO"});
    const client={parcelamentoIndicacao:{findFirst:jest.fn(async()=>({id:"i"}))},parcelamento:{findFirst:jest.fn(async()=>null)}};client.$transaction=fn=>fn(client);
    await expect(resolverIndicacaoParcelamento({portalClientId:"e",indicacaoId:"i",status:"VINCULADO",motivo:"Conferido",parcelamentoId:"outra",client})).rejects.toMatchObject({code:"CONTRATO_NAO_ENCONTRADO"});
    expect(client.parcelamento.findFirst).toHaveBeenCalledWith({where:{id:"outra",portalClientId:"e",status:{not:"EXCLUIDO"}}});
  });
});

test("localização concorrente e repetida não duplica consulta paga",async()=>{
  const settings=new Map();
  const client={portalClient:{findUnique:jest.fn(async()=>({cnpj:"11111111111111"}))},appSetting:{
    upsert:jest.fn(async({where,create})=>{if(!settings.has(where.key))settings.set(where.key,create);return JSON.parse(JSON.stringify(settings.get(where.key)));}),
    updateMany:jest.fn(async({where,data})=>{const row=settings.get(where.key);const v=where.value;if(!v?.path&&v?.equals&&JSON.stringify(v.equals)!==JSON.stringify(row.value))return{count:0};if(v?.path&&row.value[v.path[0]]!==v.equals)return{count:0};Object.assign(row,data);return{count:1};}),
  }};
  const serpro={listarPedidos:jest.fn(async()=>({pedidos:[],raw:{status:200}}))};
  const args={portalClientId:"e",modalidades:["PARCSN"],client,serpro};
  await Promise.all([localizarParcelamentosFiscais(args),localizarParcelamentosFiscais(args)]);
  const repetida=await localizarParcelamentosFiscais(args);
  expect(repetida.resultados[0]).toMatchObject({ok:true,cache:true,quantidade:0});
  expect(serpro.listarPedidos).toHaveBeenCalledTimes(1);
});
