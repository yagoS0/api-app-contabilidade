import { validarBaseSocios, resumirSocios } from "../../../../../packages/shared/src/analise/socios.js";
import { calcularCenario, validarPremissas, VERSAO_GESTAO } from '../../../../../packages/shared/src/analise/gestao.js';
const memoria = new Map();
const ler = key => {try{return JSON.parse(localStorage.getItem('dev-gerencial:'+key)||'null')??memoria.get(key);}catch{return memoria.get(key);}};
const gravar = (key,value) => {memoria.set(key,structuredClone(value));try{localStorage.setItem('dev-gerencial:'+key,JSON.stringify(value));}catch{}};
import { fluxoDeCaixaDoMock } from './fluxoRelatoriosFixture';
import { analisePlanejamentoMock } from './analisePlanejamentoMock';
import { clientesAnaliseMock } from './clientesAnaliseMock';
// Spread dentro do objeto da API mock. Usa o preflight existente via this, sem outro ledger.
export const mockRelatorios = {
  async getBaseSociosGerencial(id,{de,ate}) {const todos=ler('socios:'+id)||[],vistos=new Set();return {ok:true,registros:todos.filter(r=>{if(r.competencia<de||r.competencia>ate||vistos.has(r.competencia))return false;vistos.add(r.competencia);return true;})};},
  async salvarBaseSociosGerencial(id,dados) {const registro={...validarBaseSocios(dados),id:crypto.randomUUID(),createdAt:new Date().toISOString()};gravar('socios:'+id,[registro,...(ler('socios:'+id)||[])]);return {ok:true,registro};},
  async getRelatorioGerencialSnapshot(id,filtros) {const dados=analisePlanejamentoMock(id,filtros),basesSocios=(await this.getBaseSociosGerencial(id,filtros)).registros;const meses=[];for(let m=filtros.de;m<=filtros.ate&&meses.length<24;){meses.push(m);const [a,b]=m.split('-').map(Number);m=new Date(Date.UTC(a,b,1)).toISOString().slice(0,7);}return {ok:true,dados,clientes:clientesAnaliseMock(id,filtros),classificacao:(await this.getClassificacaoGerencial(id)).contas,basesSocios,socios:resumirSocios(basesSocios,meses,dados.atual.indicadores.resultado)};},
  async getBaseTributariaGerencial(id,referencia) {return {ok:true,demonstracao:true,referencia:{competencia:referencia},campos:{rbt12:{apurado:!id.endsWith('007'),valor:1200000,origem:'Exemplo fictício'},folhaAnual:{apurado:!id.endsWith('007'),valor:360000,origem:'Exemplo fictício'}}};},
  async getClassificacaoGerencial(id) {return structuredClone(ler('contas:'+id)||{ok:true,contas:{},revisao:0});},
  async salvarClassificacaoGerencial(id,{contas,revisao}) {const anterior=await this.getClassificacaoGerencial(id);if(anterior.revisao!==revisao)throw Error('Classificação alterada. Recarregue.');const r={ok:true,contas:structuredClone(contas),revisao:revisao+1};gravar('contas:'+id,r);return r;},
  async listarCenariosLaboratorio() {return {ok:true,cenarios:structuredClone(ler('cenarios')||[])};},
  async salvarCenarioLaboratorio(d) {const a=validarPremissas(d.a),b=validarPremissas(d.b);const cenario={id:crypto.randomUUID(),companyId:d.companyId||null,nome:d.nome,periodo:d.periodo,entradasJson:{a,b},resultadoJson:{a:calcularCenario(a),b:calcularCenario(b)},origemJson:{declaracaoAutor:d.procedencia},versao:VERSAO_GESTAO,createdAt:new Date().toISOString()};gravar('cenarios',[cenario,...(ler('cenarios')||[])]);return {ok:true,cenario};},
  async getAnaliseClientes(companyId,filtros) {return clientesAnaliseMock(companyId,filtros);},
  async getAnalisePlanejamento(companyId,filtros) { return analisePlanejamentoMock(companyId,filtros); },
  async getAnaliseLancamentos(companyId,{conta,de,ate,pagina=1}) {
    const dados=analisePlanejamentoMock(companyId,{de,ate});
    const c=dados.atual.dre.linhas.flatMap(l=>l.contas).find(c=>c.reduzido===conta);
    return {ok:true,temMais:false,linhas:pagina!==1||!c?[]:[{id:'demo-entry',competencia:de,historico:'Lançamento fictício para conferir o detalhamento',status:'CONFIRMADO',lines:[{tipo:c.valor<0?'D':'C',conta,valor:Math.abs(c.valor)}]}]};
  },
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
