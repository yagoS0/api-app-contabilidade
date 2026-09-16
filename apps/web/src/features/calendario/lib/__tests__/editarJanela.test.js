import { editarJanela, janelaDoGesto } from '../editarJanela';

const item = {dataInicio:'2026-09-16',dataFim:'2026-09-16',horaInicio:'09:00',horaFim:'10:00'};
test('mover janela de vários dias mantém duração ao atravessar o mês', () => {
  expect(editarJanela({...item,dataFim:'2026-09-18'},'dataInicio','2026-08-31')).toMatchObject({dataInicio:'2026-08-31',dataFim:'2026-09-02'});
});
test('mudar o fim é uma expansão explícita, sem mover o início', () => {
  expect(editarJanela(item,'dataFim','2026-09-18')).toMatchObject({dataInicio:'2026-09-16',dataFim:'2026-09-18'});
});
test('borda superior altera só o início e respeita duração mínima', () => {
  expect(janelaDoGesto(item,'inicio','2026-09-17',30)).toEqual({...item,horaInicio:'09:30'});
  expect(janelaDoGesto(item,'inicio',item.dataInicio,180).horaInicio).toBe('09:45');
});
test('mover e esticar respeitam as bordas do dia', () => {
  expect(janelaDoGesto(item,'mover',item.dataInicio,-900)).toMatchObject({horaInicio:'00:00',horaFim:'01:00'});
  expect(janelaDoGesto(item,'mover',item.dataInicio,1200)).toMatchObject({horaInicio:'22:59',horaFim:'23:59'});
  expect(janelaDoGesto(item,'fim',item.dataInicio,1200).horaFim).toBe('23:59');
});
test('horário fixo continua sem fim ao mover e aceita duração ao esticar', () => {
  expect(janelaDoGesto({...item,horaFim:null},'mover',item.dataInicio,30)).toMatchObject({horaInicio:'09:30',horaFim:null});
  expect(janelaDoGesto({...item,horaFim:null},'fim',item.dataInicio,30)).toMatchObject({horaInicio:'09:00',horaFim:'10:00'});
});
test('horário fixo no último minuto não gera hora inválida', () => {
  expect(janelaDoGesto({...item,horaInicio:'23:59',horaFim:null},'fim',item.dataInicio,30)).toMatchObject({horaInicio:'23:59',horaFim:null});
});
