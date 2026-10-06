import { projetarFluxoCarteira, ROTINAS_CARTEIRA, chaveDaObrigacaoCarteira } from '@contabilidade/shared/fluxo-carteira';
import { validarEdicaoTarefa } from '@contabilidade/shared/validar-tarefa-carteira';

export function withFluxoCarteiraMock(api, fonte = () => ({ entries: [], fechadoEm: null })) {
  const registros = new Map();
  const fingerprint = value => JSON.stringify(value);
  function detalhe(company, competencia, obrigacoes = []) {
    const id=company.companyId, { entries, fechadoEm }=fonte(id,competencia);
    const regs=[...registros.values()].filter(r=>r.portalClientId===id && r.competencia===competencia);
    const importacoes=regs.find(r=>r.chave==='importar')?.dados.importacoes || {};
    const lancamentos=entries.filter(e=>e.tipo!=='PARCELA').map(e=>({id:e.id,historico:e.historico,status:e.status,hash:fingerprint([fechadoEm,e.id,e.status,e.data,e.historico,e.lines]),importavel:Boolean(fechadoEm)&&e.status==='EXPORTADO'}));
    for(const e of lancamentos)e.importado=e.importavel&&importacoes[e.id]?.hash===e.hash;
    const base=fingerprint([id,competencia,company.apuracao,company.notasEmitidas]);
    const obs=obrigacoes.filter(o=>o.companyId===id && o.tipo!=='TAREFA' && !chaveDaObrigacaoCarteira(o.verificador)).flatMap(o=>(o.ocorrencias||[]).filter(oc=>oc.competenciaRef===competencia && !oc.canceladaEm && !oc.foraDaRecorrencia).map(oc=>({id:oc.ocorrenciaId,nome:o.nome,concluida:oc.situacao==='CONCLUIDA',verificador:o.verificador})));
    const contexto={competencia,registros:regs,obrigacoes:obs,hashes:{apurar:base,transmitir:base,obrigacoes:fingerprint([base,obs]),importar:fingerprint(lancamentos)},lancamentos:{total:lancamentos.length,importados:lancamentos.filter(e=>e.importado).length}};
    return {ok:true,empresa:company.razao,fluxo:projetarFluxoCarteira({...company,fechamentoContabil:{fechado:Boolean(fechadoEm)}},contexto),lancamentos};
  }
  const result={...api,
    async listObrigacoes(options = {}) {
      const out = await api.listObrigacoes(options);
      const cache = new Map();
      for (const o of out.obrigacoes || []) {
        const chave = chaveDaObrigacaoCarteira(o.verificador);
        if (!chave) continue;
        o.ocorrencias = await Promise.all(o.ocorrencias.map(async oc => {
          const key = o.companyId + '|' + oc.competenciaRef;
          if (!cache.has(key)) cache.set(key, result.getFluxoCarteira(o.companyId, oc.competenciaRef));
          const view = await cache.get(key);
          const feita = view.fluxo.tarefas.find(t => t.chave === chave)?.concluida;
          return {...oc, situacao: feita ? 'CONCLUIDA' : oc.dataVencimento < new Date().toISOString().slice(0,10) ? 'VENCIDA' : 'PENDENTE'};
        }));
      }
      return out;
    },
    async listCompanies(comp='2026-07') {
      const companies=await api.listCompanies(comp);
      const obs=await api.listObrigacoes({});
      return companies.map(c=>({...c,fluxoCarteira:detalhe(c,comp,obs.obrigacoes).fluxo}));
    },
    async getFluxoCarteira(id,competencia) {
      const company=(await api.listCompanies(competencia)).find(c=>c.companyId===id);
      if(!company)throw new Error('Empresa não encontrada.');
      const obs=await api.listObrigacoes({companyId:id});
      return detalhe(company,competencia,obs.obrigacoes);
    },
    async salvarFluxoTarefa(id,chave,corpo) {
      if(!ROTINAS_CARTEIRA.some(t=>t.chave===chave)&&!/^extra:[a-zA-Z0-9-]{1,80}$/.test(chave))throw new Error('Tarefa inválida.');
      const view=await result.getFluxoCarteira(id,corpo.competencia);
      const tarefa=view.fluxo.tarefas.find(t=>t.chave===chave)||(chave.startsWith('extra:')?{chave,versao:0,dados:{}}:null);
      if(!tarefa)throw new Error('Tarefa não se aplica.');
      if(chave.startsWith('extra:')&&!tarefa.versao&&(!corpo.titulo?.trim()||!corpo.etapa||corpo.acao!=='planejar'))throw new Error('Informe título e etapa.');
      const key=`${id}|${corpo.competencia}|${chave}`;
      // Reconfere após a leitura assíncrona para não aceitar duas gravações da mesma versão.
      if((registros.get(key)?.versao||0)!==corpo.versao)throw new Error('A tarefa mudou. Atualize antes de salvar.');
      const dados=validarEdicaoTarefa(corpo,tarefa,view),em=new Date().toISOString();
      if(corpo.acao==='concluir')dados.conclusao={...dados.conclusao,em,por:'demo'};
      const anterior=registros.get(key);
      registros.set(key,{portalClientId:id,competencia:corpo.competencia,chave,dados,versao:corpo.versao+1,historico:[...(anterior?.historico||[]),{id:`demo-${Date.now()}`,em,por:'demo',acao:corpo.acao,dados}]});
      return {ok:true};
    },
    async getAgendaCarteira(inicio,fim,companyId) {
      const itens=[];
      for(const r of registros.values())if(r.dados.dataInicio<=fim&&r.dados.dataFim>=inicio&&(!companyId||r.portalClientId===companyId)){
        const view=await result.getFluxoCarteira(r.portalClientId,r.competencia),t=view.fluxo.tarefas.find(t=>t.chave===r.chave);
        itens.push({id:`fluxo:${r.portalClientId}:${r.competencia}:${r.chave}`,tipo:'fluxo',chave:r.chave,companyId:r.portalClientId,empresa:view.empresa,competencia:r.competencia,titulo:`${t.titulo} · ${view.fluxo.regime}`,dataInicio:r.dados.dataInicio,dataFim:r.dados.dataFim,resolvido:t.concluida});
      }
      return {ok:true,itens};
    },
  };
  return result;
}
