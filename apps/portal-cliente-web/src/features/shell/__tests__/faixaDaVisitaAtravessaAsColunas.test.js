// ⚠⚠ A FAIXA DA VISITA FOI REMOVIDA PELO DONO (01/09/2026) — este arquivo registra a reversão.
//
// A história inteira, em ordem, porque cada metade sozinha leva a "conserto" errado:
//
// 1. A faixa nasceu em 31/08 como OBRIGATÓRIA (substituía a porta fechada do `accountGate`) e
//    subiu QUEBRADA: filha direta de `.app` (grid de `56px minmax(0,1fr)`) sem `grid-column`,
//    caiu na coluna de 56px — uma palavra por linha, ~560px de altura. Relatado pelo dono.
// 2. Consertada com `grid-column: 1 / -1`, apareceu o SEGUNDO defeito que o primeiro escondia:
//    `.app` declara DUAS linhas (`auto` + `minmax(0,1fr)`), e a faixa era uma TERCEIRA filha — a
//    topbar caía na linha `1fr` e ESTICAVA, abrindo um vão de tela inteira. O dono viu em
//    produção e decidiu: *"tire esse texto do início, ajuste essa tela"*.
// 3. A faixa saiu. O risco que ela cobria (o visitante lendo números de UMA empresa como se
//    fossem os dele) NÃO sumiu — mudou para a linha do CNPJ da topbar: "· visita do escritório".
//
// ⚠ Varredura de fonte, e tem de ser: o jsdom não faz layout, e os dois defeitos eram de layout.

import fs from "node:fs";
import path from "node:path";

// ⚠ `__dirname` e não `import.meta` — o jest desta casa transpila para CJS.
const CSS = fs.readFileSync(path.join(__dirname, "../../../styles/app.css"), "utf8");
const CASCA = fs.readFileSync(path.join(__dirname, "../AppShell.jsx"), "utf8");

describe("⚠⚠ a faixa da visita NÃO existe — decisão do dono, não limpeza", () => {
  it("nenhum elemento `.faixa-visita` é renderizado", () => {
    expect(CASCA).not.toMatch(/className="faixa-visita"/);
  });

  it("⚠ e o CSS dela também morreu — regra sem consumidor parece fazer alguma coisa", () => {
    expect(CSS).not.toMatch(/^\.faixa-visita\s*\{/m);
  });

  it("⚠⚠ a condição de visita continua NOMEADA na topbar — o risco não sumiu com a faixa", () => {
    // `accountGate.js`: sem marca nenhuma, o visitante lê os números de UMA empresa achando que
    // são os dele. A faixa saiu; a marca ficou, no lugar que não mexe no grid.
    expect(CASCA).toMatch(/visita do escritório/);
    expect(CASCA).toMatch(/ehVisitaDoEscritorio\(user\) \? " · visita do escritório"/);
  });

  it("⚠ a premissa dos dois defeitos: `.app` tem coluna estreita e SÓ DUAS linhas de grid", () => {
    // Quem acrescentar uma filha nova em `.app` cai nos dois defeitos de novo: ou a coluna de
    // 56px (sem `grid-column`), ou a topbar esticada (a terceira filha rouba a linha `1fr`).
    const i = CSS.indexOf(".app {");
    const regra = CSS.slice(i, CSS.indexOf("}", i) + 1);
    expect(regra).toMatch(/grid-template-columns:\s*56px/);
    expect(regra).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  });
});
