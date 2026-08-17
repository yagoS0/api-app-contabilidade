import { estadoVazioDasGuias, VAZIO } from "../estadoVazioGuias";

const BASE = { competencia: "2026-08", erro: null, semFaturamento: false, estadoApuracao: null };

describe("⚠ falha de carga NUNCA se parece com 'não há guia'", () => {
  it("erro de servidor vira FALHA, e a frase diz que não sabemos se deveria haver guia", () => {
    const r = estadoVazioDasGuias({ ...BASE, erro: new Error("timeout") });
    expect(r.chave).toBe(VAZIO.FALHA);
    expect(r.explicacao).toMatch(/não é possível dizer se deveria haver/i);
  });

  it("403 vira a resposta de acesso, não a de ausência", () => {
    const erro = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    const r = estadoVazioDasGuias({ ...BASE, erro });
    expect(r.chave).toBe(VAZIO.FALHA);
    expect(r.titulo).toMatch(/não tem acesso/i);
  });

  it("⚠ a falha vence TUDO — nem 'sem movimento' nem apuração fechada a mascaram", () => {
    const r = estadoVazioDasGuias({
      ...BASE, erro: new Error("500"), semFaturamento: true, estadoApuracao: "fechada",
    });
    expect(r.chave).toBe(VAZIO.FALHA);
  });
});

describe("as três respostas que o dono pediu", () => {
  it("competência não apurada — e diz que isso NÃO significa nada a pagar", () => {
    const r = estadoVazioDasGuias({ ...BASE, estadoApuracao: "aberta" });
    expect(r.chave).toBe(VAZIO.NAO_APURADO);
    expect(r.explicacao).toMatch(/não diz que não há tributo a pagar/i);
    expect(r.acao).toEqual({ rotulo: "Ir para Apuração", destino: "apuracao" });
  });

  it.each(["calculada", "revisada", "fechada", "transmitida", "confirmada"])(
    "apurada (%s) e sem guia — o próximo passo é subir/buscar a guia",
    (estadoApuracao) => {
      const r = estadoVazioDasGuias({ ...BASE, estadoApuracao });
      expect(r.chave).toBe(VAZIO.APURADO_SEM_GUIA);
      expect(r.acao.destino).toBe("upload");
    },
  );

  it("mês sem faturamento — o DAS não é exigido, e as outras guias continuam valendo", () => {
    const r = estadoVazioDasGuias({ ...BASE, semFaturamento: true, estadoApuracao: "aberta" });
    expect(r.chave).toBe(VAZIO.SEM_MOVIMENTO);
    expect(r.explicacao).toMatch(/INSS, parcelamento/i);
  });

  it("⚠ 'sem faturamento' exige TRUE — `null` é 'ninguém disse nada', não 'não teve receita'", () => {
    // O campo é tri-estado no banco de propósito (ver apps/api/CLAUDE.md).
    for (const semFaturamento of [null, undefined, false, 0, ""]) {
      expect(estadoVazioDasGuias({ ...BASE, semFaturamento, estadoApuracao: "aberta" }).chave)
        .toBe(VAZIO.NAO_APURADO);
    }
  });
});

describe("⚠ o que NÃO se afirma", () => {
  it("estado desconhecido cai em INDEFINIDO — nunca em 'não apurado'", () => {
    for (const estadoApuracao of ["bloqueada_pendencias", "erro_calculo", "coisa_nova", "ABERTA "]) {
      const r = estadoVazioDasGuias({ ...BASE, estadoApuracao });
      expect(r.chave).toBe(estadoApuracao.trim().toLowerCase() === "aberta"
        ? VAZIO.NAO_APURADO
        : VAZIO.INDEFINIDO);
    }
  });

  it("estado ausente é INDEFINIDO, e a frase manda conferir antes de concluir", () => {
    const r = estadoVazioDasGuias({ ...BASE, estadoApuracao: null });
    expect(r.chave).toBe(VAZIO.INDEFINIDO);
    expect(r.explicacao).toMatch(/antes de concluir que não há nada a pagar/i);
  });

  it("nenhuma resposta afirma que a empresa está em dia", () => {
    const todas = [
      estadoVazioDasGuias({ ...BASE, erro: new Error("x") }),
      estadoVazioDasGuias({ ...BASE, competencia: "" }),
      estadoVazioDasGuias({ ...BASE, semFaturamento: true }),
      estadoVazioDasGuias({ ...BASE, estadoApuracao: "aberta" }),
      estadoVazioDasGuias({ ...BASE, estadoApuracao: "fechada" }),
      estadoVazioDasGuias({ ...BASE }),
    ];
    for (const r of todas) {
      expect(`${r.titulo} ${r.explicacao}`).not.toMatch(/em dia|regular|nada consta|tudo certo/i);
    }
  });
});

describe("todas as competências", () => {
  it("sem competência única a pergunta não se aplica", () => {
    const r = estadoVazioDasGuias({ ...BASE, competencia: "" });
    expect(r.chave).toBe(VAZIO.TODAS_COMPETENCIAS);
    expect(r.acao).toBeNull();
  });

  it("⚠ e nem 'sem movimento' nem a apuração mudam isso — elas são de UM mês", () => {
    const r = estadoVazioDasGuias({
      ...BASE, competencia: "", semFaturamento: true, estadoApuracao: "fechada",
    });
    expect(r.chave).toBe(VAZIO.TODAS_COMPETENCIAS);
  });
});
