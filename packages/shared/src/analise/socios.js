export function validarBaseSocios(body) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(body?.competencia||'')||body?.confirmado!==true||typeof body.fonte!=='string'||body.fonte.trim().length<10||body.fonte.length>1000)throw new Error('Informe competência, fonte e confirmação dos pagamentos.');
  const valores={};
  for(const k of ['prolaborePago','distribuicaoPaga','outrasRetiradas']) {
    const v=body[k];if(v==null||v===''||!['string','number'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>1e10)throw new Error('Informe todos os valores, inclusive zero quando confirmado.');
    valores[k]=Math.round(Number(v)*100)/100;
  }
  return {competencia:body.competencia,fonte:body.fonte.trim(),...valores};
}
export function resumirSocios(registros,meses,resultado) {
  const mapa=new Map();for(const r of registros)if(!mapa.has(r.competencia))mapa.set(r.competencia,r);
  const faltas=meses.filter(m=>!mapa.has(m));if(faltas.length)return {faltas,completo:false};
  const soma=k=>meses.reduce((s,m)=>s+Math.round(Number(mapa.get(m)[k])*100),0)/100;
  const prolabore=soma('prolaborePago'),distribuicao=soma('distribuicaoPaga'),outras=soma('outrasRetiradas');
  return {faltas:[],completo:true,prolabore,distribuicao,outras,total:Math.round((prolabore+distribuicao+outras)*100)/100,resultadoMenosDistribuicao:resultado==null?null:Math.round((resultado-distribuicao)*100)/100};
}
