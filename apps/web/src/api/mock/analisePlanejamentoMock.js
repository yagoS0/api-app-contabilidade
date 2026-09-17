import { fechamentosRelatorioMock } from './fechamentosRelatorioMock';
// Dados exclusivamente fictícios. A API real nunca importa este módulo.
const mover=(s,n)=>{const [y,m]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};
const lista=(de,ate)=>{const a=[];for(let m=de;m<=ate&&a.length<60;m=mover(m,1))a.push(m);return a;};
const defs=[['receitaBruta','Receita bruta',1],['deducoes','(-) Deduções',-.08],['receitaLiquida','= Receita líquida',.92],['custos','(-) Custos',-.3],['lucroBruto','= Lucro bruto',.62],['pessoal','(-) Pessoal',-.2],['gerais','(-) Despesas gerais',-.1],['tributarias','(-) Despesas tributárias',-.02],['depreciacao','(-) Depreciação',-.01],['resultadoOperacional','= Resultado operacional',.29],['receitasFinanceiras','Receitas financeiras',.01],['despesasFinanceiras','(-) Despesas financeiras',-.02],['outrasReceitas','Outras receitas',0],['irpjCsll','(-) IRPJ/CSLL',-.03],['resultadoDoPeriodo','= Resultado do período',.25]];
export function analisePlanejamentoMock(id,{de,ate,comparar='anterior'}) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(de)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(ate)||de>ate||lista(de,ate).length>24)throw new Error('Escolha um período válido de até 24 meses.');
  const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}), recuo=comparar==='ano'?12:lista(de,ate).length;
  const fechados=new Set(fechamentosRelatorioMock(id));
  const pendentes=lista(de,ate).filter(m=>!fechados.has(m));
  if(pendentes.length){const e=new Error(`Feche a contabilidade em Lançamentos para consultar: ${pendentes.join(', ')}.`);e.code='CONTABILIDADE_ABERTA';e.payload={mesesSemFechamento:pendentes};throw e;}
  const anteriorPeriodo={de:mover(de,-recuo),ate:mover(ate,-recuo)};
  const inicio=[anteriorPeriodo.de,mover(ate,-11)].sort()[0];
  const semDados=String(id).endsWith('007');
  function periodo(a,b){
    const ms=lista(a,b), total=ms.reduce((s,m)=>s+90000+(Number(m.slice(0,4))-2024)*9000+Number(m.slice(5))*1800,0);
    const linhas=defs.map(([chave,rotulo,fator],i)=>({chave,rotulo,valor:total*fator,tipo:rotulo.startsWith('=')?'subtotal':'linha',contas:rotulo.startsWith('=')||semDados?[]:[{codigo:`4110${i}`,reduzido:String(i+10),nome:rotulo.replace('(-) ',''),valor:total*fator}]}));
    const faltas={contabilidade:semDados?ms:[],faturamento:semDados?ms:[],guias:semDados?ms:[]};
    return {de:a,ate:b,parcial:semDados||b>=hoje.slice(0,7),faltas,dre:{linhas,semLancamento:semDados,naoClassificado:[],qualidade:{provisorio:false}},indicadores:{faturamento:semDados?null:total,resultado:semDados?null:total*.25,despesas:semDados?null:total*.35,tributos:semDados?null:total*.08,margemBruta:semDados?null:.62/.92*100,margemOperacional:semDados?null:.29/.92*100,margemLiquida:semDados?null:.25/.92*100,carga:semDados?null:8}};
  }
  const atual=periodo(de,ate), anterior=periodo(anteriorPeriodo.de,anteriorPeriodo.ate),serie=lista(inicio,ate).map(m=>({competencia:m,...periodo(m,m)}));
  for(const p of [atual,anterior,...serie]){p.mesesSemFechamento=lista(p.de,p.ate).filter(m=>!fechados.has(m));p.indisponivel=p.mesesSemFechamento.length>0;if(p.indisponivel){p.parcial=true;p.dre.semLancamento=true;p.dre.linhas=p.dre.linhas.map(l=>({...l,valor:null,contas:[]}));p.indicadores=Object.fromEntries(Object.keys(p.indicadores).map(k=>[k,null]));}}
  const variacoes=Object.fromEntries(Object.keys(atual.indicadores).map(k=>{const a=atual.indicadores[k],b=anterior.indicadores[k],p=k.startsWith('margem')||k==='carga';return [k,{absoluta:a==null||b==null?null:a-b,percentual:p||!b||a==null?null:(a/b-1)*100,texto:p&&a!=null&&b!=null?`${(a-b).toFixed(2)} p.p.`:'Sem base comparável'}];}));
  const guias=semDados?[]:serie.flatMap((s,i)=>[{id:`demo-${i}`,tipo:'SIMPLES',competencia:s.competencia,valor:s.indicadores.tributos,vencimento:`${mover(s.competencia,1)}-20`,paymentStatus:i<serie.length-1?'PAID':'OPEN',liberadaCliente:true},{id:`demo-parcela-${i}`,tipo:'Parcelamento fiscal',competencia:s.competencia,valor:950,vencimento:`${s.competencia}-28`,paymentStatus:i<serie.length-1?'PAID':'OPEN',parcelamentoId:'demo-contrato',numeroParcela:i+1,liberadaCliente:true}]);
  return {ok:true,demonstracao:true,hoje,atual,anterior,serie,variacoes,guias,insights:[],cobertura:serie.map(m=>({competencia:m.competencia,fechadoContabilEm:fechados.has(m.competencia)?'2026-01-01':null,contabilidade:!semDados,faturamento:!semDados,guias:!semDados})),avisos:['Dados fictícios de desenvolvimento. Não representam valores de empresas reais.','Guias de parcelamento não entram na carga tributária corrente.']};
}
