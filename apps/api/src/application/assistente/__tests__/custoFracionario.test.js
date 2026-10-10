import { custoPorTokensCentavos, custoEstimadoCentavos } from '../precosIa.js';
import { concluirChamadaIa, consumoIaDoMes } from '../GuardaIaService.js';
test('teste de três chamadas custa USD 0.0040995, sem arredondar cada uma para um centavo', () => {
  const centavos=[[1208,66],[1217,139],[1223,98]].reduce((s,[input_tokens,output_tokens])=>s+custoPorTokensCentavos({input_tokens,output_tokens},'gpt-5.4-mini'),0);
  expect(centavos/100).toBeCloseTo(0.0040995,10);
  expect(custoEstimadoCentavos({input_tokens:1208,output_tokens:66},'gpt-5.4-mini')).toBe(1);
});
test('cache descontado tem preço próprio',()=>{
  expect(custoPorTokensCentavos({input_tokens:1000,output_tokens:100,cache_read_input_tokens:1000},'gpt-5.4-mini')).toBe(0.1275);
});
test('conclusão grava fração e libera apenas reserva com uso conhecido', async()=>{
  const update=jest.fn();await concluirChamadaIa({chamadaId:'teste',modelo:'gpt-5.4-mini'},{usage:{input_tokens:1208,output_tokens:66}},{client:{chamadaIa:{update}}});
  expect(update.mock.calls[0][0].data).toMatchObject({custoEstimadoCentavos:0.1203,reservaCentavos:0});
});
test('painel distingue custo por tokens e reserva pendente',async()=>{
  const client={chamadaIa:{aggregate:jest.fn(async()=>({_sum:{custoEstimadoCentavos:'0.40995',reservaCentavos:3},_count:{_all:4}}))}};
  const r=await consumoIaDoMes({client});
  expect(r.escritorio).toMatchObject({consumoCentavos:0.40995,reservaCentavos:3,centavos:3.40995});
});
