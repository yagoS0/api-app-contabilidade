import { determinarPoliticaDeclaratoriaFs12 } from '../politicaDeclaratoriaFs12.js';
import { interpretarContextoMensalFs12 as interpretar } from '../contextoMensalFs12.js';
const data = s => new Date(`${s}T00:00:00.000Z`);
const regime = { id:'r1',companyId:'c1',regime:'SIMPLES',vigenciaInicio:data('2025-01-01'),vigenciaFim:null,updatedAt:data('2026-11-01') };
const company = extra => ({ id:'c1',dataAbertura:data('2020-01-01'),regimeHistorico:[regime],...extra });
test('interpretação é pura, preserva empresa e revisão sem modificar fatos', () => {
 const entrada=company();const antes=JSON.stringify(entrada);const saida=interpretar(entrada,'2026-11');
 expect(saida.regimeDoPeriodo).toMatchObject({empresaId:'c1',competencia:'2026-11',tipo:'SIMPLES_NACIONAL'});
 expect(saida.regimeDoPeriodo.referencia).toContain('r1:2026-11-01');expect(JSON.stringify(entrada)).toBe(antes);
});
test('E2 abertura comprovada no próprio PA cobre existência sem ampliar vigência',()=>{
 const r=interpretar(company({dataAbertura:data('2026-11-15'),regimeHistorico:[{...regime,vigenciaInicio:data('2026-11-15')}] }),'2026-11');
 expect(r.inicioAtividade).toBe('2026-11');expect(r.regimeDoPeriodo).toMatchObject({empresaId:'c1',competencia:'2026-11',tipo:'SIMPLES_NACIONAL'});
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

test.each(['2026-11-01','2026-11-15','2026-11-30'])('E2 abertura %s conserva datas civis, valor e identidade de origem', abertura => {
 const entrada=company({dataAbertura:data(abertura),regimeHistorico:[{...regime,vigenciaInicio:data(abertura),vigenciaFim:data('2026-11-30')}]});
 const antes=JSON.stringify(entrada); const resultado=interpretar(entrada,'2026-11');
 expect(resultado.regimeDoPeriodo).toMatchObject({tipo:'SIMPLES_NACIONAL',referencia:expect.stringContaining('RegimeHistorico:r1:')});
 expect(JSON.stringify(entrada)).toBe(antes);
 expect(resultado).not.toHaveProperty('folhasSalario');
});

test('E2 empresa já existente que muda regime no meio do mês continua pendente',()=>{
 expect(interpretar(company({regimeHistorico:[{...regime,vigenciaInicio:data('2026-11-15')}] }),'2026-11').regimeDoPeriodo).toBeNull();
});

test.each([
 ['vigência começa após abertura',{vigenciaInicio:data('2026-11-16')}],
 ['vigência termina antes do fim do PA',{vigenciaFim:data('2026-11-29')}],
 ['vigência anterior à existência',{vigenciaInicio:data('2026-11-01')}],
 ['outra empresa',{companyId:'outra'}],
 ['início não normalizado',{vigenciaInicio:new Date('2026-11-15T03:00:00Z')}],
 ['fim não normalizado',{vigenciaFim:new Date('2026-11-30T03:00:00Z')}],
 ['revisão ausente',{updatedAt:null}],
 ['identidade do histórico ausente',{id:null}],
])('E2 abertura não supera %s',(_nome,patch)=>{
 const entrada=company({dataAbertura:data('2026-11-15'),regimeHistorico:[{...regime,vigenciaInicio:data('2026-11-15'),...patch}]});
 expect(interpretar(entrada,'2026-11').regimeDoPeriodo).toBeNull();
});

test.each([null, data('2026-12-01'), new Date('2026-11-15T03:00:00Z'), new Date('invalid')])('E2 abertura ausente/futura/não civil não produz comprovação (%s)', abertura=>{
 expect(interpretar(company({dataAbertura:abertura}),'2026-11').regimeDoPeriodo).toBeNull();
});

test.each([
 [[{...regime,id:'r2',vigenciaInicio:data('2026-11-15')}]],
 [[{...regime,id:'r2',vigenciaInicio:data('2026-11-01'),vigenciaFim:data('2026-11-14')}]],
 [[{...regime,id:'r2',vigenciaInicio:data('2026-10-01'),vigenciaFim:data('2026-10-31')}]],
])('E2 sobreposição ou histórico contraditório antes da constituição não é descartado', extras=>{
 const entrada=company({dataAbertura:data('2026-11-15'),regimeHistorico:[{...regime,vigenciaInicio:data('2026-11-15')},...extras]});
 expect(interpretar(entrada,'2026-11').regimeDoPeriodo).toBeNull();
});
test('E2 contexto de abertura alimenta a janela B1 sem criar meses anteriores ou autorizar transporte',()=>{
 const entrada=company({dataAbertura:data('2026-11-15'),regimeHistorico:[{...regime,vigenciaInicio:data('2026-11-15')}]});
 for(const [pa,meses] of [['2026-11',['2026-11']],['2026-12',['2026-11']]]) {
  const politica=determinarPoliticaDeclaratoriaFs12(interpretar(entrada,pa));
  expect(politica.situacao).toBe('EXIGIDA'); expect(politica.janela.competencias).toEqual(meses);
  expect(politica).not.toHaveProperty('folhasSalario');
 }
 const futura=company({dataAbertura:data('2027-01-15'),regimeHistorico:[{...regime,vigenciaInicio:data('2027-01-15')}]});
 expect(determinarPoliticaDeclaratoriaFs12(interpretar(futura,'2027-01'))).toMatchObject({situacao:'PENDENTE',regra:'HOMOLOGACAO_2027_PENDENTE',janela:null});
});