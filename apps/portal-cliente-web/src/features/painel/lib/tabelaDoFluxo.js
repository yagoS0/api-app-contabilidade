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

import { DIRECAO, FONTE, PROCEDENCIA } from "./leituraDoFluxo";

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
  return {
    // ⚠ Vem PRIMEIRO na tela: é a maioria do dinheiro, e escondê-la faria o mês parecer menor.
    semDia: semDia.length ? { ...daLista(semDia, mes?.competencia), dia: null } : null,
    dias: [...porDia.entries()].map(([dia, doDia]) => ({ ...daLista(doDia, mes?.competencia), dia })),
  };
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
