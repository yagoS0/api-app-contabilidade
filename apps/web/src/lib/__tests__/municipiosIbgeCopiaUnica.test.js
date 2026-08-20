// ⚠⚠ A TABELA DO IBGE É UMA CÓPIA SÓ — e este teste existe para ela não ressuscitar.
//
// Até 20/08/2026 `municipiosIbge.data.js` existia DUAS vezes (`apps/web` e
// `apps/portal-cliente-web`, 5.571 linhas cada), e o cabeçalho das duas mandava "regenerou uma,
// regenere a outra". O dono decidiu mover para `packages/shared`; mover ELIMINA cópias (de duas
// para uma) e por isso não reabre a recusa de 19/08/2026, que foi contra ACRESCENTAR uma terceira.
//
// ⚠ O QUE ESTE TESTE PROTEGE, e por que ele não é decoração: a lista se atualiza por um
// procedimento MANUAL (curl + regravar o arquivo — está no cabeçalho do próprio dado). Não há
// gerador para ela. Então nada impede alguém de, ao atualizar, recriar o arquivo no lugar antigo:
// os dois portais continuariam compilando, os dois continuariam com testes verdes, e a divergência
// só apareceria como **nota emitida no município errado** — silenciosa e cara, que é exatamente o
// que a lista existe para impedir.
//
// ⚠ NÃO CONFUNDIR COM `servicosNacionais.data.js`: aquela tabela CONTINUA em duas cópias, escrita
// nos dois portais por `apps/api/scripts/gerar-lista-servico-nacional.mjs`. São tabelas diferentes,
// e consolidar uma não consolidou a outra.

import fs from "node:fs";
import path from "node:path";

// `__dirname` daqui é `apps/web/src/lib/__tests__`; a raiz do repo está cinco níveis acima.
const RAIZ = path.resolve(__dirname, "../../../../..");

const LUGARES_ANTIGOS = [
  "apps/web/src/lib/municipios/municipiosIbge.data.js",
  "apps/portal-cliente-web/src/lib/municipios/municipiosIbge.data.js",
];

const LUGAR_UNICO = "packages/shared/src/municipios/municipiosIbge.data.js";

describe("a lista do IBGE tem UMA cópia só", () => {
  it("o arquivo existe no pacote compartilhado", () => {
    expect(fs.existsSync(path.join(RAIZ, LUGAR_UNICO))).toBe(true);
  });

  it.each(LUGARES_ANTIGOS)("não voltou a existir em %s", (relativo) => {
    expect(fs.existsSync(path.join(RAIZ, relativo))).toBe(false);
  });

  // ⚠ O `exports` do pacote é o que faz `@contabilidade/shared/municipios-ibge` resolver. Sem o
  // subcaminho declarado, o import quebra em tempo de execução nos DOIS portais — e o build de um
  // app Vite falharia, mas só de quem for buildado.
  it("o pacote declara o subcaminho `./municipios-ibge`", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(RAIZ, "packages/shared/package.json"), "utf8")
    );
    expect(pkg.exports["./municipios-ibge"]).toBe("./src/municipios/municipiosIbge.data.js");
  });

  // ⚠⚠ O `import()` DINÂMICO é o que mantém as ~197 KB fora do bundle inicial dos dois portais
  // (medido: chunk próprio `municipiosIbge.data-*.js` nos dois `dist/`). Um `import` estático no
  // topo de qualquer um dos pontos de entrada jogaria a tabela inteira na primeira tela que
  // importasse QUALQUER função daqui, e **nenhum teste cairia** — o sintoma seria só o login
  // ficando mais lento. Por isso a trava é textual.
  it.each([
    "apps/web/src/lib/municipios/municipioIbge.js",
    "apps/portal-cliente-web/src/lib/municipios/municipioIbge.js",
  ])("%s carrega a lista por import() dinâmico", (relativo) => {
    const fonte = fs.readFileSync(path.join(RAIZ, relativo), "utf8");
    expect(fonte).toContain('import("@contabilidade/shared/municipios-ibge")');
    // Nenhum import ESTÁTICO do pacote no topo do arquivo.
    expect(fonte).not.toMatch(/^\s*import\s[^(]*["']@contabilidade\/shared/m);
  });
});
