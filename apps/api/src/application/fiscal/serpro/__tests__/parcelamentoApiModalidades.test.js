jest.mock("../../../../config.js",()=>({INTEGRACAO_SERPRO_PARCELAMENTO:true}));
jest.mock("../SerproHttpClient.js",()=>({SerproHttpClient:class{}}));
import { SerproParcelamentoService } from "../SerproParcelamentoService.js";
import { mapearParcelasGeraveis, mapearPedidosParcelamento } from "../serproParcelamentoMap.js";
const env=dados=>({status:200,dados:JSON.stringify(dados)});
test.each(["listaParcela","listaParcelas"])("leitura oficial %s e item parcela",key=>expect(mapearParcelasGeraveis(env({[key]:[{parcela:202609,valor:123.45}]}))).toEqual(["202609"]));
test("lista vazia válida difere de formato desconhecido",()=>{
  expect(mapearParcelasGeraveis(env({listaParcela:[]}))).toEqual([]);
  expect(()=>mapearParcelasGeraveis(env({invalido:[]}))).toThrow(/formato/);
  expect(()=>mapearParcelasGeraveis(env({listaParcela:[{parcela:202613}]}))).toThrow(/Referência/);
});
test.each([["PARCSN","PEDIDOSPARC163","PARCELASPARAGERAR162","DETPAGTOPARC165"],["PARCMEI","PEDIDOSPARC203","PARCELASPARAGERAR202","DETPAGTOPARC205"]])("contratos de consulta %s",async(tipo,pedidos,listagem,pagamento)=>{
  const client={post:jest.fn().mockResolvedValueOnce(env({parcelamentos:[]})).mockResolvedValueOnce(env({listaParcela:[]})).mockResolvedValueOnce(env({dataPagamento:20260924}))};
  const service=new SerproParcelamentoService({client});const args={contratanteCnpj:"00000000000000",contribuinteCnpj:"11111111111111",tipo};
  await service.listarPedidos(args);await service.listarParcelasGeraveis(args);await service.consultarPagamentoParcela({...args,numeroParcelamento:"7",anoMesParcela:"202609"});
  expect(client.post.mock.calls.map(c=>c[1].pedidoDados.idServico)).toEqual([pedidos,listagem,pagamento]);
  expect(client.post.mock.calls[0][1].pedidoDados.dados).toBe("");
  expect(client.post.mock.calls[1][1].pedidoDados.dados).toBe("");
  expect(JSON.parse(client.post.mock.calls[2][1].pedidoDados.dados)).toEqual({numeroParcelamento:7,anoMesParcela:202609});
});
test("pedido não reconhecido não vira ativo",()=>{
  expect(mapearPedidosParcelamento(env({parcelamentos:[{numero:1,situacao:"Aguardando análise"}]}),{tipo:"PARCSN"})[0].fiscalSituacao).toBe("A_CONFERIR");
});
