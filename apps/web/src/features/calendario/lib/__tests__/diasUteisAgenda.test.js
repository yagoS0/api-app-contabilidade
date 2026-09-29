import { blocosDiarios, agruparAtividades } from '../agendaWorkspace';

test('empresas com feriado municipal diferente não compartilham blocos incorretos',()=>{
  const base={tipo:'obrigacao',regraId:'r',cicloChave:'2026-10',dataInicio:'2026-10-05',dataFim:'2026-10-07',horaInicio:'09:00',titulo:'Conferência'};
  const comum=[{dataInicioOriginal:'2026-10-06',dataInicio:'2026-10-06',dataFim:'2026-10-06'}];
  const local=[{dataInicioOriginal:'2026-10-06',dataInicio:'2026-10-05',dataFim:'2026-10-05'}];
  const grupos=agruparAtividades([{...base,id:'a',diasAgendados:comum},{...base,id:'b',diasAgendados:local},{...base,id:'c',diasAgendados:comum}]);
  expect(grupos.map(g=>g.itens.map(i=>i.id))).toEqual([['a','c'],['b']]);
  expect(blocosDiarios(grupos,'2026-10-05','2026-10-07').map(b=>b.dataInicio)).toEqual(['2026-10-06','2026-10-05']);
});

test('dias antecipados usam blocos próprios com identidade original mesmo quando coincidem', () => {
  const item = { id: 'ob', horaInicio: '09:00', horaFim: '10:00', dataInicio: '2026-10-30', dataFim: '2026-10-30', diasAgendados: [
    { dataInicio: '2026-10-30', dataFim: '2026-10-30', dataInicioOriginal: '2026-10-31' },
    { dataInicio: '2026-10-30', dataFim: '2026-10-30', dataInicioOriginal: '2026-11-01' },
  ] };
  const blocos = blocosDiarios([item], '2026-10-26', '2026-11-01');
  expect(blocos.map(b => b.id)).toEqual(['ob@2026-10-31', 'ob@2026-11-01']);
  expect(blocos.every(b => b.dataInicio === '2026-10-30' && b.horaInicio === '09:00' && b.horaFim === '10:00' && b.atividadeOriginal === item)).toBe(true);
  expect(blocosDiarios([item], '2026-11-01', '2026-11-30')).toEqual([]);
});

test('janela sem ajuste mantém os blocos diários existentes', () => {
  const item = { id: 'ob', horaInicio: '09:00', dataInicio: '2026-10-30', dataFim: '2026-11-01' };
  expect(blocosDiarios([item], '2026-10-30', '2026-11-01').map(b => b.dataInicio)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
});
