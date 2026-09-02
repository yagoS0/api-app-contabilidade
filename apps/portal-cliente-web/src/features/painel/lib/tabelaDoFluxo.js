// A TABELA DO FLUXO — as seis colunas do `SPEC-fluxo-de-caixa-v3.md` §3.2.
//
// `Mês | Entrada | Saída | Impostos | Folha | Resultado`
//
// ⚠⚠ ISTO NÃO MORA EM `leituraDoFluxo.js`, E A SEPARAÇÃO CONTINUA SENDO O PONTO — mas o ARGUMENTO
// mudou em 29/08/2026. Este parágrafo dizia que aquele arquivo era ESPELHO de
// `apps/web/src/features/fluxo/lib/leituraDoFluxo.js` ("mudou lá, muda aqui"), e isso ficou FALSO: o
// dono removeu o fluxo de caixa do portal do contador (*"para o contador não vai existir fluxo de
// caixa"*) e aquela pasta foi apagada inteira. **Não há mais cópia a sincronizar.**
//
// ⚠ O que sustenta a separação hoje: `leituraDoFluxo.js` LÊ o vocabulário do servidor (procedência,
// fonte, cor, evidência) e este arquivo AGREGA para a tabela desta tela. Misturá-los faria a
// agregação de UMA tela virar parte do vocabulário que o servidor manda. Aqui só se lê o que aquele
// arquivo já expõe.
//
// ⚠ Ela substituiu `planilhaDoFluxo.js` (a grade de Entrada/Saída/Recorrência/Diário de 27/08/2026).
// Aquele arquivo ficou sem consumidor — está anotado, não apagado, que é a regra desta casa.
//
// ⚠⚠ **O `status` DE UMA CÉLULA É O DO ELO MAIS FRACO** — `SPEC` §3.3: *"Resultado herda `previsto`
// se qualquer parcela for prevista."* Vale para toda célula, não só o Resultado: uma célula que soma
// uma guia paga com uma guia em aberto **não é um fato**, e pintá-la de preto afirmaria que o
// dinheiro já saiu.
//
// ⚠⚠ **A AUTORIDADE DESTA DERIVAÇÃO É O BACKEND** (`statusDoConjunto`, em
// `apps/api/src/application/fluxo/lib/fluxoDeCaixa.js`). Este módulo é ESPELHO, e o teste importa a
// função de lá e exige o mesmo veredito nos mesmos casos — sem isso "espelho" é intenção, e a
// divergência apareceria como a tela pintando de preto o que o servidor chama de previsto.

import { DIRECAO, FONTE, PROCEDENCIA, somarCompetencia } from "./leituraDoFluxo";

/** ⚠ O que o usuário VÊ: duas cores. O dado guarda três níveis (`PROCEDENCIA`). Constituição §1. */
export const STATUS = Object.freeze({ CONFIRMADO: "confirmed", PREVISTO: "forecast" });

/**
 * ⚠⚠ AS SEIS COLUNAS, e a ordem é a do spec.
 *
 * ⚠ `Impostos` e `Folha` saem de dentro da SAÍDA — não são um dado novo. O que os separa é a
 * `fonte`, que é vocabulário fechado do servidor: guia e imposto projetado viram Impostos, a folha
 * vira Folha, e o que sobra da saída é Saída. Um `else` no lugar de uma lista fechada faria uma
 * fonte NOVA cair silenciosamente em "Saída", que é o balde errado.
 */
const FONTES_DE_IMPOSTO = Object.freeze([FONTE.GUIA, FONTE.IMPOSTO_PROJETADO]);
const FONTES_DE_FOLHA = Object.freeze([FONTE.FOLHA]);

export const COLUNAS = Object.freeze([
  { chave: "entrada", rotulo: "Entrada" },
  { chave: "saida", rotulo: "Saída" },
  { chave: "impostos", rotulo: "Impostos" },
  { chave: "folha", rotulo: "Folha" },
  { chave: "resultado", rotulo: "Resultado" },
]);

/** ⚠ As três que viram percentual no modo `%`. Entrada e Resultado seguem em R$ (spec §3.6). */
export const COLUNAS_EM_PERCENTUAL = Object.freeze(["saida", "impostos", "folha"]);

function baldeDaLinha(l) {
  if (l?.direcao === DIRECAO.ENTRADA) return "entrada";
  if (l?.direcao !== DIRECAO.SAIDA) return null;
  if (FONTES_DE_IMPOSTO.includes(l?.fonte)) return "impostos";
  if (FONTES_DE_FOLHA.includes(l?.fonte)) return "folha";
  return "saida";
}

/**
 * ⚠⚠ UMA CÉLULA: `{ valor, status }` — ou `null`.
 *
 * `null` é "não há lançamento aqui", e a tela o desenha como traço. ⚠ **Nunca `{ valor: 0 }`**:
 * zero é uma afirmação ("conferi, é zero") e ausência não é. É a mesma distinção que
 * `folhaAusenteNaoEZero` trava no motor de apuração.
 */
function celula(linhas) {
  const comValor = (linhas || []).filter((l) => l && l.procedencia !== PROCEDENCIA.DESCONHECIDO);
  if (!comValor.length) return null;
  const valor = comValor.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const todasFato = comValor.every((l) => l.procedencia === PROCEDENCIA.FATO);
  return { valor, status: todasFato ? STATUS.CONFIRMADO : STATUS.PREVISTO };
}

/** ⚠ Soma de células que podem ser `null`. `null + null` continua `null`, nunca vira zero. */
function somar(...celulas) {
  const existentes = celulas.filter(Boolean);
  if (!existentes.length) return null;
  return {
    valor: existentes.reduce((s, c) => s + c.valor, 0),
    status: existentes.every((c) => c.status === STATUS.CONFIRMADO) ? STATUS.CONFIRMADO : STATUS.PREVISTO,
  };
}

/**
 * As cinco células de UM mês.
 *
 * ⚠⚠ **`Resultado = Entrada − (Saída + Impostos + Folha)`** — `SPEC` §3.2, e é o número que
 * `docs/dre-fluxo-caixa.md` proibia. A reversão é a nº 1 do §6 da Constituição, e o que a sustenta é
 * o `status`: o Resultado **herda previsto** de qualquer parcela, então ele nunca se apresenta como
 * certo. ⚠ Ele é do PERÍODO, jamais acumulado — acumulado exige âncora (Lei 3) e é Fase 3.
 */
export function linhaDoMes(mes) {
  const linhas = Array.isArray(mes?.linhas) ? mes.linhas : [];
  const porBalde = { entrada: [], saida: [], impostos: [], folha: [] };
  for (const l of linhas) {
    const balde = baldeDaLinha(l);
    if (balde) porBalde[balde].push(l);
  }

  const entrada = celula(porBalde.entrada);
  const saida = celula(porBalde.saida);
  const impostos = celula(porBalde.impostos);
  const folha = celula(porBalde.folha);
  const saidasTotais = somar(saida, impostos, folha);

  let resultado = null;
  if (entrada || saidasTotais) {
    resultado = {
      valor: (entrada?.valor || 0) - (saidasTotais?.valor || 0),
      status: [entrada, saidasTotais].filter(Boolean).every((c) => c.status === STATUS.CONFIRMADO)
        ? STATUS.CONFIRMADO
        : STATUS.PREVISTO,
    };
  }

  return { competencia: mes?.competencia || null, entrada, saida, impostos, folha, resultado };
}

/**
 * ⚠⚠ O MÊS DIA A DIA — e o que **não tem dia** ganha linha própria, nunca é espalhado.
 *
 * Medido no payload: a maioria das linhas chega com `dia: null` e um MOTIVO (o prazo de recebimento
 * é contado em meses; a recorrência diz o ciclo; a folha é por competência). Distribuí-las pelos
 * dias seria fabricar precisão que ninguém informou — a regra 1 deste projeto.
 *
 * ⚠ O `SPEC` §3.7 sugere dias-padrão para os previstos (entrada no 1º, folha no 5, imposto no 20) e
 * **marca isso como premissa do autor**, a validar. Enquanto ela não for decidida, o honesto é a
 * linha "no mês" — inventar o dia 20 é exatamente o que o `diaDesconhecido` existe para impedir.
 *
 * @param {{competencia?: string, linhas?: Array}} mes
 * @param {number} quantosDias dias do mês (28–31)
 */
export function linhasDosDias(mes, quantosDias) {
  const linhas = Array.isArray(mes?.linhas) ? mes.linhas : [];
  const semDia = [];
  const porDia = new Map();
  for (let d = 1; d <= quantosDias; d += 1) porDia.set(d, []);

  for (const l of linhas) {
    // ⚠ `dia` só vale quando o servidor o mandou E ele cabe no mês. Dia 31 num mês de 30 cairia
    // fora do `Map` e a linha sumiria — por isso o `has`, e não um `get` confiante.
    if (l?.dia && porDia.has(l.dia)) porDia.get(l.dia).push(l);
    else semDia.push(l);
  }

  const daLista = (doDia, competencia) => linhaDoMes({ competencia, linhas: doDia });
  const linhaSemDia = semDia.length ? { ...daLista(semDia, mes?.competencia), dia: null } : null;
  const dias = [...porDia.entries()].map(([dia, doDia]) => ({ ...daLista(doDia, mes?.competencia), dia }));

  return {
    // ⚠ Vem PRIMEIRO na tela: é a maioria do dinheiro, e escondê-la faria o mês parecer menor.
    semDia: linhaSemDia,
    dias: acumularResultado(linhaSemDia, dias),
  };
}

/**
 * ⚠⚠ O RESULTADO DA LINHA DO DIA É ACUMULADO DENTRO DO MÊS (30/08/2026) — decisão do dono:
 *
 * > *"o resultado deve repetir a entrada em todas as linhas, e diminuir nas linhas da saída, e
 * > assim ficar até o último dia mostrando o resultado do mês."*
 *
 * Até aqui cada dia mostrava o resultado DAQUELE DIA — e o dia 02 de um mês com entrada no dia 01
 * aparecia vazio, como se não houvesse dinheiro. O que o dono quer ler é *"quanto sobra hoje"*, e a
 * última linha passa a ser o resultado do mês.
 *
 * ⚠⚠ **ISTO NÃO É O "SALDO ACUMULADO" QUE A LEI 3 PROÍBE, e a diferença é o que sustenta a
 * decisão.** A Lei 3 fala de saldo que ATRAVESSA MESES: *"sem âncora de conciliação não há
 * acumulado"* — sem saldo inicial, um número que se arrasta desde janeiro afirma um caixa que
 * ninguém conferiu. Aqui o acumulado **nasce em zero no dia 1 e morre no último dia do mês**: ele é
 * a soma das linhas que a própria tabela mostra, e não afirma nada sobre o dinheiro que havia antes.
 * ⚠ Cada mês recomeça — não há transporte de um bloco para o outro.
 *
 * ⚠⚠ **A LINHA "no mês" ENTRA NO ACUMULADO, e ela vem primeiro.** É lá que moram a folha e o
 * imposto previsto sem dia; deixá-los de fora faria o resultado do último dia discordar do
 * resultado do mês — que é justamente o número que o dono quer ler ali.
 *
 * ⚠⚠ **O STATUS É O DO ELO MAIS FRACO, acumulado junto.** Um resultado que soma um fato com uma
 * previsão **não é um fato**: bastou uma parcela prevista para a linha inteira ser prevista, e isso
 * vale para todas as linhas seguintes — o acumulado carrega a incerteza para a frente.
 *
 * ⚠ Dia sem lançamento nenhum **continua mostrando o acumulado**, e é o pedido (*"repetir em todas
 * as linhas"*). O que não existe ali é lançamento, não é dinheiro.
 */
function acumularResultado(linhaSemDia, dias) {
  let acumulado = null;
  const somar = (atual, celula) => {
    if (!celula) return atual;
    const valor = (atual?.valor || 0) + (Number(celula.valor) || 0);
    // ⚠ Uma vez PREVISTO, segue previsto: a incerteza não se desfaz nas linhas seguintes.
    const status = atual?.status === STATUS.PREVISTO || celula.status === STATUS.PREVISTO
      ? STATUS.PREVISTO
      : STATUS.CONFIRMADO;
    return { valor, status };
  };

  acumulado = somar(acumulado, linhaSemDia?.resultado);
  return dias.map((d) => {
    acumulado = somar(acumulado, d.resultado);
    // ⚠ Antes do primeiro lançamento do mês o acumulado é `null`, e a célula continua sendo o
    // TRAÇO — nunca `R$ 0,00`. Zero é uma afirmação ("conferi, é zero"), e aqui ainda não há o que
    // conferir.
    return { ...d, resultado: acumulado ? { ...acumulado } : null };
  });
}

/**
 * ⚠⚠ A JANELA DE 10 DIAS EM TORNO DE HOJE (30/08/2026) — decisão do dono:
 *
 * > *"a tabela do fluxo deve mostrar apenas os 10 dias, para que sempre seja visto o dia em que
 * > estamos: 5 para trás e 4 para frente."*
 *
 * ⚠⚠ **ISTO REVISA O "30 DIAS À ESQUERDA E 30 À DIREITA" DO v4** (29/08). O mês inteiro empurrava o
 * dia de hoje para fora da dobra: numa tabela de 31 linhas, o dia 27 só aparece rolando. O que ele
 * quer ver ao abrir é ONDE ESTÁ HOJE.
 *
 * ⚠⚠ **A CONTA É FEITA SOBRE O MÊS INTEIRO E SÓ DEPOIS A JANELA CORTA.** Se o acumulado começasse
 * no primeiro dia VISÍVEL, o Resultado da primeira linha ignoraria tudo que veio antes no mês — e o
 * número seria falso justamente na linha que abre a tela. Por isso `linhasDosDias` continua
 * devolvendo o mês inteiro e o corte acontece aqui.
 *
 * ⚠ **Nas bordas do mês a janela ANDA, não encolhe:** dia 2 mostra do 1 ao 10, dia 30 mostra do 22
 * ao 31. Encolher daria três linhas no começo do mês, que é quando ele mais precisa de contexto.
 * ⚠ **Mês que não é o de hoje não tem "hoje"**: a janela começa no dia 1. Escolher um dia ali seria
 * o sistema apontando para uma data que não significa nada naquele mês.
 */
export const DIAS_ANTES = 5;
export const DIAS_DEPOIS = 4;

export function janelaDeDias(dias, { diaDeHoje = null, antes = DIAS_ANTES, depois = DIAS_DEPOIS } = {}) {
  const lista = Array.isArray(dias) ? dias : [];
  const tamanho = antes + depois + 1;
  if (lista.length <= tamanho) return lista;

  const hoje = Number(diaDeHoje);
  // ⚠ Sem hoje (outro mês), começa no dia 1 — nunca no meio.
  if (!Number.isInteger(hoje)) return lista.slice(0, tamanho);

  const i = lista.findIndex((d) => d.dia === hoje);
  if (i < 0) return lista.slice(0, tamanho);

  // ⚠ A janela ANDA para caber: `Math.min` no fim e `Math.max` no começo, nesta ordem — invertido,
  // o começo do mês devolveria índice negativo e o `slice` cortaria pelo fim.
  const inicio = Math.max(0, Math.min(i - antes, lista.length - tamanho));
  return lista.slice(inicio, inicio + tamanho);
}

/**
 * O valor de uma célula no modo `%` — `SPEC` §3.6.
 *
 * ⚠ Só Saída, Impostos e Folha viram percentual; Entrada e Resultado seguem em R$ (regra fechada com
 * o produto). ⚠ **Entrada zero devolve `null`**, nunca `0%` nem `Infinity`: dividir por zero não
 * produz uma proporção, produz uma mentira.
 */
export function emPercentual(celula, entrada) {
  const base = Number(entrada?.valor);
  if (!celula || !Number.isFinite(base) || base <= 0) return null;
  return (celula.valor / base) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A FORMA v4 — DOIS MESES LADO A LADO, EM DIAS; E O "HORIZONTE" TRANSPOSTO (29/08/2026)
//
// > Dono, com a tela na frente: *"ao invés de mostrar o mês ele vai mostrar os dias mesmo, sendo
// > assim ele vai colocar dois meses de uma vez quando a tela permitir, ou seja 30 dias à esquerda
// > sendo o mês corrente e 30 dias à direita sendo o mês seguinte. Setas cabeçalho para andar para
// > frente e para trás entre os meses, botão para ver o horizonte e aí mudamos a tabela para mês, e
// > mantemos lateralizado, ou seja, coluna com entrada, saída, impostos, folha e resultado e logo
// > abaixo o mês a que se refere. Um mês ao lado do outro."*
//
// ⚠⚠ **ISTO INVERTE O v3, e a inversão é decisão de produto, não defeito.** Lá o estado inicial era
// a tabela de MESES e os dias eram um mergulho (§3.7); aqui os DIAS são o estado inicial e os meses
// viraram o "horizonte", atrás de um botão. O que NÃO mudou: as cinco categorias, o status por
// célula e a regra de que dia ausente nunca vira dia inventado.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** ⚠ Dois, e o número tem nome: a tela empilha em vez de encolher (ver `app.css`). */
export const MESES_LADO_A_LADO = 2;

/**
 * OS DOIS BLOCOS que a visão de dias mostra, a partir do mês da ESQUERDA.
 *
 * ⚠⚠ **O MÊS QUE FALTA VOLTA NOMEADO, nunca como bloco vazio.** O payload traz uma janela de 12
 * meses; andando até a borda dela, o mês da direita pode não ter chegado ainda. Desenhar um bloco
 * com todos os dias em traço afirmaria *"este mês não tem nada"* — quando o certo é *"este mês não
 * está nesta consulta"*. São coisas diferentes e a tela precisa poder distingui-las.
 *
 * @param {Array} meses os meses do payload
 * @param {string} esquerda competência do bloco da esquerda
 */
export function parDeMeses(meses, esquerda) {
  const lista = Array.isArray(meses) ? meses : [];
  const competencias = [];
  for (let i = 0; i < MESES_LADO_A_LADO; i += 1) {
    const c = i === 0 ? esquerda : somarCompetencia(esquerda, i);
    if (c) competencias.push(c);
  }
  return competencias.map((competencia) => ({
    competencia,
    mes: lista.find((m) => m?.competencia === competencia) || null,
  }));
}

/**
 * ⚠⚠ ATÉ ONDE AS SETAS ANDAM — e a resposta tem DUAS fontes, que não podem ser confundidas.
 *
 *  1. **dentro da janela carregada** o passo é de graça: os 12 meses já vieram na mesma consulta;
 *  2. **na borda dela** quem decide é o SERVIDOR (`janela.podeVoltar` / `podeAvancar`), que conhece
 *     o piso (corrente−4) e o horizonte. A tela não recalcula esses limites — ela já os recebe.
 *
 * ⚠ Ler só a lista faria a seta morrer na borda de uma janela que o servidor moveria de bom grado;
 * ler só os flags faria cada passo pedir uma consulta nova. As duas coisas juntas é o que dá um
 * passo barato dentro da janela e honesto fora dela.
 */
export function navegacaoDoPar({ meses, esquerda, janela } = {}) {
  const lista = Array.isArray(meses) ? meses : [];
  const idx = lista.findIndex((m) => m?.competencia === esquerda);
  const temAnterior = idx > 0;
  // ⚠ `+ MESES_LADO_A_LADO` e não `+ 1`: avançar só compensa se o par INTEIRO couber, senão a seta
  // levaria a um bloco da direita nomeado como ausente — um passo que piora a tela.
  const temSeguinte = idx >= 0 && idx + MESES_LADO_A_LADO < lista.length;
  return {
    podeVoltar: temAnterior || Boolean(janela?.podeVoltar),
    podeAvancar: temSeguinte || Boolean(janela?.podeAvancar),
    /** ⚠ A tela usa isto para saber se o passo exige ir ao servidor — e mostrar que está indo. */
    precisaDeConsultaParaVoltar: !temAnterior,
    precisaDeConsultaParaAvancar: !temSeguinte,
  };
}

/**
 * ⚠⚠ O HORIZONTE — a MESMA grade, transposta: categoria em LINHA, mês em COLUNA.
 *
 * > *"coluna com entrada, saída, impostos, folha e resultado e logo abaixo o mês a que se refere"*
 *
 * ⚠ O rótulo do mês vai EMBAIXO, e na tela ele é `<th scope="col">` dentro de um `<tfoot>` — nunca
 * um `<td>` solto. Uma tabela transposta continua sendo tabela para quem usa leitor de tela, e sem
 * o `scope` cada número perde o nome da coluna a que pertence.
 *
 * ⚠ Nada aqui é uma agregação NOVA: cada coluna é o `linhaDoMes` que a visão de mês já usava. Uma
 * segunda soma divergiria da primeira na primeira correção.
 */
export function gradeTransposta(meses, { comFolha = true } = {}) {
  const lista = (Array.isArray(meses) ? meses : []).filter((m) => m && m.competencia);
  const colunas = lista.map((m) => ({ competencia: m.competencia, linha: linhaDoMes(m) }));
  const categorias = COLUNAS.filter((c) => comFolha || c.chave !== "folha");
  return {
    competencias: colunas.map((c) => c.competencia),
    /** ⚠ A entrada de CADA coluna viaja junto: é a base do modo `%`, e ela é por mês. */
    entradas: colunas.map((c) => c.linha.entrada),
    linhas: categorias.map((cat) => ({
      chave: cat.chave,
      rotulo: cat.rotulo,
      celulas: colunas.map((c) => c.linha[cat.chave]),
    })),
  };
}
