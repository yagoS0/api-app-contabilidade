import { fluxoDeCaixaDoMock } from './fluxoRelatoriosFixture';
// Spread dentro do objeto da API mock. Usa o preflight existente via this, sem outro ledger.
export const mockRelatorios = {
  async getFluxoCaixa(companyId,{janelaInicio}={}) {
    const hoje=new Date();
    const ciclo=`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
    return fluxoDeCaixaDoMock(companyId,ciclo,{janelaInicio});
  },
  async preflightEntriesBatch({companyIds=[],competenciaInicio,competenciaFim}={}) {
    const valid=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v));
    const ordinal=v=>Number(v.slice(0,4))*12+Number(v.slice(5))-1;
    if(!companyIds.length||companyIds.length>100||!valid(competenciaInicio)||!valid(competenciaFim)||ordinal(competenciaFim)<ordinal(competenciaInicio)||ordinal(competenciaFim)-ordinal(competenciaInicio)>11)throw new Error('Selecione de 1 a 100 empresas e um período de até 12 meses.');
    const empresas=[];
    for(const id of [...new Set(companyIds)]) {
      try {
        const checks=[];
        for(let n=ordinal(competenciaInicio);n<=ordinal(competenciaFim);n++)checks.push(await this.getExportPreflight(id,`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`));
        const erros=checks.flatMap(c=>(c.erros||[]).map(e=>({...e,competencia:c.competencia}))),alertas=checks.flatMap(c=>(c.alertas||[]).map(e=>({...e,competencia:c.competencia})));
        const quantidade=checks.reduce((s,c)=>s+(c.totais?.entries||0),0);
        empresas.push({id,quantidade,erros,alertas,estado:erros.length?'BLOQUEADA':quantidade?'PRONTA':'SEM_MOVIMENTO'});
      }catch(e){empresas.push({id,estado:'FALHA',motivo:e.message||'Falha na conferência.'});}
    }
    return {ok:true,competenciaInicio,competenciaFim,empresas};
  },
  async exportEntriesBatch() {
    throw new Error('O modo de demonstração permite conferir o lote, mas não gera o ZIP contábil. A exportação dos arquivos está disponível com a API real. Nenhum arquivo foi gerado.');
  },
};
