import { estatisticaMensal } from "./gestao.js";
// Regra pura compartilhada por API e demonstração. Somente notas válidas da empresa.
const mesRe = /^\d{4}-(0[1-9]|1[0-2])$/;
export function deslocarMes(m,n) { const [a,b]=m.split('-').map(Number);return new Date(Date.UTC(a,b-1+n,1)).toISOString().slice(0,7); }
const meses=(a,b)=>{const r=[];for(let m=a;m<=b&&r.length<60;m=deslocarMes(m,1))r.push(m);return r;};
const soma=a=>a.reduce((s,v)=>s+v,0);
const mediana=a=>{const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
// Identidade brasileira pelo documento, nunca por semelhança do nome. Não valida cadastro fiscal.
export function documentoCliente(v) { const d=String(v||'').replace(/[.\-/\s]/g,''); return /^(\d{11}|\d{14})$/.test(d)?d:null; }
export function montarClientes({notas,de,ate,comparar='anterior',hoje}) {
  if(!mesRe.test(de)||!mesRe.test(ate)||de>ate||meses(de,ate).length>24||!['anterior','ano'].includes(comparar))throw new Error('PERIODO_INVALIDO');
  const n=meses(de,ate).length,recuo=comparar==='ano'?12:n;
  const anterior={de:deslocarMes(de,-recuo),ate:deslocarMes(ate,-recuo)};
  const grupos=new Map(),vistos=new Set();let semIdentificacao=0,valorSemIdentificacao=0,invalidas=0,inicioHistorico=null;
  for(const nota of notas){
    if(vistos.has(nota.id))continue;vistos.add(nota.id);
    const m=String(nota.competencia||'').slice(0,7),v=nota.total==null||String(nota.total).trim()===''?NaN:Number(nota.total);
    if(!mesRe.test(m)||!Number.isFinite(v)||v<0){invalidas++;continue;}
    if(m>ate)continue;
    if(!inicioHistorico||m<inicioHistorico)inicioHistorico=m;
    const centavos=Math.round(v*100),doc=documentoCliente(nota.tomadorDoc);
    if(!doc){if(m>=de){semIdentificacao++;valorSemIdentificacao+=centavos;}continue;}
    if(!grupos.has(doc))grupos.set(doc,{documento:doc,nome:doc,porMes:new Map(),notas:[],primeira:m,ultima:m});
    const g=grupos.get(doc);
    if(m>=g.ultima){g.ultima=m;g.nome=nota.tomadorNome?.trim()||g.nome;}
    g.primeira=g.primeira<m?g.primeira:m;
    g.porMes.set(m,(g.porMes.get(m)||0)+centavos);
    g.notas.push({id:nota.id,numero:nota.numero||null,competencia:m,valor:centavos/100});
  }
  const serieMeses=meses(deslocarMes(ate,-11),ate);
  const clientes=[...grupos.values()].map(g=>{
    const total=(a,b)=>soma([...g.porMes].filter(([m])=>m>=a&&m<=b).map(([,v])=>v));
    const atual=total(de,ate),base=total(anterior.de,anterior.ate);
    const recorrente=meses(deslocarMes(ate,-3),ate).filter(m=>(g.porMes.get(m)||0)>0).length>=3;
    const referencia=ate>=hoje.slice(0,7)?deslocarMes(hoje.slice(0,7),-1):ate;
    const historicoBase=meses(deslocarMes(referencia,-6),deslocarMes(referencia,-1)).map(m=>g.porMes.get(m)||0);
    const suficientes=historicoBase.filter(v=>v>0).length>=3;
    const habitual=suficientes?mediana(historicoBase):null,ultimoValor=g.porMes.get(referencia)||0;
    const disparidade=habitual>0&&Math.abs(ultimoValor/habitual-1)>=.3?{mes:referencia,atual:ultimoValor/100,mediana:habitual/100,variacao:(ultimoValor/habitual-1)*100}:null;
    const notasPeriodo=g.notas.filter(n=>n.competencia>=de&&n.competencia<=ate).sort((a,b)=>b.competencia.localeCompare(a.competencia)||String(a.id).localeCompare(String(b.id)));
    const situacao=atual>0?(g.primeira>=de?'Novo no histórico':base===0?'Sem faturamento na base anterior':'Com faturamento nos dois períodos'):base>0?'Sem faturamento no período':'Somente histórico';
    return {documento:g.documento,nome:g.nome,atual:atual/100,anterior:base/100,variacao:base>0?(atual/base-1)*100:null,diferenca:(atual-base)/100,acumulado:soma([...g.porMes.values()])/100,primeira:g.primeira,ultima:g.ultima,recorrente,situacao,disparidade,notas:notasPeriodo,quantidade:notasPeriodo.length,ticket:notasPeriodo.length?atual/100/notasPeriodo.length:null,serie:serieMeses.map(m=>({mes:m,valor:g.porMes.has(m)?g.porMes.get(m)/100:null}))};
  }).sort((a,b)=>b.atual-a.atual||a.nome.localeCompare(b.nome));
  const ativos=clientes.filter(c=>c.atual>0),total=soma(ativos.map(c=>Math.round(c.atual*100)))/100,base=soma(clientes.map(c=>Math.round(c.anterior*100)))/100;
  for(const c of clientes)c.participacao=total>0?c.atual/total*100:null;
  const ponte={novos:0,semBase:0,expansao:0,reducao:0,semFaturamento:0};
  for(const c of clientes){const k=c.anterior===0?(c.primeira>=de?'novos':'semBase'):c.atual===0?'semFaturamento':c.diferenca>=0?'expansao':'reducao';ponte[k]+=Math.round(c.diferenca*100);}
  for(const k of Object.keys(ponte))ponte[k]/=100;
  const totalNotas=soma(clientes.map(c=>c.quantidade));
  return {de,ate,anterior,hoje,inicioHistorico,parcial:ate>=hoje.slice(0,7),semIdentificacao,valorSemIdentificacao:valorSemIdentificacao/100,invalidas,clientes,ponte,
    politicaRecorrencia:{versao:"3-de-4-v1",de:deslocarMes(ate,-3),ate},
    estatistica:estatisticaMensal(meses(de,ate).map(m=>{const gs=[...grupos.values()].filter(g=>g.porMes.has(m));return {mes:m,valor:gs.length?soma(gs.map(g=>g.porMes.get(m)))/100:null};})),
    resumo:{total,anterior:base,top1:total>0?soma(ativos.slice(0,1).map(c=>c.atual))/total*100:null,top3:total>0?soma(ativos.slice(0,3).map(c=>c.atual))/total*100:null,top3Anterior:base>0?soma([...clientes].sort((a,b)=>b.anterior-a.anterior).slice(0,3).map(c=>c.anterior))/base*100:null,taxaRecorrencia:ativos.length?ativos.filter(c=>c.recorrente).length/ativos.length*100:null,receitaRecorrentes:soma(ativos.filter(c=>c.recorrente).map(c=>Math.round(c.atual*100)))/100,ativos:ativos.length,media:ativos.length?total/ativos.length:null,ticket:totalNotas?total/totalNotas:null,top5:total>0?soma(ativos.slice(0,5).map(c=>c.atual))/total*100:null,novos:ativos.filter(c=>c.primeira>=de).length,semFaturamento:clientes.filter(c=>c.anterior>0&&c.atual===0).length,recorrentes:ativos.filter(c=>c.recorrente).length,maior:ativos[0]||null,menor:ativos.at(-1)||null},
    serie:serieMeses.map(m=>{const encontrados=[...grupos.values()].filter(g=>g.porMes.has(m));return {mes:m,valor:encontrados.length?soma(encontrados.map(g=>g.porMes.get(m)))/100:null,clientes:encontrados.filter(g=>g.porMes.get(m)>0).length};}),
  };
}
