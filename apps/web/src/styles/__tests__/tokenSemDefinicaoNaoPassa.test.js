// ⚠⚠ `var(--text-2)` VIVEU DIAS NOS DOIS PORTAIS SEM QUE NADA ACUSASSE — nem o build, nem o lint,
// nem o navegador. Custom property que não existe não é ERRO de CSS: a declaração inteira é
// descartada em tempo de VALOR COMPUTADO, e a propriedade cai no herdado. `color` vira o `--text`
// do pai, `border-color` vira `currentColor`, `background` vira TRANSPARENTE. A tela abre, o
// `npm run build` passa, e o que se perde é a HIERARQUIA.
//
// Foram SETE sites aqui — todos na aba Conferência, todos frases explicativas que saíam com a
// tinta cheia, indistinguíveis do título ao lado. Medido no navegador em 30/08/2026:
// `--text-2` resolvia para `""` e a frase *"Confirmar aqui não lança nada"* computava
// `rgb(248,248,242)` (`--text`) em vez de `rgb(174,182,211)` (`--text-muted`).
//
// ⚠ É a mesma lição que o `tintaProibidaNaoVolta.test.js` ao lado já tinha escrito: *"Comentário
// não é guarda: ele só é lido por quem abre AQUELE arquivo, e quem escreve o próximo está abrindo
// outro."* Este arquivo é a irmã dele — lá o alvo é o hex CRAVADO, aqui é o NOME que não existe.
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
 * ⚠⚠ UMA EXCEÇÃO, E ELA É DECLARADA, MEDIDA E TEMPORÁRIA: `--surface`.
 *
 * Ele é o nome do PORTAL DO CLIENTE (`apps/portal-cliente-web/src/styles/tokens.css`). Aqui o token
 * chama `--bg-surface`, e o vocabulário do outro app entrou junto com as features `conferencia` e
 * `recorrencia`. Como `background-color` inválido cai em TRANSPARENTE, os cards ficam vazados sobre
 * o `--bg-page`. Medido no navegador em 30/08/2026, na aba Conferência de UMA empresa: **29
 * elementos vivos** com `background-color: rgba(0, 0, 0, 0)` onde se queria `#24253A`.
 *
 * ⚠ NÃO foi consertado junto do `--text-2` de propósito: trocar `--surface` por `--bg-surface` faz
 * 29 cards GANHAREM fundo de uma vez, o que é mudança de aparência de uma tela que ninguém pediu
 * para mexer. É decisão do dono, como foi a do `--text-2`.
 *
 * ⚠ A exceção é por NOME, sem site: prender a linha faria este teste ficar vermelho a cada edição
 * dos arquivos vizinhos, e teste que fica vermelho por motivo errado é teste que alguém desliga.
 */
const ADIADOS = ["--surface"];

/**
 * ⚠ Percorre `src/` inteiro, e não só `styles/`: neste app quase toda cor entra por
 * `style={{ color: "var(--…)" }}` inline em componente — foi assim que os sete órfãos nasceram.
 *
 * ⚠ `__tests__` fica DE FORA dos dois lados (uso e definição). Teste que fala SOBRE tokens escreve
 * `var(--token)` em prosa — `features/onboarding/lib/__tests__/onboardingStatus.test.js:63` faz
 * exatamente isso —, e uma varredura que o lesse acusaria o próprio vocabulário do teste.
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
    expect(definidos().has("--text-muted")).toBe(true);
    expect(definidos().has("--bg-surface")).toBe(true);
  });

  it("`--text-2` não volta — ele nunca existiu neste app", () => {
    // O nome do defeito, preso pelo nome. `--text-muted` (#aeb6d3) é quem faz esse papel aqui, e a
    // própria feature já separava frase de rótulo: `--text-muted` para frase (7,45:1 sobre
    // `--bg-surface`), `--text-faint` para CNPJ, traço e etiqueta curta.
    expect(definidos().has("--text-2")).toBe(false);
    expect(usadosNus().has("--text-2")).toBe(false);
  });

  it("⚠ só `--surface` continua órfão, e ele está NOMEADO acima", () => {
    const fora = orfaos().filter((a) => !ADIADOS.some((n) => a.startsWith(`${n} (`)));
    expect(fora).toEqual([]);
  });

  it("⚠ e o adiado precisa continuar EXISTINDO — se sumir sozinho, esta exceção sai junto", () => {
    // Sem esta linha, o dia em que alguém consertar o `--surface` deixaria para trás uma exceção
    // protegendo um caso que não há — e a próxima importação de vocabulário alheio entraria por ela.
    expect(usadosNus().has("--surface")).toBe(true);
    expect(definidos().has("--surface")).toBe(false);
  });
});
