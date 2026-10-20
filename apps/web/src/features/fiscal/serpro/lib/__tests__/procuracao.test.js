import {marcadorProcuracao, dataProcuracao} from '../procuracao';
const agora=Date.parse('2026-10-14T18:00:00Z');
const ativa={procurationStatus:'ATIVA',checkedAt:'2026-10-14T17:00:00Z',validUntil:'2027-01-01',vinculoConfirmado:true};
test('validade, vínculo e idade da verificação',()=>{
 expect(marcadorProcuracao(ativa,agora).chave).toBe('ativa');
 expect(marcadorProcuracao({...ativa,validUntil:'2025-01-01'},agora).rotulo).toBe('Vencida');
 expect(marcadorProcuracao({...ativa,vinculoConfirmado:false},agora).chave).toBe('revalidar');
 expect(marcadorProcuracao({...ativa,checkedAt:'2026-10-12'},agora).chave).toBe('revalidar');
 expect(marcadorProcuracao({...ativa,validUntil:null},agora).chave).toBe('revalidar');
 expect(marcadorProcuracao({},agora).chave).toBe('nao_verificada');
 expect(marcadorProcuracao({...ativa,procurationStatus:'AUSENTE',validUntil:null},agora).chave).toBe('regularizar');
});

test('24h mantém estado histórico sem liberar filtro de ativas', () => {
 const checkedAt = new Date(agora - 86400000).toISOString();
 expect(marcadorProcuracao({...ativa, checkedAt}, agora)).toMatchObject({chave:'revalidar', rotulo:'Ativa na última verificação', orientacao:'Atualize a verificação antes de operar.'});
 expect(marcadorProcuracao({...ativa, checkedAt:new Date(agora - 86400000 + 1).toISOString()}, agora).chave).toBe('ativa');
});

test.each([
 { checkedAt:'inválida' }, { checkedAt:'2026-02-30' }, { checkedAt:'2099-01-01' },
 { validUntil:'inválida' }, { validUntil:'2027-02-30' }, { vinculoConfirmado:false },
 { procurationStatus:'AUSENTE' }, { procurationStatus:'ERRO' },
 { ultimaTentativa:{status:'ERRO',vinculoConfirmado:true} },
 { ultimaTentativa:{status:'CONSULTANDO',vinculoConfirmado:true} },
])('não apresenta ativa histórica com informação inconclusiva %j', patch => {
 const resultado = marcadorProcuracao({...ativa, checkedAt:'2026-10-12', ...patch}, agora);
 expect(resultado.rotulo).not.toBe('Ativa na última verificação');
 expect(resultado.chave).not.toBe('ativa');
});

describe.each(['2026-10-14T17:00:00Z', '2026-10-12T17:00:00Z'])('tentativa isolada da evidência de %s', checkedAt => {
 test.each(['ERRO', 'CONSULTANDO'].flatMap(status => [true, false, undefined].map(vinculoConfirmado => ({ status, vinculoConfirmado }))))('respeita o vínculo da tentativa %j', ultimaTentativa => {
  const evidencia = { ...ativa, checkedAt };
  const resultado = marcadorProcuracao({ ...evidencia, ultimaTentativa }, agora);
  if (ultimaTentativa.vinculoConfirmado === true) {
   expect(resultado.chave).toBe('revalidar');
   expect(resultado.rotulo).toBe(ultimaTentativa.status === 'ERRO' ? 'Erro na verificação' : 'Verificação pendente');
  } else {
   expect(resultado).toEqual(marcadorProcuracao(evidencia, agora));
  }
 });
});

test('datas inválidas não ganham data formatada', () => {
 expect(dataProcuracao('2026-02-30')).toBe('—');
 expect(dataProcuracao('inválida')).toBe('—');
 expect(dataProcuracao('2031-10-13')).toBe('13/10/2031');
});

test('vínculo não informado não comprova autorização; erro não equivale a ausência', () => {
 expect(marcadorProcuracao({...ativa, vinculoConfirmado:undefined}, agora).chave).toBe('revalidar');
 expect(marcadorProcuracao({procurationStatus:'ERRO'}, agora).rotulo).toBe('Erro na verificação');
 expect(marcadorProcuracao(null, agora).chave).toBe('nao_verificada');
 expect(marcadorProcuracao({...ativa, checkedAt:'inválida'}, agora).chave).toBe('revalidar');
});
