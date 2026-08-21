// O MODELO DA PLANILHA QUE O CLIENTE BAIXA — QUATRO colunas desde 20/08/2026, e uma TABELA de
// verdade desde 21/08/2026.
//
// > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche"*.
// > Dono (20/08/2026): *"não precisamos de nada do tomador, apenas o CNPJ ou CPF."*
// > Dono (21/08/2026): *"vamos melhorar a planilha, tirar as instruções, colocar uma tabela mesmo,
// > com cabeçalhos, campos exclusivos, para número, texto, valor, data, dessa forma o usuário não
// > erra na planilha nem a modifica sem querer"*
//
// ⚠⚠ **NADA AQUI EMITE NADA.** Gera um arquivo .xlsx em memória. Sem banco, sem rede.
//
// Usa a lib `xlsx` (SheetJS 0.18.5) que **já existe** em `apps/api` — a mesma do import contábil
// (`application/accounting/excelImport.js`). **Nenhuma dependência foi acrescentada**, inclusive
// para a validação e a proteção: o que o SheetJS não escreve está escrito à mão em
// `protecaoPlanilhaLote.js`, e o porquê está medido lá.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A ABA DE INSTRUÇÕES FOI EMBORA (21/08/2026) — e não é só simplificação de tela
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Eram nove parágrafos numerados numa segunda aba. O dono pediu que saíssem, e o critério dele é o
// mesmo que já cortou legenda seis vezes: **sai a frase que descreve uma ausência visível; fica a
// que impede uma ausência de ser lida como afirmação.**
//
// ⚠ O que aquele texto fazia agora está feito por MECANISMO, no lugar onde a dúvida aparece:
//
//   • *"não altere o formato da coluna de CNPJ/CPF"* → agora a planilha **não deixa** reformatar
//     (`formatCells` travado). A frase descrevia um perigo que o arquivo hoje impede.
//   • *"escreva o valor com vírgula nos centavos"* / *"use dd/mm/aaaa"* → agora a coluna **é** de
//     valor e **é** de data, e a caixa de ajuda aparece ao clicar na célula.
//   • *"apague a linha de exemplo"* → ela já era descartada na leitura, e continua sendo. A
//     instrução pedia à pessoa que fizesse o que o código já fazia por ela.
//   • *"nome e endereço não são pedidos aqui"* → descreve uma ausência que a tela de conferência
//     já resolve na hora, linha a linha. É exatamente a frase que o critério manda cortar.
//
// ⚠ Sobrou UMA aba, e isso simplifica uma coisa que era frágil: `lerPlanilhaLote` lê `SheetNames[0]`
// e dependia de a aba de dados ter sido acrescentada primeiro.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ CAMPOS EXCLUSIVOS: CADA COLUNA TEM UM TIPO, E O TIPO É O `formato` DECLARADO NA COLUNA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// texto (`@`) para CNPJ/CPF e descrição, valor (`#,##0.00`) e data (`dd/mm/yyyy`). O formato não é
// enfeite: ele decide **o que o Excel faz com o que a pessoa digitar** na célula.
//
// ⚠ **O ZERO À ESQUERDA DO CPF — a metade da defesa que mora AQUI.** Numa célula de formato
// **Geral**, o Excel lê `01234567890` como o NÚMERO 1234567890 e o zero some. São 10 dígitos, e o
// validador recusa (`tomador_documento_invalido`). A defesa é dupla, e as duas metades são
// necessárias:
//   • **aqui**: a coluna nasce formatada como TEXTO, para o problema não acontecer;
//   • **na leitura** (`celulasLote.js`): o caso é tratado mesmo assim, porque a planilha pode vir de
//     outro lugar, ser recriada do zero ou ter as colunas coladas.
// ⚠ E desde 21/08/2026 há uma TERCEIRA: a validação de comprimento barra o documento de 10
// caracteres na hora em que ele é digitado. Ver `colunasLote.js`.
//
// ⚠ **COMO O FORMATO É ESCRITO, e por que não é no `!cols`.** Medido no SheetJS 0.18.5: o `<col>`
// que ele emite **não carrega estilo** (só largura), então formato de COLUNA não é alcançável —
// `!cols` aceita `wch`/`wpx`/`hidden` e nada mais. O que funciona é o formato por CÉLULA (`z`), que
// sai como um `s="N"` de verdade no XML. Célula em branco de verdade (`t: "z"`) é **descartada** na
// escrita e perde o estilo junto; a que sobrevive é a de texto vazio (`{ t: "s", v: "" }`). Por
// isso o modelo pré-formata `LINHAS_PREFORMATADAS` células vazias em **todas** as colunas: é o que
// faz o formato valer para o que a pessoa DIGITAR.
//
// ⚠ Essas células vazias voltam na leitura como string vazia, e `lerPlanilhaLote` pula a linha em
// que **todos** os campos estão vazios — é por isso que aquela regra existe.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A DATA DO EXEMPLO É UM SERIAL INTEIRO, E ISSO NÃO É DETALHE DE IMPLEMENTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// **Medido no SheetJS 0.18.5, com `TZ=America/Sao_Paulo` (o fuso de produção):** escrever a
// competência como célula de data (`{ t: "d", v: new Date(…) }`) produz um serial **fracionário**
// (46233,8746… em vez de 46234) e a data volta da leitura **um dia antes** — 30/07/2026 no lugar de
// 31/07/2026. Sob `TZ=UTC` o mesmo código acerta, que é o jeito de o defeito não aparecer em teste.
//
// ⚠⚠ Isso é a mesma família de erro que `utils/dataCivil.js` registra, e o desfecho aqui seria
// **nota fiscal emitida com a competência errada** — que não se corrige, se cancela.
//
// ⚠ O que foi medido como correto **nos dois fusos** é o serial INTEIRO num célula numérica
// (`{ t: "n", v: 46234, z: "dd/mm/yyyy" }`) — que é, aliás, exatamente o que o Excel grava quando a
// pessoa digita a data. Por isso `serialDoExcel` existe, e por isso ele é a inversa exata da conta
// que `lerCompetenciaDaPlanilha` já faz na volta.

import * as XLSX from "xlsx";
import { COLUNAS_LOTE, LINHA_DE_EXEMPLO } from "./colunasLote.js";
import { lerValorDaPlanilha, lerCompetenciaDaPlanilha } from "./celulasLote.js";
import { blindarPlanilha, TRAVAS_DA_PLANILHA } from "./protecaoPlanilhaLote.js";

export const NOME_DA_ABA = "Notas";
export const NOME_DO_ARQUIVO = "modelo-emissao-em-lote.xlsx";

/** Quantas linhas nascem já formatadas em todas as colunas. */
export const LINHAS_PREFORMATADAS = 300;

/**
 * Até que linha a validação alcança.
 *
 * ⚠ Vai MUITO além do bloco pré-formatado, e de propósito: `sqref` é só uma faixa de texto no XML
 * (não custa uma célula sequer no arquivo), enquanto pré-formatar custa uma célula de verdade. Um
 * lote de 800 notas continua validado, mesmo passando das 300 linhas com formato carimbado.
 */
export const LINHAS_VALIDADAS = 5000;

/** Larguras em caracteres. Só estética — cabeçalho cortado faz a pessoa renomear a coluna. */
const LARGURA = {
  documento: 22,
  descricao: 52,
  valor: 18,
  competencia: 28,
};

/** A época do Excel: o dia 1 é 01/01/1900, com o bug do 29/02/1900 inexistente embutido. */
const EPOCA_DO_EXCEL = Date.UTC(1899, 11, 30);

/**
 * Uma data civil vira o serial inteiro que o Excel usa.
 *
 * ⚠ É a INVERSA EXATA da conta de `lerCompetenciaDaPlanilha` (`Date.UTC(1899,11,30) + serial*86400000`).
 * Escrever e ler pela mesma aritmética é o que garante que a data que sai é a data que volta.
 */
function serialDoExcel(data) {
  return Math.round((data.getTime() - EPOCA_DO_EXCEL) / 86400000);
}

/**
 * A célula de uma coluna, no tipo declarado por ela.
 *
 * ⚠ `valor == null` produz a célula VAZIA daquele tipo — `{ t: "s", v: "" }` com o formato da
 * coluna. É ela que carrega o formato para a linha que a pessoa vai preencher, e é por isso que
 * célula em branco de verdade (`t: "z"`) não serve: o SheetJS a descarta na escrita.
 */
function celulaDaColuna(coluna, valor) {
  const z = coluna.formato;
  if (valor === null || valor === undefined || valor === "") return { t: "s", v: "", z };

  if (coluna.tipo === "valor") {
    // ⚠ Passa pelo MESMO leitor que a planilha de volta usa. Se o exemplo deixasse de ser legível,
    // o modelo nasceria com uma célula que a leitura recusa — e ninguém veria.
    const lido = lerValorDaPlanilha(valor);
    return lido.ok ? { t: "n", v: lido.valor, z } : { t: "s", v: String(valor), z: "@" };
  }

  if (coluna.tipo === "data") {
    const lido = lerCompetenciaDaPlanilha(valor);
    // ⚠ Serial INTEIRO, nunca `{ t: "d" }`. Ver o bloco sobre o fuso, no topo deste arquivo.
    return lido.ok ? { t: "n", v: serialDoExcel(lido.competencia), z } : { t: "s", v: String(valor), z: "@" };
  }

  return { t: "s", v: String(valor), z };
}

/**
 * Gera o modelo.
 *
 * @returns {{buffer: Buffer, nomeDoArquivo: string, aba: string, blindada: boolean}}
 */
export function gerarModeloPlanilhaLote() {
  const cabecalhos = COLUNAS_LOTE.map((c) => c.rotulo);
  const ws = XLSX.utils.aoa_to_sheet([cabecalhos]);

  const ultimaLinhaPreformatada = LINHAS_PREFORMATADAS + 1;

  COLUNAS_LOTE.forEach((coluna, c) => {
    // r = 1 é a linha de exemplo; daí para baixo, as vazias que carregam o formato.
    for (let r = 1; r <= ultimaLinhaPreformatada; r += 1) {
      const valor = r === 1 ? LINHA_DE_EXEMPLO[coluna.chave] : null;
      ws[XLSX.utils.encode_cell({ c, r })] = celulaDaColuna(coluna, valor);
    }
  });

  ws["!ref"] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: COLUNAS_LOTE.length - 1, r: ultimaLinhaPreformatada },
  });
  ws["!cols"] = COLUNAS_LOTE.map((c) => ({ wch: LARGURA[c.chave] ?? 18 }));

  // ⚠ O autofiltro é a única peça de "tabela de verdade" que o SheetJS escreve sozinho (o
  // `tableParts`/ListObject do Excel é, no escritor dele, só um comentário vazio). Ele dá ao
  // cabeçalho as setas de filtrar e ordenar, que é o que faz a faixa parecer — e funcionar como —
  // uma tabela.
  ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(COLUNAS_LOTE.length - 1)}1` };

  // ⚠ A proteção é a ÚNICA das três peças que o SheetJS escreve nativamente; as travas e a decisão
  // de não usar senha estão em `protecaoPlanilhaLote.js`.
  ws["!protect"] = { ...TRAVAS_DA_PLANILHA };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, NOME_DA_ABA);

  const bruto = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // ⚠⚠ E aqui entra o que o SheetJS não escreve: validação por coluna, cabeçalho travado/congelado
  // e o destravamento das células de dados — sem o qual a proteção deixaria a planilha
  // somente-leitura. Se falhar, `blindarPlanilha` devolve o buffer original em vez de derrubar o
  // download; `blindada` diz qual dos dois voltou.
  const { buffer, blindada } = blindarPlanilha(bruto, {
    colunas: COLUNAS_LOTE,
    ultimaLinha: LINHAS_VALIDADAS,
  });

  return {
    buffer,
    nomeDoArquivo: NOME_DO_ARQUIVO,
    aba: NOME_DA_ABA,
    /** ⚠ `false` = a planilha saiu correta, porém SEM validação/proteção. Ver `blindarPlanilha`. */
    blindada,
  };
}
