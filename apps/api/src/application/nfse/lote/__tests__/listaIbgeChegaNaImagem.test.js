// ⚠⚠ O `apps/api` IMPORTA UM PACOTE DO WORKSPACE — E O CONTAINER PRECISA TÊ-LO.
//
// Desde 20/08/2026 o classificador do lote recebe a lista oficial do IBGE, carregada de
// `@contabilidade/shared/municipios-ibge`. Em desenvolvimento isso resolve pelo **symlink de
// workspace** em `node_modules/@contabilidade/shared` — então `npm test` e `npm run build` passam
// VERDES mesmo que o pacote nunca entre na imagem.
//
// ⚠ Dentro do container não há symlink nenhum. Sem `COPY packages/shared`, o `import()` estoura
// `ERR_MODULE_NOT_FOUND` **em runtime** — no primeiro lote do contador, não no deploy. E como o
// carregador devolve `null` em caso de falha (para não derrubar a resposta), o sintoma não seria
// nem um erro na tela: seria **toda linha caindo em `municipio_nao_conferido`** e o lote inteiro
// recusando emitir, sem ninguém entender por quê.
//
// ⚠ O `railway.toml` entra pelo mesmo motivo, com sintoma diferente: sem `packages/**` nos
// `watchPatterns`, atualizar a lista do IBGE não dispara rebuild da API. O container seguiria
// servindo a tabela antiga — e município desatualizado é nota emitida no lugar errado, que é
// exatamente o que a lista existe para impedir.
//
// Este teste é **textual** de propósito: não há como exercitar um `docker build` daqui, e a
// pergunta que ele responde ("o que o código importa chega ao lugar onde ele roda?") não aparece em
// nenhum teste de comportamento.

import fs from "node:fs";
import path from "node:path";

// `__dirname` daqui é `apps/api/src/application/nfse/lote/__tests__`; a raiz do repo está 7 acima.
const RAIZ = path.resolve(__dirname, "../../../../../../..");

const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

/** Linhas do Dockerfile que não são comentário — é sobre elas que a pergunta vale. */
function instrucoes(texto) {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

describe("a lista do IBGE chega ao lugar onde o servidor roda", () => {
  it("⚠ o `apps/api` de fato importa o pacote (se deixar de importar, este arquivo perde a razão)", () => {
    const carregador = ler("apps/api/src/application/nfse/lote/municipiosIbge.js");
    expect(carregador).toContain("@contabilidade/shared/municipios-ibge");
  });

  it("o Dockerfile copia o CÓDIGO do pacote para a imagem", () => {
    const linhas = instrucoes(ler("Dockerfile"));
    expect(linhas).toContain("COPY packages/shared ./packages/shared");
  });

  // ⚠ O `package.json` do pacote tem de chegar ANTES do `npm ci` — é ele que permite ao npm criar
  // o link do workspace. Copiar só o código depois não cria link nenhum, e o import continua
  // falhando dentro do container.
  it("⚠ o `package.json` do pacote é copiado ANTES do `npm ci`", () => {
    const linhas = instrucoes(ler("Dockerfile"));
    const iPkg = linhas.indexOf("COPY packages/shared/package.json ./packages/shared/package.json");
    const iCi = linhas.findIndex((l) => l.startsWith("RUN npm ci"));
    expect(iPkg).toBeGreaterThanOrEqual(0);
    expect(iCi).toBeGreaterThanOrEqual(0);
    expect(iPkg).toBeLessThan(iCi);
  });

  it("o `apps/api` declara a dependência (senão o npm não linka o workspace)", () => {
    const pkg = JSON.parse(ler("apps/api/package.json"));
    expect(pkg.dependencies["@contabilidade/shared"]).toBeDefined();
  });

  it("⚠ o Railway observa `packages/**` — senão atualizar a lista não redeploya a API", () => {
    expect(ler("railway.toml")).toContain('"packages/**"');
  });
});
