import { sugerirClassificacoes } from './classificacao.js';
// Valores gerenciais: regras puras compartilhadas por relatórios, API e laboratório.
export const VERSAO_GESTAO = 'gestao-1';
const moeda = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function estatisticaMensal(serie) {
  const observados = serie.filter(s => Number.isFinite(s.valor));
  if (!observados.length) return { quantidade: 0, ausentes: serie.length, media: null, minimo: null, maximo: null, desvio: null };
  const valores = observados.map(s => s.valor), media = valores.reduce((a,b)=>a+b,0)/valores.length;
  return { quantidade: valores.length, ausentes: serie.length-valores.length, media: moeda(media), minimo: Math.min(...valores), maximo: Math.max(...valores), desvio: moeda(Math.sqrt(valores.reduce((s,v)=>s+(v-media)**2,0)/valores.length)) };
}

export function validarPremissas(entrada) {
  const limites = { receita: 1e10, fixos: 1e10, variaveis: 1e10, prolabore: 1e10, clientes: 1e7, aliquota: 100 };
  const dados = {};
  for (const [campo,limite] of Object.entries(limites)) {
    const v = entrada?.[campo];
    if (v === '' || v == null || !['string','number'].includes(typeof v) || !Number.isFinite(Number(v)) || Number(v)<0 || Number(v)>limite) throw new Error(`Informe ${campo} entre 0 e ${limite}.`);
    dados[campo] = campo==='clientes'||campo==='aliquota'?Number(v):moeda(Number(v));
  }
  if (!Number.isInteger(dados.clientes)) throw new Error('Clientes deve ser um número inteiro.');
  dados.tributosNosCustos=entrada?.tributosNosCustos===true;
  const outras=entrada?.outrasReceitas??0;
  if(outras===''||!['number','string'].includes(typeof outras)||!Number.isFinite(Number(outras))||Number(outras)<0||Number(outras)>1e10)throw new Error('Informe outrasReceitas entre 0 e 10000000000.');
  dados.outrasReceitas=moeda(Number(outras));
  if(dados.tributosNosCustos&&dados.aliquota!==0)throw new Error('Informe alíquota zero quando os tributos já estão incluídos nos custos.');
  if (dados.receita===0 && dados.variaveis>0) throw new Error('Custos variáveis positivos exigem receita de referência.');
  return dados;
}

// Pró-labore separado; fixos e variáveis devem excluir pró-labore e tributos desta premissa.
// Distribuição de lucros e saldo bancário não fazem parte deste cálculo econômico.
export function calcularCenario(entrada) {
  const p=validarPremissas(entrada), tributos=moeda(p.receita*p.aliquota/100);
  const contribuicao=moeda(p.receita-p.variaveis-tributos);
  const taxa=p.receita>0?contribuicao/p.receita:null;
  const estrutura=moeda(p.fixos+p.prolabore), resultado=moeda(contribuicao-estrutura+p.outrasReceitas);
  return { versao:VERSAO_GESTAO, receita:p.receita, tributos:p.tributosNosCustos?null:tributos, tributosNosCustos:p.tributosNosCustos, contribuicao, margemContribuicao:taxa==null?null:taxa*100, resultado, margem:p.receita>0?resultado/p.receita*100:null, ticket:p.clientes>0?moeda(p.receita/p.clientes):null, equilibrio:taxa>0?moeda(estrutura/taxa):null, cobertura:estrutura>0?contribuicao/estrutura:null };
}

export function calcularMeta(entrada, lucro) {
  const p=validarPremissas(entrada), r=calcularCenario(p);
  if (!Number.isFinite(lucro)||lucro<0||r.margemContribuicao<=0||r.margemContribuicao==null) return null;
  const receita=moeda(Math.max(0,p.fixos+p.prolabore+lucro-p.outrasReceitas)/(r.margemContribuicao/100));
  return { receita, clientes:p.receita>0&&p.clientes>0?Math.ceil(receita*p.clientes/p.receita):null };
}

export function receitaParaMargem(entrada, margem) {
  const p=validarPremissas(entrada);
  if(p.receita<=0||!Number.isFinite(margem))return null;
  const sobra=1-p.aliquota/100-p.variaveis/p.receita-margem/100;
  return sobra>0?moeda(Math.max(0,p.fixos+p.prolabore-p.outrasReceitas)/sobra):null;
}

export const CHAVES_CUSTOS = ['deducoes','custos','pessoal','gerais','tributarias','depreciacao','despesasFinanceiras','irpjCsll'];
export function contasGerenciais(dre) {
  return dre.linhas.filter(l=>CHAVES_CUSTOS.includes(l.chave)).flatMap(l=>(l.contas||[]).map(c=>({...c,categoria:l.rotulo,chaveCategoria:l.chave,custo:moeda(-c.valor)})));
}

export function calcularGestao(dre, classificacoes={}) {
  const contas=contasGerenciais(dre);
  const sugestao=sugerirClassificacoes(contas,classificacoes); classificacoes=sugestao.efetivas;
  const pendentes=contas.filter(c=>!['FIXO','VARIAVEL'].includes(classificacoes[c.codigo]?.comportamento));
  const receita=dre.linhas.find(l=>l.chave==='receitaBruta')?.valor;
  const bloqueado=dre.semLancamento||dre.qualidade?.linhasInvalidas>0||dre.qualidade?.linhasNaoClassificadas>0||dre.naoClassificado?.length>0||pendentes.length>0||!Number.isFinite(receita)||contas.some(c=>c.custo<0);
  const fixos=moeda(contas.filter(c=>classificacoes[c.codigo]?.comportamento==='FIXO').reduce((s,c)=>s+c.custo,0));
  const variaveis=moeda(contas.filter(c=>classificacoes[c.codigo]?.comportamento==='VARIAVEL').reduce((s,c)=>s+c.custo,0));
  const prolabore=moeda(contas.filter(c=>classificacoes[c.codigo]?.prolabore===true).reduce((s,c)=>s+c.custo,0));
  const contribuicao=bloqueado?null:moeda(receita-variaveis), taxa=receita>0&&contribuicao!=null?contribuicao/receita:null;
  return { classificacoes, sugestoes:sugestao.sugestoes, automaticas:sugestao.automaticas, versao:VERSAO_GESTAO, pendentes:pendentes.map(c=>c.codigo), bloqueado:!!bloqueado, fixos, variaveis, prolabore:bloqueado?null:prolabore, contribuicao, margemContribuicao:taxa==null?null:taxa*100, equilibrio:taxa>0?moeda(fixos/taxa):null, cobertura:!bloqueado&&fixos>0?contribuicao/fixos:null, prolaborePercentual:!bloqueado&&receita>0?prolabore/receita*100:null };
}
