export default {
  testEnvironment: "jest-environment-jsdom",
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  testMatch: ["**/__tests__/**/*.test.jsx", "**/__tests__/**/*.test.js"],
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "<identity-obj-proxy>",
  },
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
};
