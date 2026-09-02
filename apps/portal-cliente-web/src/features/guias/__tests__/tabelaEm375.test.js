// ⚠⚠ A ABA GUIAS EM 375px — dois defeitos medidos NO NAVEGADOR, com a suíte inteira verde
// (31/08/2026, teste de usabilidade).
//
// Varredura do CSS, e ela tem de ser: os dois defeitos são de LAYOUT, e o jsdom não faz layout —
// `getBoundingClientRect` devolve zero para tudo. Um teste de comportamento aqui passaria com a
// página rolando para o lado. O que dá para provar em teste é que a REGRA continua no arquivo; o
// número saiu do navegador e está escrito abaixo.

import fs from "node:fs";
import path from "node:path";

// ⚠ `__dirname` e não `import.meta` — o jest desta casa transpila para CJS.
const CSS = fs.readFileSync(path.join(__dirname, "../../../styles/app.css"), "utf8");
const FONTE_PAGINA = fs.readFileSync(path.join(__dirname, "../GuiasPage.jsx"), "utf8");

describe("⚠⚠ a PÁGINA não rola para o lado — só a tabela rola", () => {
  /**
   * Medido em 375px: `documentElement.scrollWidth` era **549** numa tela de 375. A tabela estava
   * contida; quem escapava era um `.sr-only` **dentro** dela — `position: absolute` sem ancestral
   * posicionado se ancora fora do contêiner de rolagem, e ele ficava em `left: 548px`.
   *
   * ⚠ O achado é do anúncio do `BotaoCopiar`, acrescentado no mesmo dia — mas o conserto é do
   * CONTÊINER, não daquele `<span>`: qualquer absoluto que entre numa tabela daqui em diante cai
   * na mesma armadilha.
   */
  it("`.table-wrap` é `position: relative` — é o que contém os absolutos de dentro", () => {
    const regra = CSS.match(/^\.table-wrap \{[^}]*\}/m)?.[0] || "";
    expect(regra).toMatch(/position:\s*relative/);
    // ⚠ E continua rolando no horizontal: é assim que a tabela larga cabe em 375px sem sumir com
    // coluna nenhuma. Sem isso, a página volta a rolar — o defeito que este bloco existe para não ter.
    expect(regra).toMatch(/overflow-x:\s*auto/);
  });
});

describe("⚠⚠ a linha da guia não vira um parágrafo em tela estreita", () => {
  /**
   * Medido em 375px, na competência "Todas" (18 guias):
   *
   * |                          | antes | depois |
   * |--------------------------|-------|--------|
   * | altura da tabela         | 2.881 | 2.271  |
   * | linha mais alta          |   228 |    170 |
   * | largura (rolagem lateral)|   720 |    795 |
   *
   * ⚠ O que inflava era TEXTO estrangulado: a coluna da linha digitável a 121px quebrava a frase
   * da ausência em oito linhas, e a de ações a 120px fazia o mesmo com *"Seu contador ainda não
   * liberou esta guia…"*. As duas frases FICAM — sem elas o cliente não sabe por que não há número
   * nem por que o botão está desabilitado. O que mudou foi elas terem onde caber.
   *
   * ⚠ A FORMA da tabela em tela estreita (virar cartões, esconder colunas) NÃO foi mexida: forma
   * de tela é decisão do dono, e ele já reverteu desenho mais de uma vez nesta base.
   */
  it("a tabela de guias é nomeada, senão o piso não alcança nada", () => {
    expect(FONTE_PAGINA).toMatch(/className="table tabela-guias"/);
  });

  it("as duas colunas de TEXTO têm piso de largura", () => {
    expect(CSS).toMatch(/\.tabela-guias td:nth-child\(6\)[\s\S]{0,80}min-width:\s*\d+ch/);
    expect(CSS).toMatch(/\.tabela-guias td:nth-child\(7\)[\s\S]{0,80}min-width:\s*\d+ch/);
  });

  it("⚠ o piso é em `ch` — a medida do caractere, porque o que transborda é texto", () => {
    const pisos = CSS.match(/\.tabela-guias [^{]*\{\s*min-width:\s*[^;]+;/g) || [];
    expect(pisos.length).toBeGreaterThanOrEqual(2);
    for (const p of pisos) expect(p).toMatch(/\d+ch/);
  });

  it("⚠⚠ e NENHUMA coluna foi escondida para caber — nem em `display: none`, nem por largura zero", () => {
    // Coluna de guia que some é dívida com a Receita que some da tela de quem paga: o pior
    // desfecho possível desta aba, e a razão de o conserto ser por largura e não por supressão.
    expect(CSS).not.toMatch(/\.tabela-guias[^{]*\{[^}]*display:\s*none/);
    expect(CSS).not.toMatch(/\.tabela-guias[^{]*\{[^}]*width:\s*0/);
  });
});
