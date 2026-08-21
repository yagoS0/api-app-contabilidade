import { oNavegadorAssumeOClique } from "../cliqueDeLink";

describe("oNavegadorAssumeOClique", () => {
  it("clique simples é NOSSO — vira navegação SPA", () => {
    expect(oNavegadorAssumeOClique({ button: 0 })).toBe(false);
    expect(oNavegadorAssumeOClique({})).toBe(false);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"])(
    "⚠ com %s o navegador assume — nada de `preventDefault`",
    (tecla) => {
      expect(oNavegadorAssumeOClique({ [tecla]: true, button: 0 })).toBe(true);
    },
  );

  it("botão diferente do esquerdo também é do navegador", () => {
    expect(oNavegadorAssumeOClique({ button: 1 })).toBe(true);
    expect(oNavegadorAssumeOClique({ button: 2 })).toBe(true);
  });

  it("evento ausente não derruba a tela", () => {
    expect(oNavegadorAssumeOClique(null)).toBe(false);
    expect(oNavegadorAssumeOClique(undefined)).toBe(false);
  });
});
