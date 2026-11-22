
import { OPERACAO_VAZIA, conferirDadosDaOperacao } from "../dadosDaOperacao";
const conferir=(f)=>conferirDadosDaOperacao({...OPERACAO_VAZIA,...f},100);
test("ausência não cria grupos fiscais",()=>expect(conferir({})).toMatchObject({ok:true,payload:{},totalRetido:0}));
test.each(["-1","0","1,001","1.000,00","1e1","100"])("recusa retenção %s",valor=>expect(conferir({vRetIRRF:valor}).ok).toBe(false));
test("soma de retenções não pode alcançar o serviço",()=>expect(conferir({vRetIRRF:"60",vRetCP:"40"}).ok).toBe(false));
test("CIB exclusivo e inscrição opcional",()=>expect(conferir({obraTipo:"cCIB",obraCodigo:"12345678",obraInscricao:"42"})).toMatchObject({ok:true,payload:{obra:{cCIB:"12345678",inscImobFisc:"42"}}}));
test.each([{obraTipo:"cCIB",obraCodigo:"123"},{obraInscricao:"42"},{destinatarioNome:"Nome"},{destinatarioNome:"Nome",destinatarioDoc:"11111111111"}])("recusa grupo parcial ou inválido %j",f=>expect(conferir(f).ok).toBe(false));
test("CPF válido do destinatário",()=>expect(conferir({destinatarioNome:"Pessoa",destinatarioDoc:"529.982.247-25"})).toMatchObject({ok:true,payload:{destinatario:{cnpjCpf:"52998224725",nome:"Pessoa"}}}));

test("endereço da obra é próprio, normalizado e exclusivo no payload", () => {
  const r = conferir({ obraTipo: "end", obraCEP: "01551-020", obraxLgr: " Rua obra ", obranro: "0", obraxCpl: "", obraxBairro: "Centro", obraCodigo: "inativo", obraInscricao: "IM-123", cep: "99999999" });
  expect(r.ok).toBe(true);
  expect(r.payload.obra).toEqual({ inscImobFisc: "IM-123", end: { CEP: "01551020", xLgr: "Rua obra", nro: "0", xBairro: "Centro" } });
});
test("selecionar endereço incompleto não permite enviar grupo vazio", () => {
  expect(conferir({ obraTipo: "end" }).ok).toBe(false);
  expect(conferir({ obraTipo: "cObra", obraCEP: "01551020" }).payload).not.toHaveProperty("obra");
});
