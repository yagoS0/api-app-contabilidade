// O MODELO DA PLANILHA QUE O CLIENTE BAIXA — QUATRO colunas desde 20/08/2026.
//
// > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche"*.
// > Dono (20/08/2026): *"não precisamos de nada do tomador, apenas o CNPJ ou CPF."*
//
// ⚠ **ERAM DOZE COLUNAS.** Nome, e-mail e o bloco de endereço saíram — o porquê está por extenso em
// `colunasLote.js`, e a aba de instruções DIZ ao cliente para onde eles foram. Um modelo que
// encolhesse sem explicar deixaria quem já usava a versão antiga achando que perdeu campo.
//
// ⚠⚠ **NADA AQUI EMITE NADA.** Gera um arquivo .xlsx em memória. Sem banco, sem rede.
//
// Usa a lib `xlsx` (SheetJS 0.18.5) que **já existe** em `apps/api` — a mesma do import contábil
// (`application/accounting/excelImport.js`). Nenhuma dependência foi acrescentada.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O ZERO À ESQUERDA DO CPF — a metade da defesa que mora AQUI
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Numa célula de formato **Geral**, o Excel lê `01234567890` como o NÚMERO 1234567890 e o zero
// some. São 10 dígitos, e o validador recusa (`tomador_documento_invalido`). Com o DV do CPF
// conferido desde 18/08/2026, isso bateria em toda linha de CPF começando com zero.
//
// A defesa é dupla, e as duas metades são necessárias:
//   • **aqui**: o modelo nasce com as colunas de dígitos formatadas como TEXTO, para o problema não
//     acontecer;
//   • **na leitura** (`celulasLote.js`): o caso é tratado mesmo assim, porque a planilha pode vir de
//     outro lugar, ser recriada do zero ou ter as colunas coladas.
//
// ⚠ **COMO O FORMATO TEXTO É ESCRITO, e por que não é no `!cols`.** Medido no SheetJS 0.18.5: o
// `<col>` que ele emite **não carrega estilo** (só largura), então formato de COLUNA não é
// alcançável — `!cols` aceita `wch`/`wpx`/`hidden` e nada mais. O que funciona é o formato por
// CÉLULA (`z: "@"`), que sai como um `s="N"` de verdade no XML da planilha. Célula em branco de
// verdade (`t: "z"`) é **descartada** na escrita e perde o estilo junto; a que sobrevive é a de
// texto vazio (`{ t: "s", v: "" }`). Por isso o modelo pré-formata `LINHAS_PREFORMATADAS` células
// vazias nessas colunas: é o que faz o formato valer para o que a pessoa DIGITAR.
//
// ⚠ Essas células vazias voltam na leitura como string vazia, e `lerPlanilhaLote` pula a linha em
// que **todos** os campos estão vazios — é por isso que aquela regra existe.

import * as XLSX from "xlsx";
import { COLUNAS_LOTE, COLUNAS_DE_TEXTO, LINHA_DE_EXEMPLO } from "./colunasLote.js";

export const NOME_DA_ABA = "Notas";
export const NOME_DA_ABA_INSTRUCOES = "Instruções";
export const NOME_DO_ARQUIVO = "modelo-emissao-em-lote.xlsx";

/** Quantas linhas nascem já formatadas como texto nas colunas de dígitos. */
export const LINHAS_PREFORMATADAS = 300;

/** Larguras em caracteres. Só estética — cabeçalho cortado faz a pessoa renomear a coluna. */
const LARGURA = {
  documento: 22,
  descricao: 52,
  valor: 18,
  competencia: 28,
};

function celulaTexto(valor) {
  // ⚠ `z: "@"` é o formato "Texto" do Excel. Sem ele, uma célula de string ainda seria texto, mas a
  // CÉLULA VAZIA logo abaixo não seria — e é a vazia que a pessoa vai preencher.
  return { t: "s", v: String(valor ?? ""), z: "@" };
}

/**
 * Gera o modelo.
 *
 * @returns {{buffer: Buffer, nomeDoArquivo: string, aba: string}}
 */
function abaDeInstrucoes() {
  // ⚠ A AJUDA VIVE NUMA ABA PRÓPRIA, e não numa segunda linha da aba de dados. Uma linha de ajuda
  // abaixo do cabeçalho seria LIDA como nota: `lerPlanilhaLote` classifica toda linha com conteúdo,
  // e ela viraria uma pendência barulhenta em toda planilha — ou, pior, o cliente a apagaria junto
  // com a primeira nota de verdade.
  //
  // ⚠ E a aba de dados tem de ser a PRIMEIRA: `lerPlanilhaLote` lê `SheetNames[0]`.
  const linhas = [
    ["Como preencher esta planilha"],
    [],
    ["1.", "São QUATRO colunas, e todas as quatro são obrigatórias. Do tomador, pedimos só o CNPJ ou CPF."],
    ["2.", "Uma planilha = UMA empresa emitente. Você escolhe a empresa antes de enviar o arquivo."],
    ["3.", "Cada LINHA da aba “Notas” é UMA nota. Os tomadores podem ser diferentes entre as linhas."],
    ["4.", "APAGUE a linha de exemplo antes de enviar."],
    ["5.", "O nome e o endereço do tomador NÃO são pedidos aqui: se já emitimos para esse CNPJ/CPF antes, usamos o que a última nota levou; se não, consultamos o CNPJ na Receita."],
    ["6.", "Quando nenhum dos dois responder, a tela de conferência avisa NAQUELA linha e você preenche por lá — inclusive o município, que se escolhe numa lista (não é preciso saber código do IBGE)."],
    ["7.", "⚠ CPF não é consultado (a base pública é de CNPJ). Tomador pessoa física que nunca recebeu nota sua SEMPRE cai na conferência, para você escrever o nome e o endereço. Isso é o esperado."],
    ["8.", "⚠ NÃO altere o formato da coluna de CNPJ/CPF: ela já vem como TEXTO. Em coluna numérica o Excel apaga o zero da frente, e um CPF que começa com zero fica com 10 dígitos."],
    ["9.", "⚠ Escreva o valor com vírgula nos centavos (1500,00). Valor com duas leituras possíveis (como 1.500) não é convertido — vira pendência da linha."],
    [],
    ["Coluna", "Obrigatória?", "Como preencher"],
    ...COLUNAS_LOTE.map((c) => [c.rotulo, c.obrigatoria ? "Sim" : "Não", c.ajuda || ""]),
    [],
    ["O que NÃO entra nesta planilha, e por quê"],
    [
      "",
      "",
      "Nome, e-mail e endereço do tomador: eles são pedidos na tela de conferência, e SÓ quando "
        + "fizerem falta. Uma coluna que quase sempre vem em branco é trabalho para quem preenche "
        + "sem ganho nenhum.",
    ],
    [
      "",
      "",
      "Município emissor, código de serviço (atividade), série da DPS e as alíquotas vêm do CADASTRO "
        + "da sua empresa, no portal do contador. Uma coluna dessas aqui seria uma porta para emitir "
        + "contradizendo o cadastro.",
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = [{ wch: 38 }, { wch: 14 }, { wch: 90 }];
  return ws;
}

/**
 * Gera o modelo.
 *
 * @returns {{buffer: Buffer, nomeDoArquivo: string, aba: string}}
 */
export function gerarModeloPlanilhaLote() {
  const cabecalhos = COLUNAS_LOTE.map((c) => c.rotulo);
  const exemplo = COLUNAS_LOTE.map((c) => LINHA_DE_EXEMPLO[c.chave] ?? "");

  const ws = XLSX.utils.aoa_to_sheet([cabecalhos, exemplo]);

  const indicesDeTexto = COLUNAS_LOTE.map((c, i) => (COLUNAS_DE_TEXTO.includes(c.chave) ? i : -1)).filter(
    (i) => i >= 0
  );

  // As células de exemplo nas colunas de dígitos: texto explícito.
  for (const coluna of indicesDeTexto) {
    ws[XLSX.utils.encode_cell({ c: coluna, r: 1 })] = celulaTexto(
      LINHA_DE_EXEMPLO[COLUNAS_LOTE[coluna].chave] ?? ""
    );
  }

  // ⚠ E as vazias abaixo — é ESTA parte que faz o formato valer para o que a pessoa digitar.
  const primeiraLivre = 2;
  const ultima = primeiraLivre + LINHAS_PREFORMATADAS - 1;
  for (const coluna of indicesDeTexto) {
    for (let r = primeiraLivre; r <= ultima; r += 1) {
      ws[XLSX.utils.encode_cell({ c: coluna, r })] = celulaTexto("");
    }
  }
  ws["!ref"] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: COLUNAS_LOTE.length - 1, r: ultima },
  });
  ws["!cols"] = COLUNAS_LOTE.map((c) => ({ wch: LARGURA[c.chave] ?? 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, NOME_DA_ABA);
  XLSX.utils.book_append_sheet(wb, abaDeInstrucoes(), NOME_DA_ABA_INSTRUCOES);

  return {
    buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    nomeDoArquivo: NOME_DO_ARQUIVO,
    aba: NOME_DA_ABA,
  };
}
