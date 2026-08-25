import { fraseDaClassificacao } from "../fraseDaClassificacao";

const r = (over = {}) => ({
  processed: 33, classified: 31, pendentes: 2,
  escopo: { tipo: "COMPETENCIA", competencia: "2026-07" },
  foraDoEscopo: null,
  ...over,
});

describe("⚠⚠ O ESCOPO ENTRA NA FRASE", () => {
  it("com competência, ela diz de QUE mês", () => {
    expect(fraseDaClassificacao(r()).texto).toMatch(/de 07\/2026/);
  });

  it("sem competência, ela diz que foi a empresa inteira — nunca finge ser um mês", () => {
    const f = fraseDaClassificacao(r({ escopo: { tipo: "EMPRESA", competencia: null } }));
    expect(f.texto).toMatch(/da empresa inteira/);
    expect(f.texto).not.toMatch(/\d{2}\/\d{4}/);
  });
});

describe("⚠⚠ \"NADA A CLASSIFICAR\" ≠ \"0 DE 0\"", () => {
  // "Classificou 0/0" foi o que o dono viu, e lê-se como falha tanto quanto como trabalho já feito.
  it("processed 0 tem frase PRÓPRIA, que afirma o trabalho já estar feito", () => {
    const f = fraseDaClassificacao(r({ processed: 0, classified: 0, pendentes: 0 }));
    expect(f.texto).toMatch(/Nada a classificar de 07\/2026/);
    expect(f.texto).toMatch(/já estavam classificados/);
    expect(f.texto).not.toMatch(/0 de 0/);
    expect(f.houveTrabalho).toBe(false);
  });

  it("com trabalho, diz quantos e quantos ficaram pendentes", () => {
    const f = fraseDaClassificacao(r());
    expect(f.texto).toMatch(/Classificou 31 de 33 itens de 07\/2026/);
    expect(f.texto).toMatch(/2 ficaram pendentes/);
    expect(f.houveTrabalho).toBe(true);
  });

  it("sem pendência, a frase não inventa uma", () => {
    expect(fraseDaClassificacao(r({ classified: 33, pendentes: 0 })).texto).not.toMatch(/pendente/);
  });

  it("singular e plural", () => {
    expect(fraseDaClassificacao(r({ processed: 1, classified: 1, pendentes: 0 })).texto).toMatch(/1 item/);
    expect(fraseDaClassificacao(r({ processed: 5, classified: 4, pendentes: 1 })).texto).toMatch(/1 ficou pendente/);
  });
});

describe("⚠⚠ O QUE FICOU DE FORA APARECE", () => {
  it("nota sem competência vira alerta próprio, com o motivo e onde conferir", () => {
    const f = fraseDaClassificacao(r({ foraDoEscopo: { semCompetencia: 4, motivo: "SEM_COMPETENCIA_GRAVADA" } }));
    expect(f.alerta).toMatch(/4 itens ficaram de fora/);
    expect(f.alerta).toMatch(/sem competência gravada/);
    expect(f.alerta).toMatch(/Auditoria/);
  });

  it("zero fora do escopo não vira alerta — âmbar permanente treina o olho a ignorar", () => {
    expect(fraseDaClassificacao(r({ foraDoEscopo: { semCompetencia: 0 } })).alerta).toBeNull();
    expect(fraseDaClassificacao(r()).alerta).toBeNull();
  });

  it("⚠ `foraDoEscopo` ausente (escopo de empresa) não vira alerta nem erro", () => {
    expect(fraseDaClassificacao(r({ escopo: { tipo: "EMPRESA", competencia: null } })).alerta).toBeNull();
  });
});

describe("⚠ resposta torta não quebra a tela", () => {
  it.each([null, undefined, {}, { processed: "x" }])("%p vira frase, não exceção", (bruto) => {
    const f = fraseDaClassificacao(bruto);
    expect(typeof f.texto).toBe("string");
    expect(f.texto.length).toBeGreaterThan(0);
  });
});
