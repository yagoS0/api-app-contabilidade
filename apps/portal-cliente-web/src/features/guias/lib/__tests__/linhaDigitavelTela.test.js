// A REGRA de tela da linha digitável no portal do CLIENTE.
//
// A ligação com a página é prendida em `features/guias/__tests__/linhaDigitavelNaTela.ligacao.test.jsx`.

import {
  SITUACAO,
  formatarLinhaDigitavel,
  linhaDigitavelDaGuia,
  somenteDigitos,
} from "../linhaDigitavelTela";

const LINHA = "858800000342220003282624010720261829070844066762";

const guia = (over = {}) => ({
  valor: 3422,
  linhaDigitavel: null,
  linhaDigitavelSituacao: "NAO_TENTADA",
  linhaDigitavelMotivo: null,
  linhaDigitavelValorLidoCentavos: null,
  ...over,
});

describe("máscara × dígitos", () => {
  it("mostra em 4 grupos de 11+1, como o documento imprime", () => {
    expect(formatarLinhaDigitavel(LINHA)).toBe("85880000034-2 22000328262-4 01072026182-9 07084406676-2");
  });

  it("⚠ o que se COPIA são os 48 dígitos limpos — é o que se digita no banco", () => {
    const r = linhaDigitavelDaGuia(guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL" }));
    expect(r.linhaLimpa).toBe(LINHA);
    expect(somenteDigitos(r.linhaFormatada)).toBe(LINHA);
  });

  it("número fora dos 48 dígitos não recebe máscara — não se completa o que falta", () => {
    expect(formatarLinhaDigitavel("8588")).toBeNull();
  });
});

describe("⚠⚠ as três ausências, com frases distintas", () => {
  it("NAO_TENTADA não afirma que o documento não tem linha", () => {
    const r = linhaDigitavelDaGuia(guia());
    expect(r.situacao).toBe(SITUACAO.NAO_TENTADA);
    expect(r.aviso).toMatch(/Ainda não lemos/);
    expect(r.linhaLimpa).toBeNull();
  });

  it("NAO_ENCONTRADA afirma que o documento não traz", () => {
    const r = linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "NAO_ENCONTRADA" }));
    expect(r.aviso).toMatch(/não traz linha digitável/);
  });

  it("⚠ DIVERGENTE não entrega os dois valores ao cliente — só que está em conferência", () => {
    const r = linhaDigitavelDaGuia(
      guia({ valor: 100, linhaDigitavelSituacao: "DIVERGENTE", linhaDigitavelValorLidoCentavos: 79079 }),
    );
    expect(r.situacao).toBe(SITUACAO.DIVERGENTE);
    expect(r.aviso).toMatch(/Em conferência com o contador/);
    expect(r.tom).toBe("atencao");
    // ⚠ A invariante que separa esta tela da do contador.
    expect(r.aviso).not.toMatch(/790|79,|3\.422/);
    expect(r.linhaLimpa).toBeNull();
  });

  it("as três frases são distintas, e todas apontam o PDF como saída", () => {
    const avisos = [
      linhaDigitavelDaGuia(guia()).aviso,
      linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "NAO_ENCONTRADA" })).aviso,
      linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "DIVERGENTE" })).aviso,
    ];
    expect(new Set(avisos).size).toBe(3);
    // Ausência de linha nunca pode virar ausência de caminho para pagar.
    for (const a of avisos) expect(a).toMatch(/PDF/);
  });

  it("situação desconhecida cai em NAO_TENTADA, nunca em 'temos a linha'", () => {
    expect(linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "ALGO_NOVO" })).situacao).toBe(SITUACAO.NAO_TENTADA);
    expect(linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "DISPONIVEL" })).linhaLimpa).toBeNull();
  });
});
