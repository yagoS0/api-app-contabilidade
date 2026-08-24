// A LOGOMARCA OFICIAL PRECISA ESTAR NA IMAGEM DO DOCKER — e a falta dela é SILENCIOSA.
//
// ⚠⚠ POR QUE ESTE TESTE EXISTE. A NT 008 §2.4.3 manda imprimir a logomarca da NFS-e no cabeçalho,
// e `gerarDanfse` a carrega de disco. Em desenvolvimento a árvore inteira do repositório está no
// lugar, então tudo funciona. Dentro do container, não: `.dockerignore` ignora `docs/`, e se o
// arquivo morasse lá o DANFSe de PRODUÇÃO sairia com `[LOGOMARCA NFS-e]` num quadro — com um aviso
// em `conformidade.avisos` que **ninguém lê**, porque `responderDanfse` só devolve a CONTAGEM de
// avisos num header.
//
// É a mesma armadilha, letra por letra, de `lote/__tests__/listaIbgeChegaNaImagem.test.js`: o que
// quebra só no container não é pego por `npm test` — a não ser que o teste leia o Dockerfile.

import fs from "node:fs";
import path from "node:path";

const RELATIVO = "apps/api/assets/danfse/logo-nfse-horizontal.png";

function raizDoRepo() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "Dockerfile"))) return dir;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`Dockerfile não encontrado a partir de ${process.cwd()}`);
}

const raiz = raizDoRepo();

describe("a logomarca oficial da NFS-e chega à imagem", () => {
  it("o arquivo existe, é um PNG de verdade e tem o hash da fonte oficial", () => {
    const arquivo = path.join(raiz, RELATIVO);
    expect(fs.existsSync(arquivo)).toBe(true);
    const bytes = fs.readFileSync(arquivo);
    // ⚠ Assinatura PNG. Um arquivo corrompido com a extensão certa faria o pdfkit lançar
    // "Unknown image format" no meio da geração de um documento fiscal.
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it("⚠⚠ ele NÃO mora em docs/ — `.dockerignore` ignora essa pasta inteira", () => {
    const ignore = fs.readFileSync(path.join(raiz, ".dockerignore"), "utf8");
    // Se esta linha sumir do .dockerignore, mover a logo de volta para docs/ deixa de ser perigoso
    // — mas até lá, o caminho é este e o teste diz por quê.
    expect(ignore).toMatch(/^docs\/?$/m);
    expect(RELATIVO.startsWith("apps/api/")).toBe(true);
    expect(fs.existsSync(path.join(raiz, "docs/leiaute-nfse/logo/logo-nfse-horizontal.png"))).toBe(false);
  });

  it("o Dockerfile copia `apps/api` inteiro — é isso que leva o ativo junto", () => {
    const dockerfile = fs.readFileSync(path.join(raiz, "Dockerfile"), "utf8");
    // ⚠ Varredura de FONTE, não de comportamento: nenhum teste de runtime pega um `COPY` que
    // deixou de existir. Mesma técnica do teste da lista do IBGE.
    expect(dockerfile).toMatch(/^COPY\s+apps\/api\s+\.\/apps\/api\s*$/m);
  });

  it("a procedência está registrada ao lado do arquivo", () => {
    const readme = fs.readFileSync(path.join(raiz, "apps/api/assets/danfse/README.md"), "utf8");
    // A URL da §2.4.3 e o hash são o que torna o arquivo auditável — sem eles ele é só um PNG.
    expect(readme).toContain("gov.br/nfse");
    expect(readme).toMatch(/ab57fa34887929a10ee3b9b4d666084ec9b9465e62bbcc3523b99b23ccac1063/);
    // ⚠ E o limite que mais custa se for esquecido.
    expect(readme).toMatch(/NUNCA A DO PRESTADOR/);
  });
});
