// O AJUSTE DA LINHA FEITO NA TELA — sobreposição PURA sobre as células que vieram da planilha.
//
// ⚠⚠ **NADA AQUI EMITE, CONSULTA, GRAVA OU CLASSIFICA.** Esta função troca células e devolve as
// linhas. Quem decide o que a linha É continua sendo `classificarLinhaLote.js`, que roda depois e
// não sabe que houve ajuste — é essa ordem que mantém a regra num lugar só.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────────
//
// > Dono (19/08/2026): *"se a API não retornar nós avisamos isso em uma tela para ajuste daquela
// > nota; ajustando, ele passa por todas as notas para conferir."*
//
// O ajuste acontece NA TELA, e a tela não pode reclassificar sozinha: a regra é do backend. As
// alternativas foram medidas e recusadas em 19/08/2026:
//   • reimplementar a classificação no front — duas regras que divergem na primeira correção;
//   • remontar o .xlsx no navegador — poria o SheetJS no bundle do portal do cliente, que hoje não
//     tem **nenhuma** dependência fora do React.
// Sobrou o caminho que mantém tudo onde já está: o front reenvia o MESMO arquivo e diz, em dado, o
// que a pessoa digitou por cima.
//
// ─── AS TRÊS TRAVAS ─────────────────────────────────────────────────────────────────────────────
//
// ⚠⚠ **A CHAVE DA CÉLULA VEM DA LISTA FECHADA `CAMPOS_DA_REVISAO`, E DESCONHECIDA É RECUSA
// NOMEADA.** Ignorar em silêncio uma chave que não existe faria um erro de digitação do front virar
// dado que SOME: a pessoa corrige o CEP, a tela diz que enviou, o servidor descarta, e a linha volta
// pendente pelo mesmo motivo de antes. Ninguém acharia isso olhando a tela.
//
// ⚠⚠ **A LISTA DO AJUSTE É MAIOR QUE A DA PLANILHA, DESDE 20/08/2026 — e essa diferença é o
// coração da entrega.** A planilha tem QUATRO colunas (documento, descrição, valor, competência);
// o ajuste aceita ONZE das doze células, porque nome, e-mail e o bloco de endereço saíram da
// planilha e passaram a ser pedidos **aqui**, só quando fazem falta. Validar o ajuste contra
// `COLUNAS_LOTE` faria a revisão recusar exatamente os campos que ela existe para preencher.
//
// ⚠⚠ **O NÚMERO DA LINHA É O DO EXCEL** (1-based, contando o cabeçalho) — o mesmo que
// `lerPlanilhaLote` grava em `linha.numero` e o mesmo que a tela mostra ("linha 37"). Índice de
// array **não serve**: os dois divergem no primeiro cabeçalho fora da linha 1 ou na primeira linha
// em branco, e o ajuste iria para a NOTA ERRADA — uma nota fiscal com o endereço de outra.
// Número que não existe na planilha lida também é recusa nomeada, pelo mesmo motivo da chave.
//
// ⚠ **O AJUSTE NÃO PERSISTE, E A TELA TEM DE DIZER ISSO.** Ele vive na sessão da tela; a planilha
// no disco da pessoa continua dizendo o valor antigo. Por isso a rota devolve quais linhas foram
// ajustadas — sem isso, subir o mesmo arquivo amanhã perderia as correções em silêncio.

import { CHAVES_DA_REVISAO } from "./colunasLote.js";

export const RECUSA_AJUSTE = Object.freeze({
  FORMA_INVALIDA: "ajuste_forma_invalida",
  LINHA_DESCONHECIDA: "ajuste_linha_desconhecida",
  COLUNA_DESCONHECIDA: "ajuste_coluna_desconhecida",
});

const CHAVES_VALIDAS = new Set(CHAVES_DA_REVISAO);

function recusar(codigo, mensagem, extra = {}) {
  return { ok: false, codigo, mensagem, ...extra };
}

function ehObjetoSimples(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Aplica os ajustes da tela sobre as linhas lidas da planilha.
 *
 * @param {Array} linhas as linhas de `lerPlanilhaLote` (`{ numero, valores }`).
 * @param {object|null} ajustes `{ "<numeroDaLinhaNoExcel>": { "<chaveDaColuna>": "valor" } }`.
 *   ⚠ Valor vazio (`""`) é AJUSTE, não ausência de ajuste: é como se apaga um campo — apagar o
 *   bloco de endereço inteiro é o que devolve a linha ao caminho da memória/consulta, e é uma
 *   instrução que a própria mensagem de `endereco_incompleto` dá.
 * @returns {{ok: true, linhas: Array, ajustadas: number[]}
 *          | {ok: false, codigo: string, mensagem: string}}
 */
export function aplicarAjustesLote(linhas, ajustes) {
  const originais = Array.isArray(linhas) ? linhas : [];
  if (ajustes === null || ajustes === undefined) return { ok: true, linhas: originais, ajustadas: [] };
  if (!ehObjetoSimples(ajustes)) {
    return recusar(
      RECUSA_AJUSTE.FORMA_INVALIDA,
      "Os ajustes desta planilha não chegaram em forma que se possa ler. Nada foi aplicado — "
        + "confira a linha na tela e envie de novo."
    );
  }

  const entradas = Object.entries(ajustes);
  if (!entradas.length) return { ok: true, linhas: originais, ajustadas: [] };

  const porNumero = new Map(originais.map((l) => [Number(l?.numero), l]));
  const numerosDesconhecidos = [];
  const colunasDesconhecidas = new Set();
  const aplicar = new Map();

  for (const [chaveLinha, celulas] of entradas) {
    const numero = Number(String(chaveLinha).trim());
    if (!Number.isInteger(numero) || !porNumero.has(numero)) {
      numerosDesconhecidos.push(String(chaveLinha));
      continue;
    }
    if (!ehObjetoSimples(celulas)) {
      return recusar(
        RECUSA_AJUSTE.FORMA_INVALIDA,
        `O ajuste da linha ${numero} não chegou em forma que se possa ler. Nada foi aplicado.`
      );
    }
    const limpas = {};
    for (const [chave, valor] of Object.entries(celulas)) {
      if (!CHAVES_VALIDAS.has(chave)) {
        colunasDesconhecidas.add(String(chave));
        continue;
      }
      // ⚠ Vira TEXTO. O que a pessoa digitou é texto, e é assim que `celulasLote.js` já lê a
      // planilha vinda de outro lugar — o caminho do valor ambíguo (`1.500`) e o do zero à
      // esquerda do CPF dependem de a leitura ver a grafia, não um número já convertido.
      limpas[chave] = valor === null || valor === undefined ? "" : String(valor);
    }
    aplicar.set(numero, limpas);
  }

  if (numerosDesconhecidos.length) {
    return recusar(
      RECUSA_AJUSTE.LINHA_DESCONHECIDA,
      `Estas linhas não existem na planilha enviada: ${numerosDesconhecidos.join(", ")}. Nada foi `
        + "aplicado — o ajuste é sempre sobre a linha da planilha que está aberta.",
      { linhasDesconhecidas: numerosDesconhecidos }
    );
  }
  if (colunasDesconhecidas.size) {
    return recusar(
      RECUSA_AJUSTE.COLUNA_DESCONHECIDA,
      `Estes campos não existem nesta nota: ${[...colunasDesconhecidas].join(", ")}. Nada foi `
        + "aplicado — aplicar o resto e calar sobre estes faria a correção sumir sem aviso.",
      { colunasDesconhecidas: [...colunasDesconhecidas] }
    );
  }

  const ajustadas = [];
  const saida = originais.map((linha) => {
    const celulas = aplicar.get(Number(linha?.numero));
    if (!celulas || !Object.keys(celulas).length) return linha;
    ajustadas.push(Number(linha.numero));
    // ⚠ NUNCA MUTA a linha lida: a mesma leitura é reusada a cada passe, e mutar faria o segundo
    // passe classificar em cima do resultado do primeiro.
    return {
      ...linha,
      valores: { ...(linha.valores || {}), ...celulas },
      /** ⚠ Marca a linha como ajustada NESTA sessão — o arquivo no disco continua o antigo. */
      ajustada: true,
    };
  });

  return { ok: true, linhas: saida, ajustadas };
}
