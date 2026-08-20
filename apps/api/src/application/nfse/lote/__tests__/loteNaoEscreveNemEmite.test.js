// ⚠⚠ A LEITURA DO LOTE NÃO ESCREVE NADA, NÃO CONSULTA NADA E NÃO EMITE NADA.
//
// Esta é a invariante da fase: *"a leitura não escreve nada — nem tomador, nem nota. Ela classifica
// e devolve."* Um teste de comportamento não a prova (bastaria alguém acrescentar um `import` novo
// amanhã), então a prova é uma **varredura de código-fonte** sobre o diretório inteiro — o mesmo
// molde de `auditoria/__tests__/auditoriaNaoEscreve.test.js` e de `dadosPlanejamento.test.js`.
//
// ⚠⚠ MUDOU EM 20/08/2026: A EMISSÃO EM LOTE PASSOU A EXISTIR, e ela mora neste diretório
// (`emissaoLote.js`). Este teste NÃO foi afrouxado por causa disso — ele foi ESCOPADO:
//
//   • todos os outros arquivos continuam proibidos de tocar banco, escrever ou fazer rede. É a
//     pipeline de LEITURA, e ela não pode virar escritora por um `import` que alguém acrescente;
//   • `emissaoLote.js` é o ÚNICO isento das proibições de escrita — escrever o desfecho de cada
//     linha **no instante em que ele acontece** é a razão de ele existir. Em troca, ele ganhou
//     travas PRÓPRIAS, abaixo: continua sem rede, continua sem importar o `NfseService` (quem
//     emite é INJETADO) e continua sem importar o cliente do Prisma (ele o recebe por parâmetro).

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

/**
 * ⚠ O ÚNICO arquivo autorizado a escrever — nomeado, e não um padrão. Um padrão (`*Emissao*`)
 * isentaria arquivos futuros sem ninguém decidir isso.
 */
const ESCRITOR_AUTORIZADO = "emissaoLote.js";

function arquivosDoModulo({ incluirEscritor = true } = {}) {
  return fs
    .readdirSync(DIRETORIO)
    .filter((nome) => nome.endsWith(".js"))
    .filter((nome) => incluirEscritor || nome !== ESCRITOR_AUTORIZADO)
    .map((nome) => {
      const fonte = fs.readFileSync(path.join(DIRETORIO, nome), "utf-8");
      return { nome, fonte, codigo: semComentarios(fonte) };
    });
}

describe("varredura do código-fonte de `application/nfse/lote/`", () => {
  /** Sem o escritor: é sobre a pipeline de LEITURA que as proibições de banco/escrita valem. */
  const arquivos = arquivosDoModulo({ incluirEscritor: false });
  /** Com ele: as proibições de REDE valem para o diretório inteiro, sem exceção. */
  const todos = arquivosDoModulo();

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
    for (const { nome, codigo } of todos) {
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ AS TRAVAS PRÓPRIAS DO ÚNICO ESCRITOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `emissaoLote.js` está isento da proibição de ESCRITA — é o que ele faz. Não está isento de nada
// mais, e estas travas existem para que a isenção não vire uma porta aberta.
describe("⚠ `emissaoLote.js` — o escritor, e o que ele continua NÃO podendo fazer", () => {
  const fonte = fs.readFileSync(path.join(DIRETORIO, "emissaoLote.js"), "utf-8");
  const codigo = semComentarios(fonte);

  it("existe (se for renomeado, a isenção acima passa a não cobrir ninguém e isto avisa)", () => {
    expect(codigo.length).toBeGreaterThan(500);
  });

  // ⚠⚠ QUEM EMITE É INJETADO. Se este módulo importasse o `NfseService`, todo teste dele passaria a
  // depender de mockar o serviço de emissão — e o dia em que alguém esquecesse, o teste emitiria
  // NOTA FISCAL DE VERDADE. A injeção é o que torna o dublê o caminho natural, não o cuidadoso.
  it("⚠⚠ NÃO importa o `NfseService` — quem emite é injetado", () => {
    expect(/from\s+["'][^"']*NfseService[^"']*["']/i.test(codigo)).toBe(false);
    expect(/NfseService/.test(codigo)).toBe(false);
  });

  // ⚠ Ele recebe o `prisma` por PARÂMETRO. Importar o cliente singleton amarraria o laço ao banco
  // real e tiraria do teste a capacidade de observar a persistência linha a linha.
  it("⚠ NÃO importa o cliente do Prisma — ele o recebe por parâmetro", () => {
    expect(/from\s+["'][^"']*infrastructure\/db\/prisma[^"']*["']/i.test(codigo)).toBe(false);
  });

  // ⚠ Nada de paralelismo: a regra 1 é sequencial, e `Promise.all` sobre as linhas é exatamente o
  // atalho que alguém tentaria para "acelerar o lote".
  it("⚠⚠ NÃO usa `Promise.all`/`allSettled` sobre as linhas — a emissão é SEQUENCIAL", () => {
    expect(/Promise\s*\.\s*(all|allSettled|race|any)\s*\(/.test(codigo)).toBe(false);
  });
});
