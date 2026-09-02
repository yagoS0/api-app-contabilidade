// ⚠⚠ `var(--text-2)` VIVEU DIAS NESTE APP SEM QUE NADA ACUSASSE — nem o build, nem o lint, nem o
// navegador. Custom property que não existe não é ERRO de CSS: a declaração inteira é descartada em
// tempo de VALOR COMPUTADO, e a propriedade cai no herdado. `color` vira o `--text` do pai,
// `border-color` vira `currentColor`. A tela abre, o `npm run build` passa, e o que se perde é a
// HIERARQUIA — a frase explicativa sai com o mesmo peso do dado ao lado dela.
//
// Foram QUATRO sites aqui (`.fluxo-v3-voltar`, `.fluxo-v4-mes`, `.btn-alternador[aria-pressed]`,
// `.dre-nc-valor`), dois deles texto que o CLIENTE lê, e mais SETE no portal do escritório. Nenhum
// apareceu em nenhum teste, porque testar cor exige `getComputedStyle` num navegador de verdade —
// e é exatamente por isso que a guarda tem de ser uma VARREDURA DE TEXTO, não um teste de render.
//
// ⚠ É a mesma lição que `apps/web/src/styles/__tests__/tintaProibidaNaoVolta.test.js` já tinha
// escrito no cabeçalho: *"Comentário não é guarda: ele só é lido por quem abre AQUELE arquivo, e
// quem escreve o próximo está abrindo outro."*
//
// ⚠ O QUE ESTA GUARDA **NÃO** JULGA: `var(--x, algumaCoisa)`. Um `var()` com fallback não falha em
// silêncio — ele cai no valor que o autor escreveu ali, à vista. O defeito perseguido aqui é o
// `var()` NU sobre um nome que ninguém definiu.
//
// ⚠ E ela não decora a lista de tokens: as definições são LIDAS da árvore, então um token novo
// passa a valer no instante em que é escrito, sem ninguém precisar lembrar deste arquivo.

import fs from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..", "..");

/**
 * ⚠ Percorre `src/` inteiro, e não só `styles/`: neste app a cor entra por `styles/app.css`, mas
 * `style={{ color: "var(--…)" }}` inline em componente é igualmente comum — foi assim que os sete
 * órfãos do portal do escritório nasceram.
 *
 * ⚠ `__tests__` fica DE FORA dos dois lados (uso e definição). Teste que fala SOBRE tokens escreve
 * `var(--token)` em prosa, e uma varredura que o lesse acusaria o próprio vocabulário do teste.
 */
function arquivos() {
  const achados = [];
  const percorrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const alvo = path.join(dir, nome);
      if (fs.statSync(alvo).isDirectory()) {
        if (nome !== "node_modules" && nome !== "__tests__") percorrer(alvo);
        continue;
      }
      if (/\.(jsx?|css)$/.test(nome)) achados.push(alvo);
    }
  };
  percorrer(SRC);
  return achados;
}

/** Todo nome que alguém DEFINE — em `tokens.css`, num `:root` de outro arquivo, ou inline. */
function definidos() {
  const nomes = new Set();
  for (const alvo of arquivos()) {
    const txt = fs.readFileSync(alvo, "utf8");
    for (const m of txt.matchAll(/(?:^|[\s;{"'`,])(--[a-zA-Z0-9_-]+)\s*:/g)) nomes.add(m[1]);
  }
  return nomes;
}

/** Todo `var(--x)` SEM fallback, com o site onde apareceu. */
function usadosNus() {
  const mapa = new Map();
  for (const alvo of arquivos()) {
    fs.readFileSync(alvo, "utf8").split("\n").forEach((linha, i) => {
      for (const m of linha.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(,)?/g)) {
        if (m[2]) continue; // tem fallback — falha à vista, não em silêncio
        if (!mapa.has(m[1])) mapa.set(m[1], []);
        mapa.get(m[1]).push(`${path.relative(SRC, alvo)}:${i + 1}`);
      }
    });
  }
  return mapa;
}

function orfaos() {
  const tem = definidos();
  return [...usadosNus()]
    .filter(([nome]) => !tem.has(nome))
    .map(([nome, sites]) => `${nome} (${sites.length}x) — ${sites.join(", ")}`);
}

describe("⚠⚠ nenhum `var(--x)` nu aponta para um token que não existe", () => {
  it("a varredura VARRE MESMO — se ela vier vazia por engano, este caso cai", () => {
    // Sem esta linha, um bug na leitura da árvore faria a guarda passar dizendo "nada errado".
    expect(usadosNus().size).toBeGreaterThan(30);
    expect(definidos().has("--muted")).toBe(true);
    expect(definidos().has("--ciano")).toBe(true);
  });

  it("`--text-2` não volta — ele nunca existiu neste app", () => {
    // O nome do defeito, preso pelo nome. `--muted` (#5f6773) é quem faz esse papel aqui:
    // 5,72:1 sobre `--surface`, 5,33:1 sobre `--bg`, 5,10:1 sobre `--neutral-surface`.
    expect(definidos().has("--text-2")).toBe(false);
    expect(usadosNus().has("--text-2")).toBe(false);
  });

  it("e nenhum outro nome órfão sobrou", () => {
    expect(orfaos()).toEqual([]);
  });
});
