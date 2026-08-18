// A REGRA de tela da linha digitável — as quatro situações, a máscara, e a lista fechada de motivos.
//
// A LIGAÇÃO com a tabela é prendida à parte, em
// `list/components/__tests__/linhaDigitavelNaTela.test.jsx`. Regra certa sem chamador não desenha
// nada, e chamador sem regra desenha errado — as duas metades precisam de teste.

import {
  SITUACAO,
  formatarLinhaDigitavel,
  frasePorMotivo,
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
  it("a máscara é 4 grupos de 11+1, como o documento imprime", () => {
    expect(formatarLinhaDigitavel(LINHA)).toBe(
      "85880000034-2 22000328262-4 01072026182-9 07084406676-2",
    );
  });

  it("⚠ o que se COPIA são os 48 dígitos limpos — a máscara não sobrevive à cópia", () => {
    const r = linhaDigitavelDaGuia(guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL" }));
    expect(r.linhaLimpa).toBe(LINHA);
    expect(r.linhaLimpa).toHaveLength(48);
    expect(somenteDigitos(r.linhaFormatada)).toBe(r.linhaLimpa);
  });

  it("número que não tem 48 dígitos não recebe máscara (não se completa o que falta)", () => {
    expect(formatarLinhaDigitavel("123")).toBeNull();
    expect(formatarLinhaDigitavel(`${LINHA}9`)).toBeNull();
  });
});

describe("⚠⚠ as quatro situações, com desenhos distintos", () => {
  it("DISPONIVEL", () => {
    const r = linhaDigitavelDaGuia(guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL" }));
    expect(r.situacao).toBe(SITUACAO.DISPONIVEL);
    expect(r.linhaLimpa).toBe(LINHA);
    // ⚠ Nunca verde: verde neste portal é CONCLUÍDO, e ter o número não é etapa concluída.
    expect(r.tom).not.toContain("state-ok");
  });

  it("NAO_TENTADA não afirma que o documento não tem a linha", () => {
    const r = linhaDigitavelDaGuia(guia());
    expect(r.situacao).toBe(SITUACAO.NAO_TENTADA);
    expect(r.linhaLimpa).toBeNull();
    expect(r.titulo).toMatch(/Ainda não lemos/);
    expect(r.titulo).toMatch(/não quer dizer que o documento não tenha/);
  });

  it("NAO_ENCONTRADA afirma a tentativa", () => {
    const r = linhaDigitavelDaGuia(
      guia({ linhaDigitavelSituacao: "NAO_ENCONTRADA", linhaDigitavelMotivo: "linha_digitavel_nao_encontrada_no_texto" }),
    );
    expect(r.situacao).toBe(SITUACAO.NAO_ENCONTRADA);
    expect(r.titulo).toMatch(/^Lemos o documento/);
  });

  it("⚠ DIVERGENTE carrega OS DOIS VALORES e nunca a linha", () => {
    const r = linhaDigitavelDaGuia(
      guia({
        valor: 100,
        linhaDigitavelSituacao: "DIVERGENTE",
        linhaDigitavelMotivo: "valor_divergente_do_documento",
        linhaDigitavelValorLidoCentavos: 79079,
      }),
    );
    expect(r.situacao).toBe(SITUACAO.DIVERGENTE);
    expect(r.linhaLimpa).toBeNull();
    expect(r.linhaFormatada).toBeNull();
    expect(r.detalhe).toContain("790,79");
    expect(r.detalhe).toContain("100,00");
    // Âmbar: é pendência a resolver. ⚠ NUNCA vermelho — vermelho aqui é o que bloqueia o fechamento.
    expect(r.tom).toContain("state-warn");
    expect(r.tom).not.toContain("state-danger");
  });

  it("os quatro `resumo` são distintos entre si", () => {
    const resumos = [
      linhaDigitavelDaGuia(guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL" })),
      linhaDigitavelDaGuia(guia()),
      linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "NAO_ENCONTRADA" })),
      linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "DIVERGENTE", linhaDigitavelValorLidoCentavos: 79079 })),
    ].map((r) => r.resumo);
    expect(new Set(resumos).size).toBe(4);
  });

  it("situação desconhecida cai em NAO_TENTADA — nunca em 'temos a linha'", () => {
    expect(linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "ALGO_NOVO" })).situacao).toBe(SITUACAO.NAO_TENTADA);
    // ⚠ E DISPONIVEL sem número também não vira número: o contrato tem de trazer os dois.
    expect(linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "DISPONIVEL" })).linhaLimpa).toBeNull();
  });
});

describe("⚠ lista FECHADA de motivos", () => {
  it("motivo catalogado vira frase", () => {
    expect(frasePorMotivo("dv_de_bloco_nao_confere")).toMatch(/dígito verificador/);
  });

  it("motivo NÃO catalogado não ganha frase — nem por semelhança", () => {
    expect(frasePorMotivo("dv_de_bloco_nao_confere_v2")).toBeNull();
    expect(frasePorMotivo("")).toBeNull();
    expect(frasePorMotivo(undefined)).toBeNull();
    // E não herda de `Object.prototype`, que é como um de-para descuidado responde a "toString".
    expect(frasePorMotivo("toString")).toBeNull();
    expect(frasePorMotivo("constructor")).toBeNull();
  });

  it("o motivo cru sobrevive na leitura, para a auditoria poder recuperá-lo", () => {
    const r = linhaDigitavelDaGuia(guia({ linhaDigitavelSituacao: "NAO_ENCONTRADA", linhaDigitavelMotivo: "algo_novo" }));
    expect(r.motivoCru).toBe("algo_novo");
    expect(r.titulo).not.toContain("algo_novo"); // a frase não inventa; quem junta o cru é a célula
  });
});
