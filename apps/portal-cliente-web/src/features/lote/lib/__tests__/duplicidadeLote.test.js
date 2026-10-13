
import { observacaoDaLinha, conviteParaRetentar, podeRetentar } from "../emissaoDoLote";
const linha = {numeroLinha:2,desfecho:"recusada_receita"};
it.each([{codigo:"E0014"},{mensagem:JSON.stringify({erros:[{Codigo:"E0014",Descricao:"DPS ocupada"}]})},{numeroReutilizavel:false},{codigo:"NFSE_RETRY_NAO_PERMITIDO"}])("bloqueia conferência e orienta sem prometer emissão: %j", detalhe => {
 const l={...linha,...detalhe}; expect(podeRetentar(l)).toBe(false);
 expect(conviteParaRetentar({linhas:[l]})).toBeNull();
 expect(observacaoDaLinha(l)).toMatch(/outra operação/);
 expect(observacaoDaLinha(l)).toMatch(/Não reenvie/);
});
it("extrai descrição segura do JSON legado e mantém recusa corrigível",()=>{
 const l={...linha,mensagem:JSON.stringify({erros:[{Codigo:"E0718",Descricao:"Assinatura inválida"}]})};
 expect(observacaoDaLinha(l)).toBe("Assinatura inválida"); expect(podeRetentar(l)).toBe(true);
 expect(observacaoDaLinha({...linha,mensagem:'{"segredo":"interno"}'})).not.toMatch(/segredo|interno/);
});
