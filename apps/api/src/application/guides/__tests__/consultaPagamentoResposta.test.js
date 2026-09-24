jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { toGuideResponse, PUBLICO } from "../GuideService.js";

const resultado = { estado: "INDETERMINADO", fonte: "PAGTOWEB", consultadoEm: "2026-09-24T12:00:00.000Z",
  numeroDocumento: "07.162.619.4444123-36", cobertura: "PARCIAL", identidadeConferida: false,
  motivo: "RESPOSTA_SEM_COMPROVANTE", observacaoId: "obs-teste",
  evidencia: { raw: "RETORNO_PRIVADO" }, raw: "DADO_PRIVADO", userId: "ATOR_PRIVADO", consultaId: "INTERNO" };
const guia = { id: "g1", tipo: "SIMPLES", status: "PROCESSED", paymentStatus: "OPEN", extracted: { consultaPagamento: resultado } };
test("recarregar guia do escritório conserva estado e origem com whitelist", () => {
  const r = toGuideResponse(guia, { publico: PUBLICO.ESCRITORIO });
  expect(r.resultadoConsulta).toEqual({ estado: "INDETERMINADO", fonte: "PAGTOWEB", consultadoEm: resultado.consultadoEm,
    numeroDocumento: "07162619444412336", cobertura: "PARCIAL", identidadeConferida: false,
    motivo: "RESPOSTA_SEM_COMPROVANTE", observacaoId: "obs-teste" });
  expect(JSON.stringify(r)).not.toMatch(/RETORNO_PRIVADO|DADO_PRIVADO|ATOR_PRIVADO|INTERNO/);
});
test.each([undefined, PUBLICO.CLIENTE, "DESCONHECIDO"])("público %s não recebe a consulta interna", (publico) => {
  const r = toGuideResponse(guia, publico === undefined ? undefined : { publico });
  expect(r).not.toHaveProperty("resultadoConsulta");
  expect(JSON.stringify(r)).not.toMatch(/obs-teste|RETORNO_PRIVADO|DADO_PRIVADO|ATOR_PRIVADO/);
});
test("guia antiga sem observação não ganha consulta fictícia", () => {
  expect(toGuideResponse({ ...guia, extracted: {} }, { publico: PUBLICO.ESCRITORIO }).resultadoConsulta).toBeNull();
});
test("objetos indevidos nos campos permitidos não deixam passar retornos privados", () => {
  const r = toGuideResponse({ ...guia, extracted: { consultaPagamento: { ...resultado,
    motivo: { raw: "SEGREDO" }, fonte: ["OUTRO_SEGREDO"] } } }, { publico: PUBLICO.ESCRITORIO });
  expect(r.resultadoConsulta).toMatchObject({ motivo: null, fonte: null });
  expect(JSON.stringify(r)).not.toMatch(/SEGREDO/);
});
