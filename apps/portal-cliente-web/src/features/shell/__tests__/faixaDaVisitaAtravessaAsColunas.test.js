// ⚠⚠ A FAIXA DA VISITA CAIU NA COLUNA DE 56px — DEFEITO SUBIDO EM PRODUÇÃO (31/08/2026).
//
// Relatado pelo dono no mesmo dia, com o print: a faixa apareceu como uma **coluna de uma palavra
// por linha**, ~24px de texto e ~560px de altura, empurrando a tela inteira para baixo.
//
// A causa é de uma linha: `.app` é `grid-template-columns: 56px minmax(0, 1fr)` — a primeira
// coluna é a BARRA DE ÍCONES. Quem atravessa as duas colunas precisa DIZER isso, e a `.topbar` diz
// (`.app > .topbar { grid-column: 1 / -1 }`). A faixa nasceu sem, e caiu na coluna estreita.
//
// ⚠⚠ POR QUE PASSOU: a faixa **só existe para o usuário de VISITA** (`ehVisitaDoEscritorio`), e
// toda a conferência daquela entrega foi feita com a conta de CLIENTE, que não a renderiza. É a
// mesma família do "mock esconde ramo" que este projeto já registra sete vezes — ramo que ninguém
// abre é ramo que ninguém vê. **Abrir a conta de visita no navegador virou parte de mexer aqui.**
//
// Varredura do CSS, e tem de ser: o jsdom não faz layout — `getBoundingClientRect` devolve zero
// para tudo, e um teste de render passaria com a faixa espremida. O número saiu do navegador.

import fs from "node:fs";
import path from "node:path";

// ⚠ `__dirname` e não `import.meta` — o jest desta casa transpila para CJS.
const CSS = fs.readFileSync(path.join(__dirname, "../../../styles/app.css"), "utf8");

/** O bloco de uma regra, do seletor até a chave de fechamento. */
function regra(seletor) {
  const i = CSS.indexOf(seletor);
  if (i === -1) return "";
  return CSS.slice(i, CSS.indexOf("}", i) + 1);
}

describe("⚠⚠ tudo que é filho direto de `.app` e atravessa a tela precisa DIZER isso", () => {
  it("a premissa: `.app` tem uma primeira coluna ESTREITA (a barra de ícones)", () => {
    // Se esta regra mudar, o defeito muda de forma — e os casos abaixo passam a proteger outra coisa.
    expect(regra(".app {")).toMatch(/grid-template-columns:\s*56px/);
  });

  it("⚠⚠ a FAIXA DA VISITA atravessa as duas colunas", () => {
    // Sem isto ela mede ~24px de texto e ~560px de altura. Medido no navegador em 1265px:
    // largura 1265 e altura 35 — a mesma largura da topbar.
    expect(regra(".faixa-visita {")).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it("⚠ e a TOPBAR continua atravessando — era ela que já dizia certo", () => {
    expect(CSS).toMatch(/\.app > \.topbar \{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });
});
