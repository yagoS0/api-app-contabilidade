jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { portalClient: { findUnique: jest.fn(), create: jest.fn() }, appSetting: { upsert: jest.fn() } } }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "12345678000199" } })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { SerproProcurationService, summarizeProcurationResponse } from "../SerproProcurationService.js";

it("consulta procuração pelo CNPJ sem criar ou exigir PortalClient", async () => {
  const post = jest.fn(async () => ({ dados: JSON.stringify([{ dtexpiracao: "31/12/2026", sistemas: ["SITFIS"] }]) }));
  const r = await new SerproProcurationService({ client: { post } }).checkCnpjProcuration({ cnpj: "11.222.333/0001-81" });
  expect(r).toMatchObject({ cnpj: "11222333000181", procuradorCnpj: "12345678000199", status: "ATIVA", systems: ["SITFIS"] });
  const body = post.mock.calls[0][1];
  expect(body.contribuinte.numero).toBe("11222333000181");
  expect(JSON.parse(body.pedidoDados.dados)).toMatchObject({ outorgante: "11222333000181", outorgado: "12345678000199" });
  expect(prisma.portalClient.findUnique).not.toHaveBeenCalled(); expect(prisma.portalClient.create).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
it("lê formato oficial aaaammdd e reúne apenas sistemas de procurações vigentes", () => {
  const r = summarizeProcurationResponse({ status: 200, dados: JSON.stringify([
    { dtexpiracao: "20991231", sistemas: ["Situação Fiscal do Contribuinte"] },
    { dtexpiracao: "20001231", sistemas: ["PGDASD"] },
  ]) });
  expect(r.status).toBe("ATIVA"); expect(r.systems).toEqual(["Situação Fiscal do Contribuinte"]);
});
it.each(["REVOGADA", "INATIVA", "CANCELADA"])("%s prevalece sobre validade futura em array e objeto", (status) => {
  expect(summarizeProcurationResponse({ status, validade: "2099-12-31", sistemas: ["SITFIS"] }).status).toBe("AUSENTE");
  expect(summarizeProcurationResponse({ dados: JSON.stringify([{ status, dtexpiracao: "20991231", sistemas: ["SITFIS"] }]) }).status).toBe("AUSENTE");
});
it("validade isolada em objeto não canônico não autoriza", () => {
  expect(summarizeProcurationResponse({ validade: "2099-12-31", sistemas: ["SITFIS"] }).status).toBe("AUSENTE");
});
