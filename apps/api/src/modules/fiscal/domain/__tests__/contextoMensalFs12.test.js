import { interpretarContextoMensalFs12 as interpretar } from '../contextoMensalFs12.js';
const data = s => new Date(`${s}T00:00:00.000Z`);
const regime = { id:'r1',companyId:'c1',regime:'SIMPLES',vigenciaInicio:data('2025-01-01'),vigenciaFim:null,updatedAt:data('2026-11-01') };
const company = extra => ({ id:'c1',dataAbertura:data('2020-01-01'),regimeHistorico:[regime],...extra });
test('interpretação é pura, preserva empresa e revisão sem modificar fatos', () => {
 const entrada=company();const antes=JSON.stringify(entrada);const saida=interpretar(entrada,'2026-11');
 expect(saida.regimeDoPeriodo).toMatchObject({empresaId:'c1',competencia:'2026-11',tipo:'SIMPLES_NACIONAL'});
 expect(saida.regimeDoPeriodo.referencia).toContain('r1:2026-11-01');expect(JSON.stringify(entrada)).toBe(antes);
});
test('abertura no meio do mês permanece pendente sem ampliar vigência',()=>{
 const r=interpretar(company({dataAbertura:data('2026-11-15'),regimeHistorico:[{...regime,vigenciaInicio:data('2026-11-15')}] }),'2026-11');
 expect(r.inicioAtividade).toBe('2026-11');expect(r.regimeDoPeriodo).toBeNull();
});
test('mesmo regime dividido não é conciliado automaticamente',()=>{
 const r=interpretar(company({regimeHistorico:[{...regime,vigenciaFim:data('2026-11-15')},{...regime,id:'r2',vigenciaInicio:data('2026-11-16')}] }),'2026-11');
 expect(r.regimeDoPeriodo).toBeNull();
});
test('histórico inválido fora do PA pede conferência, sem descarte silencioso',()=>{
 expect(interpretar(company({regimeHistorico:[regime,{...regime,id:'r2',vigenciaInicio:data('2020-01-01'),vigenciaFim:data('2019-01-01')}] }),'2026-11').regimeDoPeriodo).toBeNull();
});
test('revisão alterada modifica referência; não valida fonte mensal',()=>{
 const a=interpretar(company(),'2026-11'), b=interpretar(company({regimeHistorico:[{...regime,updatedAt:data('2026-11-02')}] }),'2026-11');
 expect(a.regimeDoPeriodo.referencia).not.toBe(b.regimeDoPeriodo.referencia);expect(b).not.toHaveProperty('evidencias');
});
