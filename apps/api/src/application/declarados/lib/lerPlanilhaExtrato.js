// A LEITURA DE UM EXTRATO EM EXCEL — do arquivo às linhas cruas. **Não escreve nada.**
//
// ⚠⚠ ESTE MÓDULO NÃO SABE O QUE É DESPESA. Ele abre o arquivo, acha a linha de cabeçalho e devolve
// as células. Quem diz qual coluna é a data é `mapeamentoDoExtrato.js`, e quem grava é
// `ImportExcelExtratoService.js`. Um módulo que fizesse os três seria o lugar onde a regra de sinal
// vira `if` dentro de laço de leitura.
//
// ⚠ O MOLDE É `nfse/lote/lerPlanilhaLote.js`, e as decisões de lá valem inteiras aqui: `cellDates`,
// `header: 1`, `defval: ""`, `blankrows: true`, teto de linhas e **recusa NOMEADA**. O que muda é a
// pergunta do cabeçalho — ver abaixo.

import * as XLSX from "xlsx";
import { normalizarCabecalho, proporMapeamento } from "./mapeamentoDoExtrato.js";

export const RECUSA_EXTRATO = Object.freeze({
  ARQUIVO_ILEGIVEL: "extrato_ilegivel",
  SEM_ABA: "extrato_sem_aba",
  SEM_CABECALHO: "extrato_sem_cabecalho",
  SEM_LINHAS: "extrato_sem_linhas",
  LINHAS_DEMAIS: "extrato_linhas_demais",
});

/**
 * Teto de linhas. ⚠ O MESMO de `lerPlanilhaLote` e do import contábil, pelo mesmo motivo: arquivo
 * com dezenas de milhares de linhas é engano (planilha errada, aba errada), não um extrato grande.
 * ⚠ E aqui ele é guarda de RECURSO também — quem sobe é o piso mais baixo do sistema, e a gravação
 * é sequencial: é o argumento medido do `MAXIMO_DE_TRANSACOES` do OFX.
 */
export const MAX_LINHAS = 5000;

/** Quantas linhas varrer atrás do cabeçalho antes de desistir. */
const MAX_LINHAS_ATE_O_CABECALHO = 15;

/** Quantas células não vazias uma linha precisa ter para poder ser cabeçalho no palpite fraco. */
const MINIMO_DE_CELULAS = 2;

export const CERTEZA_DO_CABECALHO = Object.freeze({
  /** Reconhecemos ao menos um papel pelos apelidos. */
  APELIDOS: "apelidos",
  /**
   * ⚠⚠ Nenhum apelido casou — o cabeçalho é a primeira linha com texto suficiente, e isso é PALPITE.
   * A tela precisa dizer isso: um palpite errado desloca TODAS as colunas, e o contador confirmaria
   * um mapeamento sobre a linha errada.
   */
  HEURISTICA: "heuristica",
});

const recusar = (codigo, mensagem, extra = {}) => ({ ok: false, codigo, mensagem, ...extra });

const naoVazia = (x) => String(x ?? "").trim() !== "";

/**
 * Acha a linha de cabeçalho.
 *
 * ⚠⚠ A PERGUNTA AQUI É OUTRA, e é a diferença para `lerPlanilhaLote`. Lá o cabeçalho é NOSSO (o
 * modelo que geramos) e uma coluna que não se reconhece é erro do preenchimento. Aqui o cabeçalho é
 * do BANCO: ele pode chamar a coluna de "Lançamento", "Movimentação" ou qualquer coisa, e não
 * reconhecer nada **não é motivo para recusar o arquivo** — é exatamente o caso em que o contador
 * mapeia à mão, que é a razão desta fase existir.
 *
 * Por isso são dois critérios, nesta ordem, e o segundo se declara palpite.
 */
export function acharCabecalhoDoExtrato(matriz) {
  let porApelidos = null;
  let porHeuristica = null;
  const limite = Math.min(matriz.length, MAX_LINHAS_ATE_O_CABECALHO);

  for (let i = 0; i < limite; i += 1) {
    const celulas = (matriz[i] || []).map((x) => String(x ?? "").trim());
    const cheias = celulas.filter(naoVazia).length;
    if (cheias < MINIMO_DE_CELULAS) continue;

    // ⚠ Uma célula de cabeçalho é TEXTO. Linha cujo conteúdo já é dado (datas, números) não é
    // cabeçalho — sem isto, um extrato sem cabeçalho nenhum elegeria a primeira transação.
    const textuais = celulas.filter((c) => naoVazia(c) && Boolean(normalizarCabecalho(c))).length;
    if (textuais < MINIMO_DE_CELULAS) continue;

    const proposta = proporMapeamento(celulas);
    const reconhecidas = Object.values(proposta.colunas).filter((v) => v !== null).length;

    if (reconhecidas >= 1 && (!porApelidos || reconhecidas > porApelidos.reconhecidas)) {
      porApelidos = { linha: i, cabecalhos: celulas, reconhecidas, certeza: CERTEZA_DO_CABECALHO.APELIDOS };
    }
    if (!porHeuristica) {
      porHeuristica = { linha: i, cabecalhos: celulas, reconhecidas: 0, certeza: CERTEZA_DO_CABECALHO.HEURISTICA };
    }
  }

  return porApelidos || porHeuristica;
}

/**
 * Lê o arquivo.
 *
 * @param {Buffer} buffer o .xlsx (ou .xls/.csv que o SheetJS entenda)
 * @param {string} [nomeAbaPedida] ⚠ a aba escolhida pelo contador; ausente, a primeira
 */
export function lerPlanilhaExtrato(buffer, nomeAbaPedida = null) {
  if (!buffer?.length) {
    return recusar(RECUSA_EXTRATO.ARQUIVO_ILEGIVEL, "O arquivo enviado está vazio.");
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    return recusar(
      RECUSA_EXTRATO.ARQUIVO_ILEGIVEL,
      "Não conseguimos abrir este arquivo como planilha. Envie o extrato no formato .xlsx que o "
        + `banco disponibiliza. (${err?.message || "erro ao ler o arquivo"})`
    );
  }

  const abas = workbook.SheetNames || [];
  if (!abas.length) return recusar(RECUSA_EXTRATO.SEM_ABA, "A planilha não tem nenhuma aba com conteúdo.");

  // ⚠ Aba PEDIDA vence, e aba pedida que não existe é RECUSA nomeada — cair na primeira em silêncio
  // leria outro extrato com o mapeamento deste.
  const nomeAba = nomeAbaPedida ? abas.find((a) => a === nomeAbaPedida) : abas[0];
  if (!nomeAba) {
    return recusar(
      RECUSA_EXTRATO.SEM_ABA,
      `Esta planilha não tem a aba "${nomeAbaPedida}". Abas disponíveis: ${abas.join(", ")}.`,
      { abas }
    );
  }

  const matriz = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], {
    header: 1,
    defval: "",
    blankrows: true,
  });

  const cabecalho = acharCabecalhoDoExtrato(matriz);
  if (!cabecalho) {
    return recusar(
      RECUSA_EXTRATO.SEM_CABECALHO,
      "Não achamos uma linha de cabeçalho nesta planilha — as primeiras linhas não têm nomes de "
        + "coluna. Envie o extrato como o banco o exporta, sem apagar o cabeçalho.",
      { abas, aba: nomeAba }
    );
  }

  const linhas = [];
  for (let i = cabecalho.linha + 1; i < matriz.length; i += 1) {
    const celulas = matriz[i] || [];
    // ⚠ Linha totalmente vazia é PULADA, não é pendência — mesma decisão do lote: planilha de banco
    // vem com separadores e rodapé em branco, e contá-los produziria pendência fantasma.
    if (!celulas.some(naoVazia)) continue;

    if (linhas.length >= MAX_LINHAS) {
      return recusar(
        RECUSA_EXTRATO.LINHAS_DEMAIS,
        `Este extrato tem mais de ${MAX_LINHAS} linhas preenchidas. Divida o período e envie em `
          + "partes — um arquivo desse tamanho normalmente é planilha ou aba errada.",
        { abas, aba: nomeAba }
      );
    }

    // ⚠ O NÚMERO É O DA LINHA DO EXCEL (1-based), não o índice do array: é por ele que a tela diz
    // "linha 37" e a pessoa acha a linha na planilha dela. Os dois divergem na primeira linha em
    // branco, e é o mesmo cuidado que o lote registra.
    linhas.push({ numero: i + 1, celulas });
  }

  if (!linhas.length) {
    return recusar(
      RECUSA_EXTRATO.SEM_LINHAS,
      "Achamos o cabeçalho, mas nenhuma linha de lançamento abaixo dele.",
      { abas, aba: nomeAba, cabecalhos: cabecalho.cabecalhos }
    );
  }

  return {
    ok: true,
    abas,
    aba: nomeAba,
    cabecalhos: cabecalho.cabecalhos,
    linhaDoCabecalho: cabecalho.linha + 1,
    certezaDoCabecalho: cabecalho.certeza,
    linhas,
  };
}
