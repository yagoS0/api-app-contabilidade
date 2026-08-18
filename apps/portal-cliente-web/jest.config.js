// ⚠ MESMO HARNESS DE `apps/web/jest.config.js` — de propósito, e sem uma linha a mais. Um segundo
// jeito de testar dentro do mesmo monorepo é um jeito a mais de esquecer de rodar.
//
// ⚠ O `import.meta.env` NÃO é tratado aqui: ele morre em tempo de PARSE, antes de qualquer
// configuração de teste. Quem resolve é o `babel.config.js` ao lado — ver o cabeçalho de lá.
//
// ⚠ O mapeamento de CSS é o de `apps/web`, letra por letra, e hoje é INERTE nos dois apps: nenhum
// teste importa CSS (só `src/main.jsx` importa `styles/app.css`, e ele não entra em teste). Se um
// dia entrar, o conserto é o mesmo nos dois lados — e a dependência `identity-obj-proxy` não está
// instalada em nenhum deles.
export default {
  testEnvironment: "jest-environment-jsdom",
  transform: {
    "^.+\.[jt]sx?$": "babel-jest",
  },
  testMatch: ["**/__tests__/**/*.test.jsx", "**/__tests__/**/*.test.js"],
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\.(css|less|scss|sass)$": "<identity-obj-proxy>",
  },
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
};
