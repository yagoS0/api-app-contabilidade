import { parseDasIndexResponse } from "../SerproPgdasDeclaracaoService.js";
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn() }));
const DOC = "07202600000000001";
// A documentação define booleano literal; texto "false" não comprova negativa fiscal.
test.each([[true, true], [false, false], ["true", null], ["false", null], [null, null], [undefined, null], ["indisponível", null]])("índice DAS mantém ausência e valores inválidos distintos de false: %s", (raw, expected) => {
  const response = { status: 200, dados: JSON.stringify({ periodos: [{ periodoApuracao: 202609,
    operacoes: [{ indiceDas: { numeroDas: DOC, dasPago: raw } }],
  }] }) };
  expect(parseDasIndexResponse(response, { competencia: "2026-09", numeroDocumento: DOC, contribuinteCnpj: "11111111000191" }).dasPago).toBe(expected);
});
