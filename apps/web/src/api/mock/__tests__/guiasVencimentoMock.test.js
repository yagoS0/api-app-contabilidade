import { relatorioVencimentoMock, enviarVencimentoMock, previaVencimentoMock } from "../guiasVencimentoMock";
test("mock mantém referências distintas, IDs estáveis e parcela faltante após envio", () => {
  const empresas = [{ companyId: "teste-vencimento", razao: "Cliente" }];
  const filtro = { mesVencimento: "2030-09" };
  const r = relatorioVencimentoMock(empresas, filtro);
  const row = r.simples[0];
  expect(row.documentos.map((d) => d.competencia)).toEqual(["2030-08", "2030-09"]);
  expect(relatorioVencimentoMock(empresas, filtro).simples[0].pendingGuideIds).toEqual(row.pendingGuideIds);
  const previa = previaVencimentoMock(empresas, {}, { ...filtro, portalClientIds: [row.portalClientId], guideIds: row.pendingGuideIds });
  expect(previa.linhas.map((l) => l.guideId)).toEqual(row.pendingGuideIds);
  enviarVencimentoMock([{ ...filtro, portalClientId: row.portalClientId, guideIds: row.pendingGuideIds, assinatura: row.assinatura }]);
  const depois = relatorioVencimentoMock(empresas, filtro).simples[0];
  expect(depois.pendingGuideIds).toEqual([]);
  expect(depois.faltantes).toHaveLength(1);
  expect(depois.situacao).toBe("incompleto");
});
