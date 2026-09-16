import { validarAnexoManual } from "../anexoManual.js";

const pdf = { buffer: Buffer.from("%PDF-1.7\nconteudo teste\n%%EOF"), mimetype: "application/pdf", originalname: "pasta/contrato.pdf" };
test("anexo é conferido pelo conteúdo, preserva nome seguro e identifica o arquivo auditável", () => {
  const a = validarAnexoManual(pdf, "Para assinatura");
  expect(a).toMatchObject({ tipo: "document", mimeType: "application/pdf", nomeArquivo: "contrato.pdf", legenda: "Para assinatura" });
  expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
});
test.each([
  { ...pdf, buffer: Buffer.from("<html>arquivo falso</html>") },
  { ...pdf, mimetype: "image/png" },
  { ...pdf, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
  undefined,
])("conteúdo falso, MIME divergente e excesso são recusados", a => expect(() => validarAnexoManual(a)).toThrow(/PDF ou imagem/));
test("PNG e JPEG usam transporte de imagem; legenda excessiva é recusada", () => {
  for (const [bytes, mimetype] of [[[137,80,78,71,13,10,26,10], "image/png"], [[255,216,255,224], "image/jpeg"]]) {
    expect(validarAnexoManual({ buffer: Buffer.from(bytes), mimetype, originalname: "imagem" }).tipo).toBe("image");
  }
  expect(() => validarAnexoManual(pdf, "x".repeat(1025))).toThrow(/1.024/);
});
