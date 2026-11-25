import {regimeComprovado} from '../OperationsEligibility.js';
const date=s=>new Date(s+'T00:00:00Z'),pa='2026-11';
const company={id:'legacy',dataAbertura:date('2026-11-15'),regimeTributario:'SIMPLES'};
const row={id:'history',companyId:'legacy',regime:'SIMPLES',vigenciaInicio:date('2026-11-15'),updatedAt:date('2026-11-20')};
test('abertura15 comprovada usa período efetivo B1, sem alterar a data',()=>{
 expect(regimeComprovado([row],pa,{},company)).toBe('SIMPLES');expect(row.vigenciaInicio).toEqual(date('2026-11-15'));
});
test.each([
 [{...row,companyId:'other'},company],
 [row,{...company,dataAbertura:date('2020-01-01')}],
 [row,{...company,dataAbertura:null}],
 [row,{...company,dataAbertura:date('2026-11-16')}],
 [{...row,vigenciaInicio:date('2026-11-16')},company],
 [{...row,updatedAt:null},company],
 [{...row,vigenciaInicio:new Date('2026-11-15T03:00:00Z')},company],
])('não promove contexto insuficiente/contraditório %#',(history,entity)=>expect(regimeComprovado([history],pa,{},entity)).toBeNull());
test('sobreposição e2027 não usam exceção de abertura',()=>{
 expect(regimeComprovado([row,{...row,id:'overlap'}],pa,{},company)).toBeNull();
 expect(regimeComprovado([{...row,vigenciaInicio:date('2027-01-15')}],'2027-01',{}, {...company,dataAbertura:date('2027-01-15')})).toBeNull();
});
