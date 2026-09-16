import { montarClientes } from '../../../../../../packages/shared/src/analise/clientes.js';
const nota=(id,competencia,total,tomadorDoc='12345678901',tomadorNome='Cliente A')=>({id,competencia,total,tomadorDoc,tomadorNome});
const run=notas=>montarClientes({notas,de:'2026-08',ate:'2026-08',hoje:'2026-09-10'});
test('agrupa documento com máscara, não mistura homônimos e deduplica ID',()=>{
 const a=nota('a','2026-08',100,'123.456.789-01');const r=run([a,a,nota('b','2026-08',200),nota('c','2026-08',90,'98765432100')]);
 expect(r.resumo.ativos).toBe(2);expect(r.resumo.total).toBe(390);expect(r.clientes[0].atual).toBe(300);expect(r.resumo.media).toBe(195);expect(r.resumo.ticket).toBe(130);
});
test('acumulado usa histórico anterior à janela sem incorporar futuro',()=>{const r=run([nota('a','2024-01',50),nota('b','2026-08',100),nota('c','2026-09',999)]);expect(r.clientes[0].acumulado).toBe(150);expect(r.resumo.novos).toBe(0);expect(r.clientes[0].primeira).toBe('2024-01');});
test('sem documento não cria um cliente anônimo nem se perde na cobertura',()=>{const r=run([nota('a','2026-08',75,null),nota('b','2026-08',25,'abc')]);expect(r.clientes).toHaveLength(0);expect(r.semIdentificacao).toBe(2);expect(r.valorSemIdentificacao).toBe(100);expect(r.resumo.media).toBeNull();});
test('ponte reconcilia novos, expansão, redução e ausência',()=>{const r=run([nota('a','2026-07',100),nota('b','2026-08',200),nota('c','2026-07',50,'98765432100'),nota('d','2026-08',70,'11122233344')]);expect(Object.values(r.ponte).reduce((s,v)=>s+v,0)).toBe(r.resumo.total-r.resumo.anterior);expect(r.resumo.semFaturamento).toBe(1);expect(r.resumo.novos).toBe(1);});
test('mediana mensal usa soma de notas, sinaliza ausência e exige histórico',()=>{const notas=['02','03','04','05','06','07'].flatMap(m=>[nota(`${m}a`,`2026-${m}`,50),nota(`${m}b`,`2026-${m}`,50)]);const r=run(notas);expect(r.clientes[0].disparidade).toEqual({mes:'2026-08',atual:0,mediana:100,variacao:-100});expect(r.clientes[0].recorrente).toBe(true);expect(run([nota('a','2026-07',100)]).clientes[0].disparidade).toBeNull();});
test('documento sem valor é inválido, não zero; comparação anual',()=>{const r=montarClientes({notas:[nota('a','2026-08',null)],de:'2026-01',ate:'2026-08',comparar:'ano',hoje:'2026-09-10'});expect(r.invalidas).toBe(1);expect(r.anterior).toEqual({de:'2025-01',ate:'2025-08'});});
test('ticket inclui nota válida zerada e não aumenta clientes com faturamento',()=>{const r=run([nota('a','2026-08',100),nota('b','2026-08',0,'98765432100')]);expect(r.resumo.ticket).toBe(50);expect(r.resumo.ativos).toBe(1);});
