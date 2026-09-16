import crypto from "node:crypto";
import { prepararArquivoConversao, conferirFontesDoArquivo } from "../ArquivoConversaoService.js";
import { validateAndNormalizeCompanyProfile } from "../../company/companyProfile.js";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
const buffer = Buffer.from("%PDF-1.4\nSINTÉTICO\n%%EOF"), sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
const fonte = { id: "doc-teste", nome: "teste.pdf", mime: "application/pdf", sha256, conteudoCifrado: "cifra" };
test("storage indisponível não produz um arquivo de conversão utilizável", async () => {
  const db = { documentoOnboarding: { findMany: jest.fn().mockResolvedValue([fonte]) } };
  const storage = { upload: jest.fn().mockRejectedValue(Error("Sem storage")) };
  await expect(prepararArquivoConversao({ db, onboardingId: "onb", storage, decifrar: async () => buffer.toString("base64") })).rejects.toMatchObject({ code: "arquivo_conversao_indisponivel" });
});
test("anexo que chega durante a preparação invalida o fechamento, sem perda silenciosa", async () => {
  const db = { documentoOnboarding: { findMany: jest.fn().mockResolvedValue([fonte]) } };
  const storage = { upload: jest.fn().mockResolvedValue({}) };
  const arquivo = await prepararArquivoConversao({ db, onboardingId: "onb", storage, decifrar: async () => buffer.toString("base64") });
  db.documentoOnboarding.findMany.mockResolvedValue([fonte, { ...fonte, id: "novo" }]);
  await expect(conferirFontesDoArquivo(db, "onb", arquivo)).rejects.toMatchObject({ code: "documentos_alterados" });
});
test("capital e participação numéricos conservam centavos e casas decimais", () => {
  const perfil = validateAndNormalizeCompanyProfile({ razaoSocial: "Exemplo", cnpj: "11222333000181", regimeTributario: "SIMPLES", cnaePrincipal: "7020400", endereco: { rua: "Rua", numero: "1", bairro: "Centro", cidade: "São Paulo", uf: "SP", cep: "01001000" }, capitalSocial: 25000.5, socios: [{ nome: "Ana", participacao: 60.5 }] });
  expect(perfil.ok).toBe(true); expect(perfil.data.capitalSocial).toBe(25000.5); expect(perfil.data.socios[0].participacao).toBe(60.5);
});
