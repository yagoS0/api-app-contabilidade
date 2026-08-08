// `import.meta.env` é sintaxe de módulo ES: o Jest roda em CommonJS e quebra em tempo de PARSE
// ("Cannot use 'import.meta' outside a module") — o arquivo inteiro morre antes do primeiro teste.
// Quem paga por isso não é quem escreve `import.meta`, é quem importa (`src/api/client.js` derrubava
// qualquer suíte que chegasse nele por transitividade). Reescrever para `process.env` no ambiente de
// teste resolve na raiz e não obriga cada teste novo a lembrar de um mock.
// Só no env `test` — no build o Vite faz a substituição dele, e `process` não existe no browser.
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
