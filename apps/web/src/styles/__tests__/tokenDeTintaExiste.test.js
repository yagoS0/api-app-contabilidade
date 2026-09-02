// ⚠⚠ TOKEN QUE NÃO EXISTE PINTA O TEXTO DE BRANCO — e não deixa erro nenhum.
//
// `color: var(--muted)` com `--muted` INDEFINIDO não é um erro de CSS: a declaração é descartada em
// tempo de valor computado, e o elemento herda a cor do pai. Numa paleta escura o pai é `--text`
// (#F8F8F2, branco), então o texto que era para ser SECUNDÁRIO sai com exatamente o mesmo peso do
// dado principal. O console fica limpo, o build passa, o teste passa — e a hierarquia da tela some.
//
// ⚠⚠ ISSO NÃO É HIPOTÉTICO. Medido no navegador em 01/09/2026, na tela "A lançar":
//
//   `--muted`   — INDEFINIDO, 5 sites em `conferencia/components/PainelDeMexidasDoCliente.jsx`
//   `--text-2`  — INDEFINIDO, 6 sites em `PainelDeSaidasDoCliente.jsx` + 1 em `renderConferenciaTab.jsx`
//
// Renderizado: **10 elementos** que pediam tinta apagada saíam em `rgb(248, 248, 242)` — a mesma
// tinta do valor em reais ao lado. Os nomes eram plausíveis (`--muted` existe em quase todo design
// system; `--text-2` parece o irmão de `--text`), e é isso que os torna invisíveis na revisão.
//
// ⚠ A varredura é sobre `src` INTEIRO, sem lista de isentos — pela mesma razão escrita em
// `tintaProibidaNaoVolta.test.js`: exceção que sobrevive ao conserto vira permissão para o próximo.
//
// ⚠ O alvo é TINTA (`color:`). Fundo e borda ficam de fora porque o modo de falhar deles é outro
// (transparente / sem borda), e porque a regra da casa que este teste guarda fala de tinta.

import fs from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..", "..");

/**
 * Os nomes que o CSS de fato DEFINE. Os três arquivos, e não só `tokens.css`: `App.css` e
 * `index.css` também declaram custom properties, e proibir o que eles definem seria acusar o certo.
 */
function definidos() {
  const nomes = new Set();
  for (const arquivo of ["styles/tokens.css", "App.css", "index.css"]) {
    const alvo = path.join(SRC, arquivo);
    if (!fs.existsSync(alvo)) continue;
    for (const m of fs.readFileSync(alvo, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/gi)) nomes.add(m[1]);
  }
  return nomes;
}

/**
 * Todo `color: var(--algo)` do código, com arquivo e linha.
 *
 * ⚠ Só a PRIMEIRA custom property da declaração é julgada, de propósito: em `var(--a, var(--b))` o
 * `--b` é a rede, e uma rede que não existe não é o defeito — o defeito é a primeira não existir.
 */
function tintasUsadas() {
  const achados = [];
  const percorrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const alvo = path.join(dir, nome);
      if (fs.statSync(alvo).isDirectory()) {
        if (nome !== "node_modules" && nome !== "__tests__") percorrer(alvo);
        continue;
      }
      if (!/\.jsx?$/.test(nome)) continue;
      fs.readFileSync(alvo, "utf8").split("\n").forEach((linha, i) => {
        for (const m of linha.matchAll(/color:\s*[`"']?\s*var\((--[a-z0-9-]+)/gi)) {
          achados.push({ token: m[1], onde: `${path.relative(SRC, alvo)}:${i + 1}` });
        }
      });
    }
  };
  percorrer(SRC);
  return achados;
}

describe("⚠⚠ tinta pedida por um token que o CSS não define", () => {
  it("a varredura VARRE MESMO — se ela vier vazia por engano, este caso cai", () => {
    // Sem esta linha, um regex que deixou de casar faria o teste abaixo passar por não achar nada.
    expect(tintasUsadas().length).toBeGreaterThan(50);
    expect(definidos().has("--text-muted")).toBe(true);
  });

  it("nenhum componente pinta texto com uma custom property inexistente", () => {
    const def = definidos();
    const orfaos = tintasUsadas()
      .filter((u) => !def.has(u.token))
      .map((u) => `${u.onde} usa ${u.token}`);
    expect(orfaos).toEqual([]);
  });

  it("⚠ e os dois que já quebraram continuam sem definição — o conserto foi no USO, não no CSS", () => {
    // Definir `--muted` e `--text-2` "para consertar" criaria dois sinônimos de `--text-muted`, e
    // três nomes para a mesma tinta é como a paleta volta a ter 841 valores.
    const def = definidos();
    expect(def.has("--muted")).toBe(false);
    expect(def.has("--text-2")).toBe(false);
  });
});
