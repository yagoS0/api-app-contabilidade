// ⚠ MESMO HARNESS DE `apps/web/jest.config.js` — de propósito, e sem uma linha a mais. Um segundo
// jeito de testar dentro do mesmo monorepo é um jeito a mais de esquecer de rodar.
//
// ⚠ O `import.meta.env` NÃO é tratado aqui: ele morre em tempo de PARSE, antes de qualquer
// configuração de teste. Quem resolve é o `babel.config.js` ao lado — ver o cabeçalho de lá.
//
// Os relatórios compartilhados importam CSS; nos testes de comportamento ele usa um módulo vazio.
export default {
  testEnvironment: "jest-environment-jsdom",
  transform: {
    "^.+\.[jt]sx?$": "babel-jest",
  },
  testMatch: ["**/__tests__/**/*.test.jsx", "**/__tests__/**/*.test.js"],
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\.(css|less|scss|sass)$": "<rootDir>/src/testStyleMock.cjs",
  },
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
};
