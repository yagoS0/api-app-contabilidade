// ⚠ ESTE ARQUIVO É A CÓPIA DELIBERADA DE `apps/web/babel.config.js`, E A RAZÃO É A MESMA.
//
// `import.meta.env` é sintaxe de módulo ES: o Jest roda em CommonJS e quebra em tempo de PARSE
// ("Cannot use 'import.meta' outside a module") — o arquivo inteiro morre antes do primeiro teste.
// Quem paga não é quem escreve `import.meta`, é quem IMPORTA. Neste app os dois pontos são
// `src/api/index.js` (`VITE_API_MODE`) e `src/api/real/realApi.js` (`VITE_API_BASE_URL`), e
// `features/emitir/EmitirNotaPage.jsx` importa `../../api` — ou seja, o teste de LIGAÇÃO da tela de
// emissão cairia antes do primeiro `expect`, e a mensagem não apontaria para a tela.
//
// Resolvido na raiz, e não com mock em cada suíte: reescrever `import.meta.env` → `process.env` no
// ambiente de teste não obriga nenhum teste novo a lembrar de uma regra.
// Só no env `test` — no build quem substitui é o Vite, e `process` não existe no browser.
function transformImportMetaEnv() {
  return {
    name: "transform-import-meta-env",
    visitor: {
      MetaProperty(path) {
        const { node, parentPath } = path;
        if (node.meta?.name !== "import" || node.property?.name !== "meta") return;
        // `import.meta.env` → `process.env`; qualquer outro uso de `import.meta` continua um erro
        // legítimo, e é melhor que ele apareça do que ser mascarado aqui.
        if (!parentPath.isMemberExpression() || parentPath.node.property?.name !== "env") return;
        parentPath.replaceWithSourceString("process.env");
      },
    },
  };
}

export default {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    ["@babel/preset-react", { runtime: "automatic" }],
  ],
  env: {
    test: {
      plugins: [transformImportMetaEnv],
    },
  },
};
