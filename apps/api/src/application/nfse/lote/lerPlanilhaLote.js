// A LEITURA DA PLANILHA — do arquivo às linhas. **Não escreve nada.**
//
// ⚠⚠ **NADA AQUI EMITE, CONSULTA OU GRAVA.** Nem tomador, nem nota. Esta função abre o arquivo,
// reconhece as colunas e devolve as células. Quem classifica é `classificarLinhaLote.js`; quem
// consulta é o front; quem emite é fase seguinte e não é isto.
//
// ⚠ **PLANILHA DE FORMATO DESCONHECIDO NÃO É ACEITA EM SILÊNCIO.** Cabeçalho que não se reconhece
// vira recusa NOMEADA, dizendo exatamente qual coluna obrigatória não foi encontrada e quais
// cabeçalhos vieram no arquivo — e não uma leitura pela metade que produz 200 linhas pendentes sem
// ninguém entender por quê.
//
// ⚠⚠ **NÃO HÁ CASAMENTO POR POSIÇÃO.** `excelImport.js` (extrato bancário) tem um fallback
// "posição 0,1,2", e lá o pior caso é um lançamento contábil para conferir. Aqui trocar a coluna 1
// pela 2 emitiria a nota com o nome no lugar do CNPJ. Ver o comentário de `chaveDaColuna`.
//
// ⚠ **UMA PLANILHA = UMA EMPRESA EMITENTE** (confirmado pelo dono, 19/08/2026): o cliente escolhe a
// empresa antes de entrar, e **não há coluna de CNPJ do emitente**. Cada LINHA é uma nota, com
// tomadores diferentes entre linhas.

import * as XLSX from "xlsx";
import { COLUNAS_LOTE, COLUNAS_OBRIGATORIAS, LINHA_DE_EXEMPLO, chaveDaColuna } from "./colunasLote.js";
import { lerDocumentoDaPlanilha, lerValorDaPlanilha, lerCompetenciaDaPlanilha } from "./celulasLote.js";

export const RECUSA_PLANILHA = Object.freeze({
  ARQUIVO_ILEGIVEL: "planilha_ilegivel",
  SEM_ABA: "planilha_sem_aba",
  SEM_CABECALHO: "planilha_sem_cabecalho",
  COLUNAS_FALTANDO: "planilha_colunas_faltando",
  SEM_LINHAS: "planilha_sem_linhas",
  LINHAS_DEMAIS: "planilha_linhas_demais",
});

/**
 * Teto de linhas. O mesmo do import contábil (`excelImport.js`), pelo mesmo motivo: arquivo com
 * dezenas de milhares de linhas é engano (planilha errada, aba errada), não um lote grande.
 */
export const MAX_LINHAS = 5000;

/** Quantas linhas varrer atrás do cabeçalho antes de desistir. */
const MAX_LINHAS_ATE_O_CABECALHO = 10;

function recusar(codigo, mensagem, extra = {}) {
  return { ok: false, codigo, mensagem, ...extra };
}

/**
 * Acha a linha de cabeçalho e o mapa coluna→índice.
 *
 * ⚠ Varre as primeiras linhas em vez de exigir a primeira: o modelo que geramos tem o cabeçalho na
 * linha 1, mas planilha que voltou editada costuma ganhar título, logo ou linha em branco em cima.
 * O critério é objetivo — a linha que reconhece MAIS colunas, e pelo menos duas.
 */
function acharCabecalho(matriz) {
  let melhor = null;
  const limite = Math.min(matriz.length, MAX_LINHAS_ATE_O_CABECALHO);
  for (let i = 0; i < limite; i += 1) {
    const celulas = matriz[i] || [];
    const mapa = {};
    for (let c = 0; c < celulas.length; c += 1) {
      const chave = chaveDaColuna(celulas[c]);
      // ⚠ A PRIMEIRA ocorrência vence. Coluna duplicada (alguém copiou o cabeçalho) não pode fazer
      // a segunda, provavelmente vazia, apagar a primeira.
      if (chave && mapa[chave] === undefined) mapa[chave] = c;
    }
    const quantas = Object.keys(mapa).length;
    if (quantas >= 2 && (!melhor || quantas > melhor.quantas)) {
      melhor = { linha: i, mapa, quantas, cabecalhos: celulas.map((x) => String(x ?? "").trim()) };
    }
  }
  return melhor;
}

/**
 * O valor de uma célula reduzido à sua forma CANÔNICA, para comparar exemplo com linha.
 *
 * ⚠⚠ **POR QUE NÃO É MAIS COMPARAÇÃO DE TEXTO** (mudou em 21/08/2026, junto com a tabela tipada).
 * O modelo passou a nascer com **colunas tipadas**: o valor é uma célula numérica e a competência é
 * um serial de data. A mesma linha de exemplo que antes voltava como `"1500,00"` e `"31/07/2026"`
 * agora volta como `1500` e uma `Date` — e a igualdade de texto **falharia**.
 *
 * ⚠⚠ Falhar aqui não é um detalhe cosmético: a linha de exemplo deixaria de ser descartada e o
 * cliente que não a apagasse mandaria **uma nota fiscal para o CPF do exemplo** — o pior desfecho
 * possível de um modelo, e exatamente o que este descarte existe para impedir.
 *
 * ⚠ A canônica é a do próprio domínio (os mesmos leitores de `celulasLote.js` que classificam a
 * linha depois), então as DUAS formas — a planilha antiga, de texto, e a nova, tipada — reduzem ao
 * mesmo valor. **Uma planilha do formato antigo continua tendo o exemplo reconhecido e descartado.**
 *
 * ⚠ Célula que não se lê vira um sentinela que carrega o texto cru. Ela nunca vai bater com o
 * exemplo (que se lê), e o efeito é o lado seguro do erro: a linha ENTRA e vira pendência — uma
 * pendência a mais, nunca uma nota a mais.
 */
function canonizar(chave, bruto) {
  const cru = `!${String(bruto ?? "").trim()}`;
  if (chave === "documento") {
    const lido = lerDocumentoDaPlanilha(bruto);
    return lido.ok ? `d:${lido.documento}` : cru;
  }
  if (chave === "valor") {
    const lido = lerValorDaPlanilha(bruto);
    return lido.ok ? `v:${lido.valor.toFixed(2)}` : cru;
  }
  if (chave === "competencia") {
    const lido = lerCompetenciaDaPlanilha(bruto);
    return lido.ok ? `c:${lido.competencia.toISOString()}` : cru;
  }
  return `t:${String(bruto ?? "").trim()}`;
}

/**
 * A forma canônica da linha de exemplo, calculada uma vez.
 *
 * ⚠ Sai de `LINHA_DE_EXEMPLO`, que continua sendo a fonte única — o modelo escreve a partir dela e
 * a leitura compara contra ela. Se alguém mudar o exemplo, os dois lados mudam juntos.
 */
const EXEMPLO_CANONICO = COLUNAS_LOTE.map((coluna) => canonizar(coluna.chave, LINHA_DE_EXEMPLO[coluna.chave]));

/**
 * A linha é a de exemplo do modelo, sem nenhuma edição?
 *
 * ⚠ Compara TODAS as colunas da lista fechada. Um campo diferente já basta para a linha ser dado de
 * verdade — editou qualquer célula, é nota e é lida como tal. O descarte nunca adivinha.
 */
function ehALinhaDeExemplo(valores) {
  return COLUNAS_LOTE.every(
    (coluna, i) => canonizar(coluna.chave, valores[coluna.chave]) === EXEMPLO_CANONICO[i]
  );
}

/**
 * Lê o arquivo.
 *
 * @param {Buffer} buffer o .xlsx (ou .xls/.csv que o SheetJS entenda)
 * @returns {{ok: true, linhas: Array, aba: string, colunasReconhecidas: string[],
 *            colunasIgnoradas: string[]}
 *          | {ok: false, codigo: string, mensagem: string}}
 */
export function lerPlanilhaLote(buffer) {
  let workbook;
  try {
    // ⚠ `cellDates: true` — a coluna de competência é uma data, e sem isto ela chega como serial
    // numérico do Excel. `lerCompetenciaDaPlanilha` trata os dois casos, mas a `Date` é a leitura
    // que descreve o que a pessoa viu na célula.
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    return recusar(
      RECUSA_PLANILHA.ARQUIVO_ILEGIVEL,
      "Não conseguimos abrir este arquivo como planilha. Baixe o modelo, preencha e envie de volta "
        + `no formato .xlsx. (${err?.message || "erro ao ler o arquivo"})`
    );
  }

  const nomeAba = workbook.SheetNames?.[0];
  if (!nomeAba) {
    return recusar(RECUSA_PLANILHA.SEM_ABA, "A planilha não tem nenhuma aba com conteúdo.");
  }

  // ⚠ `defval: ""` para a linha não encolher quando a última célula está vazia — sem isso o índice
  // de uma coluna à direita cairia fora do array e o campo sumiria em silêncio.
  // ⚠ `raw: true` (o padrão) MANTÉM número como número e data como `Date`: é isso que permite
  // `lerValorDaPlanilha` distinguir "o Excel já converteu" de "o texto chegou intacto", que é a
  // decisão inteira do valor ambíguo.
  // ⚠⚠ `blankrows: true` É OBRIGATÓRIO AQUI, e não é o default por acaso ser esse. Com
  // `blankrows: false` o SheetJS **remove** as linhas vazias do array, e o índice deixa de
  // corresponder à linha do Excel: uma planilha com uma linha em branco no meio faria a tela dizer
  // "corrija a linha 37" apontando para a 38 na planilha da pessoa. Quem pula linha vazia é o laço
  // abaixo, depois de já ter o número certo.
  const matriz = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], { header: 1, defval: "", blankrows: true });

  const cabecalho = acharCabecalho(matriz);
  if (!cabecalho) {
    return recusar(
      RECUSA_PLANILHA.SEM_CABECALHO,
      "Não reconhecemos o cabeçalho desta planilha — nenhuma das colunas esperadas foi encontrada "
        + "nas primeiras linhas. Use o modelo que geramos: baixe, preencha e envie de volta sem "
        + "renomear as colunas."
    );
  }

  const faltando = COLUNAS_OBRIGATORIAS.filter((chave) => cabecalho.mapa[chave] === undefined);
  if (faltando.length) {
    const rotulos = faltando.map((chave) => COLUNAS_LOTE.find((c) => c.chave === chave)?.rotulo || chave);
    return recusar(
      RECUSA_PLANILHA.COLUNAS_FALTANDO,
      `Faltam colunas obrigatórias nesta planilha: ${rotulos.join(", ")}. `
        + `Cabeçalho encontrado: ${cabecalho.cabecalhos.filter(Boolean).join(" | ") || "(vazio)"}.`,
      { faltando, cabecalhoEncontrado: cabecalho.cabecalhos }
    );
  }

  const linhas = [];
  const exemploDescartado = [];
  for (let i = cabecalho.linha + 1; i < matriz.length; i += 1) {
    const celulas = matriz[i] || [];
    const valores = {};
    for (const [chave, indice] of Object.entries(cabecalho.mapa)) {
      const bruto = celulas[indice];
      valores[chave] = bruto === undefined ? "" : bruto;
    }
    // ⚠ LINHA TOTALMENTE VAZIA É PULADA, NÃO É PENDÊNCIA. O modelo nasce com centenas de células
    // pré-formatadas como texto (é o que impede o Excel de comer o zero do CPF), e elas voltam como
    // string vazia: contá-las produziria centenas de pendências fantasma. Linha com QUALQUER
    // conteúdo entra e é classificada — inclusive a que só tem o valor preenchido.
    const temAlgo = Object.values(valores).some((x) => String(x ?? "").trim() !== "");
    if (!temAlgo) continue;

    // ⚠⚠ A LINHA DE EXEMPLO DO MODELO, VOLTANDO INTACTA, É DESCARTADA — e isso não é cortesia.
    // Ela é uma nota completa e bem formada: o cliente que esquecer de apagá-la mandaria uma nota
    // para "TOMADOR EXEMPLO LTDA" que, na fase de emissão, sairia como documento fiscal de verdade.
    // ⚠ A igualdade é EXATA, célula a célula, contra a lista fechada de colunas. Editou qualquer
    // campo, é dado de verdade e é lido como tal — o descarte nunca adivinha.
    if (ehALinhaDeExemplo(valores)) {
      exemploDescartado.push(i + 1);
      continue;
    }

    if (linhas.length >= MAX_LINHAS) {
      return recusar(
        RECUSA_PLANILHA.LINHAS_DEMAIS,
        `Esta planilha tem mais de ${MAX_LINHAS} linhas preenchidas. Divida em arquivos menores — `
          + "um lote desse tamanho normalmente é planilha ou aba errada."
      );
    }

    linhas.push({
      // ⚠ O NÚMERO DA LINHA É O DO EXCEL (1-based, contando o cabeçalho), não o índice do array.
      // É por ele que a tela de ajuste diz "linha 37" e a pessoa acha a linha na planilha dela.
      numero: i + 1,
      valores,
    });
  }

  if (!linhas.length) {
    return recusar(
      RECUSA_PLANILHA.SEM_LINHAS,
      exemploDescartado.length
        ? "A planilha só tem a linha de exemplo do modelo, que não é enviada como nota. Substitua-a "
          + "pelas suas notas."
        : "A planilha foi reconhecida, mas não há nenhuma linha preenchida abaixo do cabeçalho."
    );
  }

  const reconhecidas = Object.keys(cabecalho.mapa);
  return {
    ok: true,
    aba: nomeAba,
    linhaDoCabecalho: cabecalho.linha + 1,
    linhas,
    /** Números das linhas do Excel em que a linha de exemplo do modelo voltou intacta e foi descartada. */
    exemploDescartado,
    colunasReconhecidas: reconhecidas,
    /**
     * Colunas do arquivo que não reconhecemos. ⚠ Elas **não** recusam a planilha — alguém pode ter
     * uma coluna de controle interno —, mas voltam nomeadas: coluna que a pessoa acha que estamos
     * lendo e que ignoramos em silêncio é a forma de o dado sumir sem aviso.
     */
    colunasIgnoradas: cabecalho.cabecalhos.filter(
      (texto, indice) => texto && !Object.values(cabecalho.mapa).includes(indice)
    ),
  };
}
