jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { gerarPropostaPdf, propostaParaCliente } from "../PropostaComercialPdf.js";
import { criarPropostasComerciais } from "../PropostasComerciaisService.js";
import { calcularOpcoes as calcular } from "../CatalogoComercial.js";
const calcularOpcoes = args => calcular({ ...args, diagnostico: { regularizacao: { necessaria: false, justificativa: "Sem regularização anterior no caso sintético.", condicaoInicioMensal: "SEM_REGULARIZACAO" } } });
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
  expect(lido.text).toContain("Não foi identificada regularização anterior necessária");
});
test("escopo extenso quebra páginas sem perder o final e rascunho fica identificado", async () => {
  const pdf = await gerarPropostaPdf({ ...propostaParaCliente(p), status: "RASCUNHO", condicoes: "Linha de condições para paginação.\n".repeat(100) + "ÚLTIMA CONDIÇÃO", pendencias: ["Conferir serviço adicional"] });
  const lido = await pdfParse(new Uint8Array(pdf), { version: "v2.0.550" });
  expect(lido.numpages).toBeGreaterThan(1); expect(lido.text).toContain("ÚLTIMA CONDIÇÃO");
  expect(lido.text).toContain("RASCUNHO PARA REVISÃO"); expect(lido.text).toContain("Conferir serviço adicional");
});

test("PDF informa conferência cadastral manual sem publicar evidência interna", async () => {
  const manual = { ...p, snapshot: { ...p.snapshot, conferenciaCadastro: { modo: "MANUAL", fonte: "fonte interna", evidencia: "SEGREDO-EVIDENCIA", atorId: "SEGREDO-ATOR" } } };
  const publico = propostaParaCliente(manual);
  expect(publico.conferenciaCadastro).toEqual({ modo: "MANUAL" });
  const pdf = await gerarPropostaPdf(publico), lido = await pdfParse(new Uint8Array(pdf), { version: "v2.0.550" });
  expect(lido.text).toMatch(/cadast.*manual/i); expect(lido.text).toMatch(/consulta automática não/i);
  expect(lido.text).not.toContain("SEGREDO"); expect(lido.text).not.toContain("fonte interna");
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

const APRESENTACAO = { incluidos: 'Contábil, fiscal, folha e obrigações.', gestao: 'Reunião mensal e análise dos resultados.', beneficios: 'Benefício sintético do plano.', limites: 'Períodos anteriores exigem orçamento próprio.' };
const catalogoApresentado = { ...CATALOGO_SINTETICO, apresentacao: APRESENTACAO };
function propostaCompleta(dados = {}) {
  const f = { ...ficha, dados: { ...ficha.dados, notasRecebidasMes: 20, ...dados } };
  return { ...p, snapshot: { ...p.snapshot, ...calcularOpcoes({ ficha: f, catalogo: catalogoApresentado, ajustes: { servicoCentavos: 6789, justificativa: 'Orçamento sintético', escopoAvulso: 'Entrega avulsa conferida.' } }), perfil: { atividade: 'Comércio sintético', regime: 'SIMPLES', funcionarios: f.dados.qtdFuncionarios, notasRecebidasMes: f.dados.notasRecebidasMes, consultoriaMensal: f.dados.consultoriaMensal === true || f.dados.qtdFuncionarios >= catalogoApresentado.consultoriaIncluidaAPartir } } };
}
test('apresentação congela entregas, inclui blocos contratados e não revela dados internos', () => {
  const proposta = propostaCompleta({ consultoriaMensal: true });
  expect(proposta.snapshot.limitesPlano).toMatchObject({ funcionarios: 2, documentosEntradaMes: 26, blocoAdicionalQuantidade: 7, blocoAdicionalCentavos: 173 });
  expect(proposta.snapshot.apresentacao.gestao).toBe(APRESENTACAO.gestao);
  proposta.snapshot.apresentacao.fonte = 'SEGREDO'; proposta.snapshot.limitesPlano.piso = 'SEGREDO';
  const publico = propostaParaCliente(proposta);
  expect(JSON.stringify(publico)).not.toContain('SEGREDO');
  expect(publico.apresentacao).toEqual(APRESENTACAO);
});
test('PDF completo tem sete seções e duas páginas, sem páginas extras de rodapé', async () => {
  const pdf = await gerarPropostaPdf(propostaParaCliente(propostaCompleta({ consultoriaMensal: true })));
  const lido = await pdfParse(new Uint8Array(pdf), { version: 'v2.0.550' });
  for (const titulo of ['Sobre a empresa', 'O que está incluído', 'Gestão e acompanhamento', 'Investimento', 'Benefícios incluídos', 'Limites e adicionais', 'Condições e aceite']) expect(lido.text).toContain(titulo);
  expect(lido.numpages).toBe(2);
  expect(lido.text).toContain(APRESENTACAO.gestao); expect(lido.text).toContain(APRESENTACAO.beneficios);
  expect(lido.text).toContain('até 26 documentos');
  expect(lido.text).toContain('1 / 2'); expect(lido.text).toContain('2 / 2');
});
test('mensal sem consultoria não promete reunião incluída; avulso não recebe benefícios mensais', async () => {
  const mensal = propostaCompleta({ consultoriaMensal: false });
  expect(mensal.snapshot.apresentacao.gestao).toBe('');
  const mensalLido = await pdfParse(new Uint8Array(await gerarPropostaPdf(propostaParaCliente(mensal))), { version: 'v2.0.550' });
  expect(mensalLido.text).not.toContain(APRESENTACAO.gestao);
  const avulso = propostaCompleta({ modalidadeServico: 'AVULSO', consultoriaMensal: true });
  expect(avulso.snapshot.apresentacao).toBeNull(); expect(avulso.snapshot.limitesPlano).toBeNull();
  const lido = await pdfParse(new Uint8Array(await gerarPropostaPdf(propostaParaCliente(avulso))), { version: 'v2.0.550' });
  expect(lido.text).toContain('Entrega avulsa conferida.'); expect(lido.text).toContain('67,89');
  expect(lido.text).not.toContain(APRESENTACAO.beneficios); expect(lido.text).not.toContain(APRESENTACAO.gestao);
});
test('comparação mantém preços e identifica a qual opção pertencem benefícios', async () => {
  const publico = propostaParaCliente(propostaCompleta({ modalidadeServico: 'COMPARAR', consultoriaMensal: true }));
  expect(publico.opcoes).toHaveLength(2);
  const lido = await pdfParse(new Uint8Array(await gerarPropostaPdf(publico)), { version: 'v2.0.550' });
  expect(lido.text).toContain('Serviço avulso'); expect(lido.text).toContain('Contabilidade mensal');
  expect(lido.text).toContain('somente à opção de contabilidade mensal');
  expect(lido.text).toContain('67,89'); expect(lido.text).toContain('164,04');
});
test('propostas antigas continuam sem benefícios ou limites acrescentados retroativamente', () => {
  const antigo = propostaParaCliente({ ...p, snapshot: { ...p.snapshot, apresentacao: undefined, limitesPlano: undefined } });
  expect(antigo.apresentacao).toBeNull(); expect(antigo.limitesPlano).toBeNull();
});

test('apresentação não substitui o escopo mensal específico nem exclui gestão de proposta antiga', async () => {
  const novo = propostaParaCliente(propostaCompleta({ consultoriaMensal: true }));
  novo.opcoes[0].escopo = 'Entrega específica negociada para este cliente.';
  const n = await pdfParse(new Uint8Array(await gerarPropostaPdf(novo)), { version: 'v2.0.550' });
  expect(n.text).toContain(novo.opcoes[0].escopo);
  const legado = { ...propostaParaCliente(p), perfil: null, apresentacao: null, opcoes: [{ ...p.snapshot.opcoes[0], escopo: 'Reunião mensal incluída conforme negociação anterior.' }] };
  const l = await pdfParse(new Uint8Array(await gerarPropostaPdf(legado)), { version: 'v2.0.550' });
  expect(l.text).toContain(legado.opcoes[0].escopo);
  expect(l.text).not.toContain('não estão incluídas'); expect(l.text).not.toContain('contratada separadamente');
});
