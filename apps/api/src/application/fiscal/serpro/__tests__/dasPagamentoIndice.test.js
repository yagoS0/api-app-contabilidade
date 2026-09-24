import { parseDasIndexResponse } from "../SerproPgdasDeclaracaoService.js";
test.each([[true, true], [false, false], ["true", true], ["false", false], [null, null], [undefined, null], ["indisponível", null]])("índice DAS mantém ausência distinta de falso: %s", (raw, expected) => {
  expect(parseDasIndexResponse({ dados: JSON.stringify({ indiceDas: { numeroDas: "123", dasPago: raw } }) }).dasPago).toBe(expected);
});
