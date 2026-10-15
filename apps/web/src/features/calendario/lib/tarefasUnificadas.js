import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';
export function prepararTarefasCalendario(itens, empresas = []) {
  const nomes = new Map(empresas.map(e => [e.companyId || e.id || e.portalClientId, e]));
  return itens.map(item => ({ ...item.config, ...item, unificada:true, tipo:'tarefa', resolvido:Boolean(item.concluidaEm || item.resolvido),
    empresas:(item.empresas || []).map(e => { const c=nomes.get(e.companyId); return {...e,nome:c?.razao || c?.razaoSocial || c?.nome || c?.name || e.nome || 'Empresa vinculada'}; }),
  }));
}
/** Todas as aparições preservam a identidade e conclusão da mesma ocorrência. */
export function projetarTarefasCalendario(itens,inicio,fim,hoje) {
  const resultado=[];
  for(const item of itens){
    const datas=new Set();
    for(let dia=item.dataInicio<inicio?inicio:item.dataInicio;dia<=item.dataFim&&dia<=fim;dia=somarDiasAgenda(dia,1))datas.add(dia);
    if(!item.resolvido)for(const dia of item.diasAlerta || [])if(dia>=inicio&&dia<=fim)datas.add(dia);
    for(const dia of [...datas].sort()){
      const alertaVencimento=!item.resolvido&&item.dataVencimento ? dia===item.dataVencimento?'HOJE':dia===somarDiasAgenda(item.dataVencimento,-1)?'AMANHA':item.dataVencimento<hoje?'ATRASADA':null:null;
      const projecaoAlerta=dia<item.dataInicio||dia>item.dataFim;
      resultado.push({...item,id:`${item.id}@${dia}`,dataInicio:dia,dataFim:dia,diaSelecionado:dia,atividadeOriginal:item,alertaVencimento,projecaoAlerta,...(projecaoAlerta?{horaInicio:null,horaFim:null}:{})});
    }
  }
  return resultado.sort((a,b)=>Number(Boolean(b.alertaVencimento))-Number(Boolean(a.alertaVencimento))||a.dataInicio.localeCompare(b.dataInicio)||a.titulo.localeCompare(b.titulo,'pt-BR'));
}
