import { concluirChamadaIa } from "../GuardaIaService.js";
const contexto={chamadaId:"ch",portalClientId:"pc",modelo:"claude-sonnet-4-6",inicio:Date.now()};
function banco(){const row={reservaCentavos:100};return {row,chamadaIa:{update:jest.fn(async({data})=>Object.assign(row,data))}};}
it("timeout sem usage mantém a reserva e erro continua auditável",async()=>{
 const client=banco();await concluirChamadaIa(contexto,{erroCodigo:"IA_CONEXAO"},{client});
 expect(client.row).toMatchObject({status:"erro",reservaCentavos:100,custoEstimadoCentavos:0});
 expect(client.chamadaIa.update.mock.calls[0][0].data).not.toHaveProperty("reservaCentavos");
});
it("usage parcial de rodada anterior soma custo conhecido sem liberar reserva da rodada ambígua",async()=>{
 const client=banco();await concluirChamadaIa(contexto,{erroCodigo:"IA_CONEXAO",usage:{input_tokens:10000,output_tokens:2000}},{client});
 expect(client.row.reservaCentavos).toBe(100);expect(client.row.custoEstimadoCentavos).toBeGreaterThan(0);
});
it("sucesso sem contadores completos ainda preserva reserva",async()=>{
 const client=banco();await concluirChamadaIa(contexto,{usage:{input_tokens:100}},{client});expect(client.row.reservaCentavos).toBe(100);
});
it("sucesso ou reconciliação explícita com uso completo libera reserva",async()=>{
 for(const extra of [{},{erroCodigo:"IA_CONEXAO",usageCompleto:true}]){const client=banco();await concluirChamadaIa(contexto,{usage:{input_tokens:100,output_tokens:10},...extra},{client});expect(client.row.reservaCentavos).toBe(0);}
});
