import { montarClientes, deslocarMes } from '../../../../../packages/shared/src/analise/clientes.js';
// Cabeçalhos fictícios; a mesma regra da API calcula indicadores, gráficos e composição.
export function clientesAnaliseMock(id,filtros) {
  const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),fim=hoje.slice(0,7);
  const nomes=['Clínica Aurora','Ateliê Horizonte','Estúdio Ipê','Escola Alameda','Oficina Prisma','Consultoria Semente','Agência Nuvem'];
  const notas=[];
  if(!String(id).endsWith('007'))for(let n=-35;n<=0;n++){
    const m=deslocarMes(fim,n),receita=90000+(Number(m.slice(0,4))-2024)*9000+Number(m.slice(5))*1800;
    const pesos=[36,22,14,10,8,n<-1?6:0,n>=-1?12:0],total=pesos.reduce((s,v)=>s+v,0);
    let distribuido=0;
    pesos.forEach((p,i)=>{if(!p)return;const valor=Math.round(receita*.98*p/total*100)/100;distribuido+=Math.round(valor*100);notas.push({id:`cliente-demo-${m}-${i}`,numero:`${m.replace('-','')}${i}`,competencia:m,total:valor,tomadorDoc:String(10000000000+i),tomadorNome:`${nomes[i]} · Exemplo`});});
    notas.push({id:`sem-doc-${m}`,numero:`${m.replace('-','')}9`,competencia:m,total:(Math.round(receita*100)-distribuido)/100,tomadorDoc:null,tomadorNome:'Tomador não identificado'});
  }
  return {ok:true,demonstracao:true,...montarClientes({notas,...filtros,hoje})};
}
