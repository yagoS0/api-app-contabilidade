// ⚠⚠ A LEITURA DO LOTE NÃO ESCREVE NADA, NÃO CONSULTA NADA E NÃO EMITE NADA.
//
// Esta é a invariante da fase: *"a leitura não escreve nada — nem tomador, nem nota. Ela classifica
// e devolve."* Um teste de comportamento não a prova (bastaria alguém acrescentar um `import` novo
// amanhã), então a prova é uma **varredura de código-fonte** sobre o diretório inteiro — o mesmo
// molde de `auditoria/__tests__/auditoriaNaoEscreve.test.js` e de `dadosPlanejamento.test.js`.
//
// ⚠ A emissão em lote é FASE SEGUINTE. Nada deste diretório fala com o ADN, com o SERPRO nem com
// homologação, e nada dele grava uma linha sequer.

import fs from "node:fs";
import path from "node:path";

// ⚠ `__dirname`, e não `import.meta.url`: o jest deste projeto transpila os testes para CJS
// (babel-jest), e `import.meta` é erro de sintaxe ali. É o mesmo caminho de
// `auditoria/__tests__/auditoriaNaoEscreve.test.js`.
const DIRETORIO = path.resolve(__dirname, "..");

/**
 * ⚠ A VARREDURA OLHA O CÓDIGO, NÃO O TEXTO. Os comentários deste módulo dizem repetidamente que
 * nada emite e citam a BrasilAPI para explicar por que a consulta NÃO mora aqui — casar com eles
 * reprovaria os arquivos justamente por afirmarem a invariante que o teste protege.
 *
 * ⚠ Limite conhecido: o corte de `//` também corta o miolo de uma URL dentro de string. Isso só
 * produz falso NEGATIVO (deixa de acusar), nunca falso positivo — e a direção segura é esta.
 */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function arquivosDoModulo() {
  return fs
    .readdirSync(DIRETORIO)
    .filter((nome) => nome.endsWith(".js"))
    .map((nome) => {
      const fonte = fs.readFileSync(path.join(DIRETORIO, nome), "utf-8");
      return { nome, fonte, codigo: semComentarios(fonte) };
    });
}

describe("varredura do código-fonte de `application/nfse/lote/`", () => {
  const arquivos = arquivosDoModulo();

  it("há arquivos a varrer (a varredura não pode passar por estar vazia)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(5);
  });

  it("⚠ nenhum arquivo importa o Prisma — a leitura não lê nem escreve banco", () => {
    for (const { nome, codigo } of arquivos) {
      expect({ nome, tem: /from\s+["'][^"']*prisma[^"']*["']/i.test(codigo) }).toEqual({ nome, tem: false });
      expect({ nome, tem: /\bprisma\s*\./.test(codigo) }).toEqual({ nome, tem: false });
    }
  });

  it("⚠ nenhum arquivo escreve: sem `create`, `update`, `upsert`, `delete` ou `$transaction`", () => {
    for (const { nome, codigo } of arquivos) {
      const escritas = codigo.match(
        /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$transaction/g
      );
      expect({ nome, escritas: escritas || [] }).toEqual({ nome, escritas: [] });
    }
  });

  it("⚠⚠ nenhum arquivo faz chamada de rede — sem axios, fetch, http ou BrasilAPI", () => {
    for (const { nome, codigo } of arquivos) {
      expect({ nome, tem: /\baxios\b|\bfetch\s*\(|from\s+["']node:https?["']|brasilapi/i.test(codigo) }).toEqual({
        nome,
        tem: false,
      });
    }
  });

  it("⚠⚠ nada aqui emite, cancela ou transmite — nenhuma menção ao caminho do ato fiscal", () => {
    for (const { nome, codigo } of arquivos) {
      expect({ nome, tem: /NfseService|sendEvent|dpsXmlGZipB64|buildDpsXml|NfseRepository/.test(codigo) }).toEqual({
        nome,
        tem: false,
      });
    }
  });

  it("⚠ o classificador é PURO: não lê relógio nem sorteia", () => {
    const puro = arquivos.find((a) => a.nome === "classificarLinhaLote.js");
    expect(puro).toBeDefined();
    expect(/Date\.now|new Date\(\)|Math\.random/.test(puro.codigo)).toBe(false);
  });
});
