import { calcularCenario, calcularMeta, calcularGestao, estatisticaMensal } from '../../../../../../packages/shared/src/analise/gestao.js';
import { montarClientes } from '../../../../../../packages/shared/src/analise/clientes.js';
const p={receita:10000,fixos:2000,variaveis:1000,prolabore:1000,clientes:20,aliquota:10};
test('contribuição, resultado e equilíbrio sem duplicar pró-labore ou tributo',()=>{
  expect(calcularCenario(p)).toMatchObject({tributos:1000,contribuicao:8000,resultado:5000,equilibrio:3750,ticket:500,margem:50});
  expect(calcularMeta(p,5000)).toEqual({receita:10000,clientes:20});
});
test('custo de contratação reduz resultado mas não reduz receita ou imposto',()=>{
 const a=calcularCenario(p),b=calcularCenario({...p,fixos:5000});expect(a.resultado-b.resultado).toBe(3000);expect(b.tributos).toBe(a.tributos);
});
test('base contábil com tributos embutidos e outras receitas não duplica imposto',()=>{
 const r=calcularCenario({...p,aliquota:0,tributosNosCustos:true,outrasReceitas:500});
 expect(r).toMatchObject({tributos:null,tributosNosCustos:true,resultado:6500});
 expect(()=>calcularCenario({...p,tributosNosCustos:true})).toThrow();
});
test('ausência e taxa não informada não viram zero nem 6%',()=>{
 for(const v of ['',null,undefined,'abc',Infinity,-1,101]) expect(()=>calcularCenario({...p,aliquota:v})).toThrow();
 expect(()=>calcularCenario({...p,clientes:1.5})).toThrow();expect(()=>calcularCenario({...p,fixos:true})).toThrow();
 expect(calcularCenario({...p,aliquota:0}).tributos).toBe(0);
});
test('sem contribuição positiva não inventa equilíbrio ou meta',()=>{
 expect(calcularCenario({...p,variaveis:9000}).equilibrio).toBeNull();
 expect(calcularMeta({...p,variaveis:9000},1000)).toBeNull();
});
test('meses ausentes não entram como zero na média',()=>{
 expect(estatisticaMensal([{valor:null},{valor:0},{valor:100}])).toMatchObject({quantidade:2,ausentes:1,media:50,minimo:0,maximo:100,desvio:50});
});
test('classificação completa é pré-requisito; bruto não é contribuição',()=>{
 const dre={linhas:[{chave:'receitaBruta',valor:10000},{chave:'pessoal',contas:[{codigo:'41101001',valor:-2000}]},{chave:'custos',contas:[{codigo:'42001',valor:-1000}]}]};
 expect(calcularGestao(dre).contribuicao).toBeNull();
 const r=calcularGestao(dre,{'41101001':{comportamento:'FIXO',prolabore:true},'42001':{comportamento:'VARIAVEL',prolabore:false}});
 expect(r).toMatchObject({contribuicao:9000,fixos:2000,variaveis:1000,prolabore:2000,prolaborePercentual:20});
});
test('recorrência recente não é sequência antiga; top 1/3 e política explícitos',()=>{
 const notas=['01','02','03','05','07','08'].map((m,i)=>({id:String(i),competencia:`2026-${m}`,total:100,tomadorDoc:'12345678901'}));
 const r=montarClientes({notas,de:'2026-08',ate:'2026-08',hoje:'2026-09-16'});
 expect(r.resumo).toMatchObject({top1:100,top3:100,taxaRecorrencia:100,receitaRecorrentes:100});
 expect(r.politicaRecorrencia.versao).toBe('3-de-4-v1');
 expect(montarClientes({notas:notas.slice(0,3),de:'2026-08',ate:'2026-08',hoje:'2026-09-16'}).clientes[0].recorrente).toBe(false);
});

test('meta usa ticket sem arredondar para não subestimar clientes',()=>{
 const base={receita:100,fixos:0,variaveis:0,prolabore:0,clientes:6,aliquota:0};
 expect(calcularCenario(base).ticket).toBe(16.67);
 expect(calcularMeta(base,100.01)).toEqual({receita:100.01,clientes:7});
 expect(calcularMeta(base,100)).toEqual({receita:100,clientes:6});
});
