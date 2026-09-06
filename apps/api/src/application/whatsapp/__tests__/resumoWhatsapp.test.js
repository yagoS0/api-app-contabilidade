import { resumoWhatsapp } from "../resumoWhatsapp.js";

test("agrega sem truncar, parametriza carteira e compara leitura por conversa", async () => {
  const resumo = { conversas: 301, naoVinculadas: 1, conversasNaoLidas: 201, mensagensNaoLidas: 999 };
  const client = { $queryRaw: jest.fn(async () => [resumo]) };
  expect(await resumoWhatsapp(["pc-permitida"], { client })).toEqual(resumo);
  const query = client.$queryRaw.mock.calls[0][0];
  expect(query.values).toEqual(["pc-permitida"]);
  expect(query.sql).toContain('c."portalClientId" IN (?)');
  expect(query.sql).toContain('OR c."portalClientId" IS NULL');
  expect(query.sql).toContain('m."registradaEm" > c."lidaAteEm"');
  expect(query.sql).toContain("m.direcao = 'in'");
  expect(query.sql).not.toMatch(/LIMIT/i);
});
test("carteira vazia permite somente fila, falha é propagada", async () => {
  const client = { $queryRaw: jest.fn(async () => [{}]) };
  await resumoWhatsapp([], { client });
  expect(client.$queryRaw.mock.calls[0][0].sql).toContain('WHERE (FALSE OR c."portalClientId" IS NULL)');
  client.$queryRaw.mockRejectedValueOnce(new Error("banco indisponível"));
  await expect(resumoWhatsapp([], { client })).rejects.toThrow("banco indisponível");
});
