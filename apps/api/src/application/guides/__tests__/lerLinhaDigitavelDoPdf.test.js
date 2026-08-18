// A ponte entre o PDF e as quatro colunas da `Guide` — e, sobretudo, a TRAVA da invariante que
// impede `linhaDigitavelValorLidoCentavos` de virar a porta de saída do palpite.
//
// A matemática já é testada em `linhaDigitavelArrecadacao.test.js` (28 casos, incluindo a varredura
// que troca cada uma das 48 posições). O que se testa AQUI é a máquina de estados: qual das quatro
// combinações de colunas sai de cada situação, e que uma recusa por DV corrompido NUNCA carrega
// número junto.

import {
  MOTIVOS_LEITURA,
  NAO_TENTADA,
  lerLinhaDigitavelDoPdf,
} from "../lerLinhaDigitavelDoPdf.js";
import { MOTIVOS } from "../linhaDigitavelArrecadacao.js";

// DAS real do banco local (guia SIMPLES 2026-06, R$ 3.422,00 — `diag-linha-digitavel.mjs`).
// Valor codificado nas posições 05–15 do código de barras: 342200 centavos.
const LINHA_OK = "858800000342220003282624010720261829070844066762";
const VALOR_DA_LINHA_CENTAVOS = 342200;

const TEXTO_COM_LINHA = [
  "Documento de Arrecadação do Simples Nacional",
  "85880000034 2 22000328262 4 01072026182 9 07084406676 2",
  "Pague com o PIX",
].join("\n");

// Um dígito trocado no MEIO do 3º bloco: a sequência deixa de fechar o DV daquele bloco.
const LINHA_CORROMPIDA = `${LINHA_OK.slice(0, 30)}${LINHA_OK[30] === "9" ? "8" : "9"}${LINHA_OK.slice(31)}`;
const TEXTO_CORROMPIDO = `Guia\n${LINHA_CORROMPIDA}\n`;

const AGORA = new Date("2026-08-18T21:00:00.000Z");
const buffer = () => Buffer.from("%PDF-1.4 finge que sou um pdf");

/** Injeta o texto sem depender de um PDF binário real. */
const lendo = (texto) => ({ lerTexto: async () => texto, agora: AGORA });

describe("lerLinhaDigitavelDoPdf — a máquina de quatro estados", () => {
  test("NÃO TENTAMOS: sem PDF, as quatro colunas ficam nulas (e isso não é uma recusa)", async () => {
    await expect(lerLinhaDigitavelDoPdf(null, { valorTotal: 3422 }, lendo(TEXTO_COM_LINHA))).resolves.toEqual(
      NAO_TENTADA,
    );
    await expect(
      lerLinhaDigitavelDoPdf(Buffer.alloc(0), { valorTotal: 3422 }, lendo(TEXTO_COM_LINHA)),
    ).resolves.toEqual(NAO_TENTADA);
  });

  test("TEMOS A LINHA: 48 dígitos limpos, data de leitura, sem motivo e sem valor lido", async () => {
    const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal: 3422 }, lendo(TEXTO_COM_LINHA));
    expect(r).toEqual({
      linhaDigitavel: LINHA_OK,
      linhaDigitavelLidaEm: AGORA,
      linhaDigitavelMotivo: null,
      linhaDigitavelValorLidoCentavos: null,
    });
  });

  test("DIVERGÊNCIA: recusa a linha MAS entrega o valor impresso, que é o que o contador precisa ver", async () => {
    // O caso real: o documento traz R$ 3.422,00 e a guia está gravada com R$ 100,00.
    const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal: 100 }, lendo(TEXTO_COM_LINHA));
    expect(r.linhaDigitavel).toBeNull(); // ⚠ não sabemos qual dos dois números está errado
    expect(r.linhaDigitavelMotivo).toBe(MOTIVOS.VALOR_DIVERGENTE);
    expect(r.linhaDigitavelValorLidoCentavos).toBe(VALOR_DA_LINHA_CENTAVOS);
    expect(r.linhaDigitavelLidaEm).toBe(AGORA);
  });

  test("TENTAMOS E NÃO DEU: documento sem linha de arrecadação — data gravada, sem número", async () => {
    const r = await lerLinhaDigitavelDoPdf(
      buffer(),
      { valorTotal: 3422 },
      lendo("Boleto bancário de cobrança\n34191.79001 01043.510047 91020.150008 9 12345678901234\n"),
    );
    expect(r.linhaDigitavel).toBeNull();
    expect(r.linhaDigitavelMotivo).toBe(MOTIVOS.NAO_ENCONTRADA);
    expect(r.linhaDigitavelValorLidoCentavos).toBeNull();
    // ⚠ É a DATA que separa este estado de "não tentamos". Sem ela, os dois voltam ao mesmo balde.
    expect(r.linhaDigitavelLidaEm).toBe(AGORA);
  });
});

describe("⚠⚠ a invariante do valor lido", () => {
  test("linha CORROMPIDA não sai com valor: número tirado de sequência que falhou no DV é invenção", async () => {
    const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal: 3422 }, lendo(TEXTO_CORROMPIDO));
    expect(r.linhaDigitavel).toBeNull();
    expect(r.linhaDigitavelValorLidoCentavos).toBeNull();
    expect(r.linhaDigitavelMotivo).not.toBe(MOTIVOS.VALOR_DIVERGENTE);
  });

  test("varredura: NENHUMA recusa que não seja a de valor divergente carrega valor lido", async () => {
    const casos = [
      ["sem linha nenhuma", "documento vazio", 3422],
      ["boleto de cobrança (47 dígitos, outro layout)", "34191790010104351004791020150008912345678901234", 3422],
      ["linha corrompida no 1º bloco", `9${LINHA_OK.slice(1)}`, 3422],
      ["linha corrompida no meio", LINHA_CORROMPIDA, 3422],
      ["guia sem valor para conferir", TEXTO_COM_LINHA, null],
      ["guia com valor em branco", TEXTO_COM_LINHA, "   "],
    ];
    for (const [nome, texto, valorTotal] of casos) {
      const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal }, lendo(texto));
      expect(`${nome}: ${r.linhaDigitavelValorLidoCentavos}`).toBe(`${nome}: null`);
      expect(`${nome}: ${r.linhaDigitavel}`).toBe(`${nome}: null`);
      expect(r.linhaDigitavelMotivo).toBeTruthy();
    }
  });

  test("as duas colunas nunca coexistem — é o CHECK do banco, provado também aqui", async () => {
    const entradas = [
      [TEXTO_COM_LINHA, 3422],
      [TEXTO_COM_LINHA, 100],
      [TEXTO_CORROMPIDO, 3422],
      ["nada aqui", 3422],
    ];
    for (const [texto, valorTotal] of entradas) {
      const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal }, lendo(texto));
      expect(r.linhaDigitavel === null || r.linhaDigitavelMotivo === null).toBe(true);
    }
  });
});

describe("nunca derruba o salvamento da guia", () => {
  test("PDF ilegível vira recusa nomeada, não exceção", async () => {
    const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal: 3422 }, {
      agora: AGORA,
      lerTexto: async () => {
        throw new Error("Invalid XRef stream header");
      },
    });
    expect(r.linhaDigitavelMotivo).toBe(MOTIVOS_LEITURA.PDF_ILEGIVEL);
    expect(r.linhaDigitavelLidaEm).toBe(AGORA);
    expect(r.linhaDigitavel).toBeNull();
    expect(r.linhaDigitavelValorLidoCentavos).toBeNull();
  });

  test("guia sem valor gravado recusa com motivo próprio — linha que ninguém conferiu não é pagável", async () => {
    const r = await lerLinhaDigitavelDoPdf(buffer(), { valorTotal: null }, lendo(TEXTO_COM_LINHA));
    expect(r.linhaDigitavelMotivo).toBe(MOTIVOS_LEITURA.SEM_VALOR_PARA_CONFERIR);
    expect(r.linhaDigitavel).toBeNull();
  });
});
