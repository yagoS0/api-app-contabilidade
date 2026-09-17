import { criarMockAgenda } from '../agendaMock';

function montar() {
  const series=['a','b'].map(id=>({obrigacaoId:'s-'+id,tipo:'OBRIGACAO',nome:'EFD',agendaConfig:{horaInicio:'09:00',horaFim:'10:00',prioridade:'BAIXA'},ocorrencias:[{ocorrenciaId:id,dataInicio:'2026-09-10',dataFim:'2026-09-10',dataVencimento:'2026-09-21',status:id==='a'?'CONCLUIDA':'PENDENTE',agendaConfig:{titulo:'EFD '+id,descricao:'Empresa '+id,prioridade:'ALTA'}}]}));
  return {series,api:criarMockAgenda(series,[])};
}

test('arraste parcial preserva detalhes e conclusão de cada empresa no mock',async()=>{
  const {series,api}=montar();
  await api.editarOcorrenciasAgenda(['a','b'],{dataInicio:'2026-09-11',dataFim:'2026-09-11',horaInicio:'11:00',horaFim:'12:00'});
  for(const serie of series) {
    const oc=serie.ocorrencias[0];
    expect(oc).toMatchObject({dataInicio:'2026-09-11',dataVencimento:'2026-09-21',status:oc.ocorrenciaId==='a'?'CONCLUIDA':'PENDENTE',agendaConfig:{titulo:'EFD '+oc.ocorrenciaId,descricao:'Empresa '+oc.ocorrenciaId,prioridade:'ALTA',horaInicio:'11:00',horaFim:'12:00'}});
  }
});

test('null limpa horas e descrição, enquanto omissão preserva os valores',async()=>{
  const {series,api}=montar();
  await api.editarOcorrenciasAgenda(['a'],{horaInicio:null,horaFim:null,descricao:null});
  expect(series[0].ocorrencias[0].agendaConfig).toEqual({titulo:'EFD a',descricao:'',prioridade:'ALTA',horaInicio:null,horaFim:null});
});

test('grupo inválido não modifica sequer a primeira ocorrência',async()=>{
  const {series,api}=montar();series[1].ocorrencias[0].dataInicio='2026-09-15';series[1].ocorrencias[0].dataFim='2026-09-15';
  await expect(api.editarOcorrenciasAgenda(['a','b'],{dataFim:'2026-09-12'})).rejects.toThrow();
  expect(series[0].ocorrencias[0].dataFim).toBe('2026-09-10');
});

test('edição completa permanece compatível e rejeita título vazio',async()=>{
  const {series,api}=montar();
  await api.editarOcorrenciasAgenda(['a'],{titulo:'Revisão',descricao:'Alterada',dataInicio:'2026-09-12',dataFim:'2026-09-12',horaInicio:'14:00',horaFim:'15:00',prioridade:''});
  expect(series[0].ocorrencias[0].agendaConfig).toEqual({titulo:'Revisão',descricao:'Alterada',horaInicio:'14:00',horaFim:'15:00',prioridade:''});
  await expect(api.editarOcorrenciasAgenda(['a'],{titulo:''})).rejects.toThrow('título');
});

test('obrigação legada sem janela recebe horários na data do vencimento',async()=>{
  const {series,api}=montar();const oc=series[0].ocorrencias[0];oc.dataInicio=null;oc.dataFim=null;oc.agendaConfig=null;
  await api.editarOcorrenciasAgenda(['a'],{horaInicio:'11:00',horaFim:'12:00'});
  expect(oc).toMatchObject({dataInicio:'2026-09-21',dataFim:'2026-09-21',dataVencimento:'2026-09-21',agendaConfig:{titulo:'EFD',horaInicio:'11:00',horaFim:'12:00'}});
});
