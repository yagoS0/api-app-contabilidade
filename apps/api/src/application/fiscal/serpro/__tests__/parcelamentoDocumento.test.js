jest.mock("../../../../infrastructure/db/prisma.js",()=>({prisma:{}}));
jest.mock("../SerproHttpClient.js",()=>({SerproHttpClient:class{}}));
jest.mock("../SerproRuntimeSettings.js",()=>({getResolvedSerproCredentials:jest.fn()}));
import { obterDocumentoParcela, conferirDocumentoParcela } from "../ParcelamentoDocumentoService.js";

function setup(pago=false){
  const guia={id:"g",portalClientId:"e",parcelamentoId:"c",anoMesParcela:"202609",valor:100,vencimento:null,pdfBytes:Buffer.from("%PDF-1.7\nconteudo"),paymentStatus:pago?"PAID":"OPEN",extracted:{conferenciaDocumentoPendente:true,comprovante:{total:90}}};
  const p={id:"p",portalClientId:"e",parcelamentoId:"c",anoMesParcela:"202609",guia,parcelamento:{portalClientId:"e",numeroParcelamento:"7"}};
  const client={parcela:{findFirst:jest.fn(async()=>p)},portalClient:{findUnique:jest.fn(async()=>({cnpj:"11111111111111"}))},guide:{findUnique:jest.fn(async()=>guia),updateMany:jest.fn(async({data})=>{Object.assign(guia,data);return{count:1};})}};
  const args={portalClientId:"e",parcelaId:"p",usuarioId:"u",client,lerPdf:async()=>guia.pdfBytes};
  return {guia,p,client,args};
}
async function dados(args){const {documento}=await obterDocumentoParcela(args);return {...documento,valor:110,vencimento:"2026-09-30",confirmado:true};}
test("conferência humana libera documento e guarda origem/hash sem criar baixa",async()=>{
  const t=setup();await conferirDocumentoParcela({...t.args,dados:await dados(t.args)});
  expect(t.guia.extracted.conferenciaDocumentoPendente).toBe(false);expect(t.guia.extracted.parcelamentoFiscal.conferenciaDocumental.usuarioId).toBe("u");expect(t.guia.extracted.comprovante.total).toBe(90);expect(t.guia.paymentStatus).toBe("OPEN");expect(t.guia.valor).toBe(110);
});
test("conferência documental não altera valor ou baixa de guia paga",async()=>{
  const t=setup(true);await conferirDocumentoParcela({...t.args,dados:await dados(t.args)});expect(t.guia.valor).toBe(100);expect(t.guia.paymentStatus).toBe("PAID");expect(t.guia.extracted.comprovante.total).toBe(90);
});
test.each([{hash:"outro"},{cnpj:"22222222222222"},{numeroParcelamento:"8"},{anoMesParcela:"202608"},{vencimento:"2026-02-31"},{confirmado:false}])("recusa identidade/arquivo/data sem conferência %j",async alteracao=>{
  const t=setup();await expect(conferirDocumentoParcela({...t.args,dados:{...await dados(t.args),...alteracao}})).rejects.toThrow();expect(t.client.guide.updateMany).not.toHaveBeenCalled();
});
test("isola empresa mesmo se identificador de parcela for de outra",async()=>{
  const t=setup();t.p.parcelamento.portalClientId="outra";await expect(obterDocumentoParcela(t.args)).rejects.toMatchObject({code:"DOCUMENTO_NAO_ENCONTRADO"});
});
