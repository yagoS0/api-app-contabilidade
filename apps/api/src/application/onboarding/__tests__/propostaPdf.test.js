jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { gerarPropostaPdf, propostaParaCliente } from "../PropostaComercialPdf.js";
import { criarPropostasComerciais } from "../PropostasComerciaisService.js";
import { calcularOpcoes } from "../CatalogoComercial.js";
import { CATALOGO_SINTETICO } from "./fixtures/catalogoSintetico.js";
import { createPublicOnboardingRouter } from "../../../routes/publicOnboarding.js";
import { OnboardingError } from "../OnboardingService.js";
import express from "express";
import request from "supertest";
const ficha = { id: "o", origem: "TRANSFERENCIA", status: "RASCUNHO", versao: 3, cnpj: "11222333000181", dados: { regimeAtual: "SIMPLES", modalidadeServico: "RECORRENTE", qtdFuncionarios: 2, notasRecebidasMes: 0 } };
const p = { id: "p", onboardingId: "o", fichaVersao: 3, versao: 2, status: "APROVADA", expiraEm: "2099-01-01", snapshot: { ...calcularOpcoes({ ficha, catalogo: CATALOGO_SINTETICO }), destinatario: "Ana Exemplo", razaoSocial: "Empresa Sintética", cnpj: ficha.cnpj, criadoPor: "SEGREDO-ATOR", catalogoId: "SEGREDO-CATALOGO", justificativa: "SEGREDO-INTERNO", servicosConferidos: "Conferência e acompanhamento contábil." } };
test("PDF inclui apenas os dados e o preço deste lead, sem a tabela interna", async () => {
  const publico = propostaParaCliente(p);
  expect(JSON.stringify(publico)).not.toContain("SEGREDO");
  const pdf = await gerarPropostaPdf(publico), lido = await pdfParse(new Uint8Array(pdf), { version: "v2.0.550" });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(lido.text).toContain("Empresa Sintética"); expect(lido.text).toContain(ficha.cnpj);
  expect(lido.text).toContain("137,11"); expect(lido.text).toContain("Honorários mensais");
  expect(lido.text).not.toContain("SEGREDO"); expect(lido.text).not.toContain("781,33");
  expect(lido.text).toContain("orçamento separado");
});
test("escopo extenso quebra páginas sem perder o final e rascunho fica identificado", async () => {
  const pdf = await gerarPropostaPdf({ ...propostaParaCliente(p), status: "RASCUNHO", condicoes: "Linha de condições para paginação.\n".repeat(100) + "ÚLTIMA CONDIÇÃO", pendencias: ["Conferir serviço adicional"] });
  const lido = await pdfParse(new Uint8Array(pdf), { version: "v2.0.550" });
  expect(lido.numpages).toBeGreaterThan(1); expect(lido.text).toContain("ÚLTIMA CONDIÇÃO");
  expect(lido.text).toContain("RASCUNHO PARA REVISÃO"); expect(lido.text).toContain("Conferir serviço adicional");
});
test("download interno recusa outra versão da ficha e outra pessoa sem permissão", async () => {
  const db = { onboarding: { findUnique: async () => ficha }, propostaComercial: { findFirst: jest.fn(async () => ({ ...p, fichaVersao: 2 })) } };
  const service = criarPropostasComerciais({ db });
  await expect(service.documentoProposta("o", "p", { id: "gestor", role: "contador" })).rejects.toMatchObject({ code: "proposta_indisponivel" });
  await expect(service.documentoProposta("o", "p", { id: "externo", role: "client" })).rejects.toThrow();
});
test("PDF público valida o mesmo token do aceite em cabeçalho, sem cache", async () => {
  const publico = jest.fn(async token => { if (token !== "pessoal") throw new OnboardingError("link_invalido", "Link indisponível", 404); return { proposta: propostaParaCliente(p) }; });
  const app = express().use(createPublicOnboardingRouter({ propostas: { publico }, servico: {} }));
  await request(app).get("/proposta/pdf?token=pessoal").expect(404);
  const res = await request(app).get("/proposta/pdf").set("Authorization", "Bearer pessoal").expect(200);
  expect(res.headers["cache-control"]).toBe("no-store"); expect(res.headers["content-type"]).toContain("application/pdf");
  expect(publico).toHaveBeenLastCalledWith("pessoal");
});
test("orçamento personalizado acima do piso deixa de ser pendência, abaixo continua bloqueado", () => {
  const f = { ...ficha, dados: { ...ficha.dados, qtdFuncionarios: 12 } };
  const calc = mensalCentavos => calcularOpcoes({ ficha: f, catalogo: CATALOGO_SINTETICO, ajustes: { mensalCentavos, justificativa: "Escopo especial conferido" } });
  expect(calc(90000).pendencias).toEqual([]); expect(calc(100).pendencias).toContain("Mensalidade abaixo do piso personalizado.");
});
