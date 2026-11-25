import {selecionarSerieDeclaratoriaFs12} from '../selecionarSerieDeclaratoriaFs12.js';
describe('confirmed declaratory series selector',()=>{
  const input={competencia:'2026-11',revisaoEsperada:2,contextoHash:'a'.repeat(64),prova:{competencia:'2026-11',revisaoFs12:2,contextoHash:'a'.repeat(64),serie:[{mes:'2026-11',valorCentavos:0}]}};
  test('explicit zero in opening PA is preserved',()=>expect(selecionarSerieDeclaratoriaFs12(input)).toEqual([{pa:'2026-11',valor:0}]));
  test.each([null,undefined,[],[{mes:'2026-11',valorCentavos:null}],[{mes:'2026-11',valorCentavos:-1}]])('absence or invalid value cannot be zero: %p',serie=>expect(()=>selecionarSerieDeclaratoriaFs12({...input,prova:{...input.prova,serie}})).toThrow());
  test('stale revision cannot replace the confirmed series',()=>expect(()=>selecionarSerieDeclaratoriaFs12({...input,revisaoEsperada:1})).toThrow());
  test('2027 is not silently enabled',()=>expect(()=>selecionarSerieDeclaratoriaFs12({...input,competencia:'2027-01'})).toThrow());
});
