import { salvarCenario,listarCenarios,prepararCenario } from '../LaboratorioService.js';
const p={receita:10000,fixos:2000,variaveis:1000,prolabore:1000,clientes:20,aliquota:10};
const body={nome:'Teste',periodo:'2026-08',a:p,b:{...p,fixos:5000}};
const user={id:'contador-1',role:'user'};
test('resultado é recalculado e autoria não pode vir do navegador',async()=>{
 const create=jest.fn(async q=>q.data),client={laboratorioCenario:{create}};
 const r=await salvarCenario({client,user,body:{...body,autorId:'outro',resultadoJson:{resultado:999}}});
 expect(r.autorId).toBe(user.id);expect(r.companyId).toBeNull();expect(r.resultadoJson.b.resultado).toBe(2000);expect(create).toHaveBeenCalledTimes(1);
});
test('empresa sem vínculo ativo não pode ser usada para salvar',async()=>{
 const create=jest.fn(),client={laboratorioCenario:{create},companyFirmAccess:{findUnique:jest.fn(async()=>({status:'REVOKED',role:'ACCOUNTANT'}))}};
 await expect(salvarCenario({client,user,body:{...body,companyId:'outra'}})).rejects.toMatchObject({status:403});expect(create).not.toHaveBeenCalled();
});
test('revogação de acesso também remove fotos da listagem; propriedade escopada',async()=>{
 const findMany=jest.fn(async()=>[{id:'1',companyId:null},{id:'2',companyId:'bloqueada'},{id:'3',companyId:'permitida'}]);
 const client={laboratorioCenario:{findMany},companyFirmAccess:{findMany:jest.fn(async()=>[{companyId:'permitida'}])}};
 expect((await listarCenarios({client,user})).map(c=>c.id)).toEqual(['1','3']);expect(findMany.mock.calls[0][0].where).toEqual({autorId:user.id});
});
test('nome, período e premissas obrigatórios',()=>{
 expect(()=>prepararCenario({...body,periodo:'2026-13'})).toThrow();expect(()=>prepararCenario({...body,nome:' '})).toThrow();expect(()=>prepararCenario({...body,b:{...p,aliquota:''}})).toThrow();
});
