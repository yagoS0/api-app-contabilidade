// ⚠⚠ UM `<dl>` SEM COLUNAS PRÓPRIAS É CAPTURADO PELA REGRA GENÉRICA — e o estrago depende do DADO.
//
// Defeito relatado pelo dono em 23/08/2026, com o modal de cancelamento na tela: "Número" e "Valor"
// saíam com UMA LETRA POR LINHA — `1/5/8`, `R/$/1/,/0/0`.
//
// A causa não é uma regra errada; são duas regras certas se atropelando. `app.css` tem, para a
// prévia da emissão (commit `5bd8e464`):
//
//     dl { display: grid; grid-template-columns: 1fr auto; … }
//     dl dd { text-align: right; overflow-wrap: anywhere; … }
//
// e o `.dados-da-nota` do modal declarava `display: grid` e `gap`, mas **nunca**
// `grid-template-columns`. Especificidade não resolve o que não é declarado: sem competição, o
// valor genérico se aplicava. Os quatro pares viravam grade de DUAS colunas — a segunda (`auto`)
// comida pela razão social do tomador, a primeira (`1fr`) colapsada, e o `overflow-wrap: anywhere`
// quebrando o que sobrou letra a letra.
//
// ⚠ POR ISSO ELE SOBREVIVEU: com tomador de nome curto o mesmo bug parecia só um alinhamento
// estranho. O gatilho é o comprimento do nome de quem recebeu a nota.
//
// ⚠ ESTE TESTE LÊ O CSS DE VERDADE, como `guias/__tests__/chipDaGuiaTemCor.test.js` — uma lista
// copiada à mão tem o mesmo problema que ela quer resolver.
//
// ⚠⚠ E ELE VARRE TODO `<dl>` DO APP, não só o que quebrou. O próximo `<dl>` cai na mesma armadilha
// sem que ninguém a conheça: é ela que precisa ficar travada, não o sintoma de hoje.
//
// ⚠ Experimento executado: tirando o `grid-template-columns: 1fr` do `.dados-da-nota`, esta suíte
// fica **2 vermelhos**; devolvendo, 9 verdes.

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(__dirname, "..", "..", "..");
const css = fs.readFileSync(path.join(RAIZ, "styles", "app.css"), "utf8");

/** As classes usadas em `<dl className="…">` em qualquer tela do app. */
function classesDeDl() {
  const achadas = new Set();
  const percorrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const alvo = path.join(dir, nome);
      const st = fs.statSync(alvo);
      if (st.isDirectory()) {
        if (nome !== "__tests__" && nome !== "node_modules") percorrer(alvo);
      } else if (nome.endsWith(".jsx")) {
        const fonte = fs.readFileSync(alvo, "utf8");
        for (const m of fonte.matchAll(/<dl\s+className="([^"]+)"/g)) {
          for (const c of m[1].split(/\s+/).filter(Boolean)) achadas.add(c);
        }
      }
    }
  };
  percorrer(RAIZ);
  return [...achadas];
}

/** O corpo da regra `.classe { … }` no CSS — sem entrar em seletores descendentes. */
function corpoDaRegra(classe) {
  const re = new RegExp(`(^|\\})\\s*\\.${classe}\\s*\\{([^}]*)\\}`, "m");
  return re.exec(css)?.[2] ?? null;
}

describe("⚠⚠ a regra genérica `dl` existe, e é ela que captura", () => {
  it("ela declara mesmo `grid-template-columns` — se sair, este teste inteiro perde o assunto", () => {
    expect(css).toMatch(/^dl\s*\{[^}]*grid-template-columns\s*:/m);
  });

  it("e `dl dd` alinha à direita — o segundo canal da captura", () => {
    expect(css).toMatch(/^dl dd\s*\{[^}]*text-align\s*:\s*right/m);
  });
});

describe("⚠⚠ todo `<dl>` com classe declara as PRÓPRIAS colunas", () => {
  const classes = classesDeDl();

  it("achou os `<dl>` do app — se a varredura vier vazia, ela deixou de varrer", () => {
    expect(classes.length).toBeGreaterThanOrEqual(2);
    expect(classes).toContain("dados-da-nota");
  });

  it.each(classes)("`.%s` declara `grid-template-columns`", (classe) => {
    const corpo = corpoDaRegra(classe);
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(/grid-template-columns\s*:/);
  });

  it.each(classes)("`.%s dd` declara `text-align` — senão herda o `right` do genérico", (classe) => {
    const corpo = corpoDaRegra(`${classe} dd`);
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(/text-align\s*:/);
  });
});

describe("⚠ o conserto do modal de cancelamento, nomeado", () => {
  it("`.dados-da-nota` empilha em UMA coluna — os pares são linhas flex, não colunas de grade", () => {
    expect(corpoDaRegra("dados-da-nota")).toMatch(/grid-template-columns\s*:\s*1fr\s*;/);
  });

  it("e o `dd` volta a alinhar à esquerda, colado ao rótulo", () => {
    expect(corpoDaRegra("dados-da-nota dd")).toMatch(/text-align\s*:\s*left/);
  });
});
