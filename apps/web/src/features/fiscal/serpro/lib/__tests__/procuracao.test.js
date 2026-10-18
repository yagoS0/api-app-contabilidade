import {marcadorProcuracao} from '../procuracao';
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

test('vínculo não informado não comprova autorização; erro não equivale a ausência', () => {
 expect(marcadorProcuracao({...ativa, vinculoConfirmado:undefined}, agora).chave).toBe('revalidar');
 expect(marcadorProcuracao({procurationStatus:'ERRO'}, agora).rotulo).toBe('Erro na verificação');
 expect(marcadorProcuracao(null, agora).chave).toBe('nao_verificada');
 expect(marcadorProcuracao({...ativa, checkedAt:'inválida'}, agora).chave).toBe('revalidar');
});