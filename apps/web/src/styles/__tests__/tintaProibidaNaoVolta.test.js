// ⚠⚠ A PROIBIÇÃO DO `#6b7280` EXISTIA SÓ EM COMENTÁRIO — E POR ISSO ELA VOLTOU DEZESSEIS VEZES.
//
// Três arquivos deste app já carregam a frase, com o número medido:
//
//   renderCompanyFichaTab.jsx:22  — *"`dim: "#6b7280"` era a cor de TODOS os rótulos e mede 3,10:1"*
//   renderConferenciaTab.jsx:107  — *"`--text-faint` e não `#6b7280`: aquele hex (…) está PROIBIDO"*
//   AdnCapturePanel.jsx:83        — *"o `#6b7280` que pareceria 'mais discreto' está proibido"*
//
// E mesmo assim, em 24/08/2026, havia **16 sites vivos** dele em 8 arquivos, mais **30** de
// `#8A8FA3`. Comentário não é guarda: ele só é lido por quem abre AQUELE arquivo, e quem escreve o
// próximo `color: "#6b7280"` está abrindo outro. Esta varredura é a guarda que faltava.
//
// ⚠⚠ E ELA NÃO COPIA OS NÚMEROS À MÃO. O contraste é CALCULADO aqui, pela fórmula de luminância
// relativa da WCAG 2.1, contra os fundos LIDOS de `tokens.css`. Uma lista de "reprovados" decorada
// teria o mesmo problema que ela quer resolver: envelheceria em silêncio no dia em que o fundo do
// app mudasse.
//
// ⚠ O alvo é TINTA (`color`). Borda e fundo têm outro mínimo (3:1, critério 1.4.11) e não são
// julgados aqui — o que se proíbe é o hex ilegível como TEXTO.

import fs from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..", "..");
const TOKENS = fs.readFileSync(path.join(SRC, "styles", "tokens.css"), "utf8");

/** O valor de uma custom property, lido do arquivo — nunca decorado. */
function token(nome) {
  const m = new RegExp(`--${nome}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS);
  if (!m) throw new Error(`token --${nome} não encontrado em tokens.css`);
  return m[1];
}

/** Luminância relativa — WCAG 2.1, 1.4.3. */
function luminancia(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Os três fundos em que texto de verdade se apoia neste app. */
const FUNDOS = ["bg-page", "bg-subtle", "bg-surface"].map((n) => [n, token(n)]);

/**
 * ⚠⚠ COMENTÁRIO NÃO CONTA — é onde a proibição está escrita. E a primeira versão desta função
 * olhava só o COMEÇO da linha (`//`, `*`, `/*`), o que falhou na hora de rodar: o aviso do
 * `AdnCapturePanel` é um comentário JSX de várias linhas, e a linha do meio — justamente a que cita
 * o hex — não começa com marca nenhuma. Ela foi acusada de violação.
 *
 * Por isso o corte é por BLOCO, preservando a numeração: enquanto estivermos dentro de um comentário
 * de bloco a linha some inteira, e o rabo depois de `//` some sempre.
 *
 * ⚠ Isto NÃO é um parser de JavaScript, e não precisa ser: um `"/*"` dentro de uma string abriria um
 * bloco falso e faria a varredura ver de menos. O modo de falhar é "deixar de acusar", não "acusar
 * errado" — e a linha acima (a que exige que a varredura ache o token de verdade) é quem pega isso.
 */
function semComentarios(fonte) {
  let dentro = false;
  return fonte.split("\n").map((l) => {
    let saida = "";
    let i = 0;
    while (i < l.length) {
      if (dentro) {
        const fim = l.indexOf("*/", i);
        if (fim === -1) return saida;
        dentro = false;
        i = fim + 2;
        continue;
      }
      const abre = l.indexOf("/*", i);
      const linha = l.indexOf("//", i);
      if (linha !== -1 && (abre === -1 || linha < abre)) return saida + l.slice(i, linha);
      if (abre === -1) return saida + l.slice(i);
      saida += l.slice(i, abre);
      dentro = true;
      i = abre + 2;
    }
    return saida;
  });
}

function varrer(hexes) {
  const achados = [];
  const percorrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const alvo = path.join(dir, nome);
      if (fs.statSync(alvo).isDirectory()) {
        if (nome !== "node_modules" && nome !== "__tests__") percorrer(alvo);
        continue;
      }
      if (!/\.(jsx?|css)$/.test(nome)) continue;
      // ⚠ `tokens.css` é o DONO dos valores: é lá que `--success: #69FF47` e `--danger: #FF5757`
      // são escritos, e proibir o hex no arquivo que o define seria proibir a definição. O que a
      // varredura persegue é o hex CRAVADO no componente, longe do nome.
      if (path.relative(SRC, alvo) === path.join("styles", "tokens.css")) continue;
      const linhas = semComentarios(fs.readFileSync(alvo, "utf8"));
      linhas.forEach((l, i) => {
        for (const hex of hexes) {
          if (l.toLowerCase().includes(hex.toLowerCase())) {
            achados.push(`${path.relative(SRC, alvo)}:${i + 1}`);
          }
        }
      });
    }
  };
  percorrer(SRC);
  return achados;
}

describe("⚠⚠ os dois hex que reprovam como TINTA, medidos aqui", () => {
  // ⚠ O `tokens.css` é DONO destes valores: `--danger` e companhia podem citá-los legitimamente. A
  // varredura de código exclui o próprio arquivo de tokens mais abaixo.
  it("`#6b7280` reprova nos TRÊS fundos — é o pior dos dois", () => {
    const medidas = FUNDOS.map(([nome, fundo]) => [nome, contraste("#6b7280", fundo)]);
    for (const [, razao] of medidas) expect(razao).toBeLessThan(4.5);
    // O número que os três comentários do app citam, para eles não envelhecerem sozinhos.
    expect(contraste("#6b7280", token("bg-surface"))).toBeCloseTo(3.1, 1);
  });

  it("`#8A8FA3` passa na página e REPROVA na linha em hover — o caso que engana", () => {
    // É por isso que ele sobreviveu: quem confere olha o fundo da página e aprova.
    expect(contraste("#8A8FA3", token("bg-page"))).toBeGreaterThan(4.5);
    expect(contraste("#8A8FA3", token("bg-subtle"))).toBeLessThan(4.5);
  });

  it("e os dois tokens que os substituem passam em TODOS os fundos", () => {
    for (const alvo of ["text-faint", "text-muted"]) {
      for (const [, fundo] of FUNDOS) {
        expect(contraste(token(alvo), fundo)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("⚠⚠ e eles não voltam ao código", () => {
  it("`#6b7280` não aparece fora de comentário em lugar nenhum", () => {
    expect(varrer(["#6b7280"])).toEqual([]);
  });

  it("`#8A8FA3` não aparece fora de comentário em lugar nenhum", () => {
    // ⚠ Case-insensitive: `#8a8fa3` é o mesmo hex e passaria por uma busca literal.
    expect(varrer(["#8A8FA3"])).toEqual([]);
  });

  it("⚠⚠ `#FF4757` — o vizinho de UM DÍGITO de `--danger`, que reprovava onde o token passa", () => {
    // Ele NÃO é `--danger` (`#FF5757`): mede 4,27:1 sobre `--bg-subtle`, contra 4,58:1 do token.
    // Um dígito de diferença, invisível a olho — e do lado errado da linha da WCAG, justamente na
    // linha da tabela em hover. Eram **103 sites** em 24/08/2026.
    expect(contraste("#FF4757", token("bg-subtle"))).toBeLessThan(4.5);
    expect(contraste(token("danger"), token("bg-subtle"))).toBeGreaterThanOrEqual(4.5);
    // ⚠⚠ A EXCEÇÃO SAIU EM 01/09/2026 — A DÍVIDA FOI PAGA. Ela isentava
    // `renderCalendarioGrid.jsx`, que em 24/08 estava sendo editado por OUTRA SESSÃO nesta mesma
    // árvore; o adiamento tinha esse único motivo, e este teste mandava, por escrito, que *"quem
    // tocar aquele arquivo troca o hex e apaga esta exceção"*. A entrega que pôs a visão de Ano
    // dentro do Calendário tocou o arquivo, então o hex virou `var(--danger)` e o fundo virou o par
    // `--danger-surface` — e a isenção saiu junto, no mesmo commit.
    //
    // ⚠ Não há mais lista de isentos: a varredura é sobre o `src` INTEIRO, sem filtro nenhum. Uma
    // exceção que sobrevive ao conserto vira permissão permanente para o próximo.
    expect(varrer(["#FF4757"])).toEqual([]);
  });

  it("`#69FF47` literal também não volta — ele É `--success`, byte a byte", () => {
    // ⚠ Aqui não há argumento de contraste: o hex e o token são a MESMA cor (13,02:1). O que se
    // ganha é que a cor passa a ter NOME — e nome é o que impede `--state-ok` ("concluído") de ser
    // usado onde o significado é outro, como era o `TIPO_COLOR` do seletor de contas.
    expect(token("success").toUpperCase()).toBe("#69FF47");
    expect(varrer(["#69FF47"])).toEqual([]);
  });

  it("⚠ a varredura VARRE MESMO — se ela vier vazia por engano, este caso cai", () => {
    // Uma cor que o app usa às pantanhas: se nem ela for encontrada, a varredura parou de andar.
    expect(varrer(["var(--text-faint)"]).length).toBeGreaterThan(5);
  });
});
