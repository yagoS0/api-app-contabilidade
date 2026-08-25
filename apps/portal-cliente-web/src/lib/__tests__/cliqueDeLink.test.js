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

describe("⚠⚠ clique JÁ TRATADO por outro handler", () => {
  // A linha faltava neste portal até 24/08/2026 (o original a tem). Sem ela, quem cancelasse o
  // padrão dentro do link levaria um `preventDefault` + navegação por cima da própria decisão.
  it("o navegador assume — o app não disputa nem converte em navegação", () => {
    expect(oNavegadorAssumeOClique({ button: 0, defaultPrevented: true })).toBe(true);
  });

  it("e um clique normal continua sendo do app", () => {
    expect(oNavegadorAssumeOClique({ button: 0, defaultPrevented: false })).toBe(false);
  });
});

describe("⚠ a divergência que FICA — evento sem `button`", () => {
  // O original devolveria `true` aqui (`undefined !== 0`) e mataria a navegação SPA. Documentado
  // no módulo para não ser "alinhado" numa próxima sincronização.
  it("ausência de `button` cai no ramo do APP, não no do navegador", () => {
    expect(oNavegadorAssumeOClique({})).toBe(false);
    expect(oNavegadorAssumeOClique({ ctrlKey: true })).toBe(true);
  });
});
