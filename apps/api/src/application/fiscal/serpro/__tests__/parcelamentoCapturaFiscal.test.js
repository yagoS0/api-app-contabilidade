jest.mock("../../../../infrastructure/db/prisma.js",()=>({prisma:{}}));
jest.mock("../SerproRuntimeSettings.js",()=>({getResolvedSerproCredentials:jest.fn()}));
jest.mock("../SerproHttpClient.js",()=>({SerproHttpClient:class{}}));
jest.mock("../../../guides/GuideParserClient.js",()=>({GuideParserClient:{create:jest.fn()}}));
import { capturarParcelaFiscal, identidadeCapturaParcela } from "../CaptureSerproParcelaService.js";

function contexto({guia,prestacao,falharCriacao=false,debito=false}={}) {
  let reserva={id:"r",owner:null,pdfBytes:null};let guides=guia?[guia]:[];let parcelas=prestacao?[prestacao]:[];let falha=falharCriacao;
  const client={
    parcelamentoCaptura:{
      upsert:jest.fn(async()=>({...reserva})),
      updateMany:jest.fn(async({where,data})=>{if(where.OR&&reserva.owner)return{count:0};if(where.owner&&where.owner!==reserva.owner)return{count:0};Object.assign(reserva,data);return{count:1};}),
      update:jest.fn(async({data})=>Object.assign(reserva,data)),
    },
    guide:{findMany:jest.fn(async()=>guides),findUnique:jest.fn(async()=>guides[0]),create:jest.fn(async({data})=>{if(falha){falha=false;throw new Error("falha no banco antes do vínculo");}const g={id:"g",...data};guides.push(g);return g;}),update:jest.fn(async({data})=>Object.assign(guides[0],data))},
    parcela:{findMany:jest.fn(async()=>parcelas),create:jest.fn(async({data})=>{const p={id:"p",...data};parcelas.push(p);return p;}),update:jest.fn(async({data})=>Object.assign(parcelas[0],data))},
  };
  client.guide.updateMany=jest.fn(async({data})=>{Object.assign(guides[0],data);return{count:1};});
  client.$transaction=fn=>fn(client);
  const serpro={emitirDasParcela:jest.fn(async()=>({pdfBuffer:Buffer.from("%PDF-1.7\nfixture"),numeroDas:"123",raw:{status:200}})),consultarDetalheParcela:jest.fn()};
  const parser={parsePdf:jest.fn(async()=>({cnpj:"11111111111111",valor:100,vencimento:"2026-09-30T12:00:00Z",rawTextSample:"Número do Parcelamento: 7",fields:{numeroDocumento:"123"}}))};
  const params={client,serpro,parser,args:{},company:{id:"empresa",cnpj:"11111111111111"},parcelamento:{id:"contrato",tipo:"PARCSN",numeroParcelamento:"7",formaPagamento:debito?"DEBITO_AUTOMATICO":"GUIA_MENSAL"},disponivel:{anoMesParcela:"202609",valor:100}};
  return {client,serpro,parser,params,getReserva:()=>reserva};
}
test("emite em aberto sem consultar pagamento ou criar lançamento",async()=>{
  const t=contexto();const r=await capturarParcelaFiscal(t.params);
  expect(r.status).toBe("ok");expect(t.serpro.consultarDetalheParcela).not.toHaveBeenCalled();
  expect(t.client.guide.create.mock.calls[0][0].data).toMatchObject({parcelamentoId:"contrato",anoMesParcela:"202609",paymentStatus:"OPEN",valor:100});
  expect(t.client.parcela.create).toHaveBeenCalledTimes(1);
});
test("retoma PDF obtido antes de falha no vínculo sem nova emissão",async()=>{
  const t=contexto({falharCriacao:true});await expect(capturarParcelaFiscal(t.params)).rejects.toThrow(/falha/);
  expect(t.getReserva().pdfBytes.length).toBeGreaterThan(0);
  await capturarParcelaFiscal(t.params);expect(t.serpro.emitirDasParcela).toHaveBeenCalledTimes(1);
  expect(t.getReserva().estado).toBe("CONCLUIDA");
});
test("repetição reutiliza documento e prestação",async()=>{
  const t=contexto();await capturarParcelaFiscal(t.params);await capturarParcelaFiscal(t.params);
  expect(t.serpro.emitirDasParcela).toHaveBeenCalledTimes(1);expect(t.client.guide.create).toHaveBeenCalledTimes(1);expect(t.client.parcela.create).toHaveBeenCalledTimes(1);
});
test("débito automático cria referência consultável sem emitir cobrança",async()=>{
  const t=contexto({debito:true});expect(await capturarParcelaFiscal(t.params)).toMatchObject({status:"acompanhar_pagamento"});
  expect(t.serpro.emitirDasParcela).not.toHaveBeenCalled();expect(t.client.guide.create).not.toHaveBeenCalled();expect(t.client.parcela.create.mock.calls[0][0].data).toMatchObject({anoMesParcela:"202609"});
});
test("pagamento já confirmado impede nova emissão",async()=>{
  const t=contexto({prestacao:{id:"p",pagamentoStatus:"CONFIRMADO"}});expect(await capturarParcelaFiscal(t.params)).toMatchObject({status:"paga"});expect(t.serpro.emitirDasParcela).not.toHaveBeenCalled();
});
test("guia existente sem PDF é completada sem tocar pagamento",async()=>{
  const t=contexto({guia:{id:"g",valor:100,paymentStatus:"OPEN",extracted:{comprovante:{id:"doc"}}},prestacao:{id:"p",guiaId:"g"}});
  await capturarParcelaFiscal(t.params);expect(t.client.guide.create).not.toHaveBeenCalled();
  const data=t.client.guide.updateMany.mock.calls[0][0].data;expect(data.pdfBytes.length).toBeGreaterThan(0);expect(data).not.toHaveProperty("paymentStatus");expect(data.extracted.comprovante).toEqual({id:"doc"});
});
test("concorrência ocupa uma reserva e emite uma vez",async()=>{
  const t=contexto();let liberar;const espera=new Promise(r=>{liberar=r;});t.serpro.emitirDasParcela.mockImplementation(async()=>{await espera;return{pdfBuffer:Buffer.from("%PDF-1.7"),raw:{status:200}};});
  const primeira=capturarParcelaFiscal(t.params);for(let i=0;i<10;i++)await Promise.resolve();
  const segunda=await capturarParcelaFiscal(t.params);expect(segunda.status).toBe("em_processamento");liberar();await primeira;expect(t.serpro.emitirDasParcela).toHaveBeenCalledTimes(1);
});
test("PDF de outra empresa não entra em Guias",async()=>{
  const t=contexto();t.parser.parsePdf.mockResolvedValue({cnpj:"22222222222222"});await expect(capturarParcelaFiscal(t.params)).rejects.toMatchObject({code:"PDF_EMPRESA_DIVERGENTE"});expect(t.client.guide.create).not.toHaveBeenCalled();
});
test("leitura parcial preserva PDF com conferência pendente",async()=>{
  const t=contexto();t.parser.parsePdf.mockResolvedValue({cnpj:"11111111111111",valor:100});
  expect(await capturarParcelaFiscal(t.params)).toMatchObject({status:"conferir_documento"});
  expect(t.client.guide.create.mock.calls[0][0].data.extracted.conferenciaDocumentoPendente).toBe(true);
});
test("identidade inclui empresa e modalidade",()=>{
  expect(new Set([identidadeCapturaParcela("a","PARCSN","7","202609"),identidadeCapturaParcela("b","PARCSN","7","202609"),identidadeCapturaParcela("a","PARCMEI","7","202609")]).size).toBe(3);
});
