jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { calcularOpcoes, pendenciasPoliticaComercial } from "../CatalogoComercial.js";
import { criarPropostasComerciais } from "../PropostasComerciaisService.js";
import { propostaParaCliente, gerarPropostaPdf } from "../PropostaComercialPdf.js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { CATALOGO_SINTETICO as catalogo } from "./fixtures/catalogoSintetico.js";

const decisao = necessaria => ({ necessaria, justificativa: "Conferência sintética de períodos anteriores registrada pelo contador.", condicaoInicioMensal: necessaria ? "APOS_REGULARIZACAO" : "SEM_REGULARIZACAO" });
const ficha = (dados = {}, origem = "TRANSFERENCIA") => ({ id: "o", versao: 1, origem, status: "RASCUNHO", dados: { modalidadeServico: "RECORRENTE", regimeAtual: "SIMPLES", regimePretendido: "SIMPLES", qtdFuncionarios: 2, notasRecebidasMes: 12, ...dados } });
const calc = ({ dados, origem, ajustes = {}, necessaria = false, diagnostico } = {}) => calcularOpcoes({ ficha: ficha(dados, origem), catalogo, ajustes, diagnostico: diagnostico === undefined ? { regularizacao: decisao(necessaria) } : diagnostico });

test.each([[0, 13711], [2, 13711], [3, 34717], [5, 34717], [6, 56921], [8, 56921]])("piso de toda faixa protege override com %i funcionários", (qtdFuncionarios, piso) => {
  const r = calc({ dados: { qtdFuncionarios, notasRecebidasMes: 0 }, ajustes: { mensalCentavos: piso - 1, justificativa: "Desconto abaixo da política para a prova negativa." } });
  expect(r.pendencias).toContain("Mensalidade abaixo do mínimo do catálogo para a faixa e os adicionais contratados.");
  expect(pendenciasPoliticaComercial(r)).not.toEqual([]);
  expect(calc({ dados: { qtdFuncionarios, notasRecebidasMes: 0 }, ajustes: { mensalCentavos: piso, justificativa: "Preço mínimo conferido." } }).pendencias).toEqual([]);
});
test("override não remove blocos excedentes nem gestão contratada", () => {
  const r = calc({ dados: { notasRecebidasMes: 20, consultoriaMensal: true }, ajustes: { mensalCentavos: 13711, justificativa: "Preço sem os adicionais contratados." } });
  expect(r.politicaComercial.mensalMinimoCentavos).toBe(16404);
  expect(r.pendencias).not.toEqual([]);
});
test.each(["TRANSFERENCIA", "INATIVA"])("%s exige decisão explícita, não presume regularidade", origem => {
  expect(calc({ origem, diagnostico: null }).pendencias).toContain("Confira no diagnóstico se há regularização necessária e registre a justificativa antes de propor valores.");
  expect(calc({ origem }).pendencias).toEqual([]);
  expect(calc({ origem, necessaria: true }).pendencias).toContain("Defina o orçamento da regularização necessária antes da mensalidade.");
});
test("regularização no campo genérico do serviço continua sujeita ao piso", () => {
  const r = calc({ origem: "INATIVA", dados: { modalidadeServico: "AVULSO" }, necessaria: true,
    ajustes: { tipoServicoAvulso: "REGULARIZACAO", servicoCentavos: 111, escopoAvulso: "Regularização sintética de declarações.", justificativa: "Preço abaixo do piso para reprodução." } });
  expect(r.regularizacaoCentavos).toBe(111);
  expect(r.opcoes[0]).toMatchObject({ unicoCentavos: 111, regularizacaoIncluida: true });
  expect(r.pendencias).toContain("Regularização abaixo do piso; revisar escopo e orçamento.");
});
test.each(["AVULSO", "COMPARAR"])("regularização %s aparece incluída uma única vez no avulso", modalidadeServico => {
  const r = calc({ origem: "INATIVA", dados: { modalidadeServico }, necessaria: true,
    ajustes: { tipoServicoAvulso: "REGULARIZACAO", regularizacaoCentavos: 4691, justificativa: "Orçamento separado conferido." } });
  expect(r.opcoes[0]).toMatchObject({ unicoCentavos: 4691, regularizacaoIncluida: true });
  expect(r.pendencias).toEqual([]); expect(pendenciasPoliticaComercial(r)).toEqual([]);
  if (modalidadeServico === "COMPARAR") expect(r.opcoes[1].regularizacaoIncluida).toBeUndefined();
});
test.each(["BAIXA", "OUTRO"])("%s sem regularização não recebe piso de regularização", tipoServicoAvulso => {
  expect(calc({ origem: "INATIVA", dados: { modalidadeServico: "AVULSO" }, ajustes: { tipoServicoAvulso, servicoCentavos: 111, justificativa: "Serviço sintético sem regularização anterior." } }).pendencias).toEqual([]);
});
test("baixa com regularização cobra itens separados e protege o piso da regularização", () => {
  const r = calc({ origem: "INATIVA", dados: { modalidadeServico: "AVULSO" }, necessaria: true, ajustes: { tipoServicoAvulso: "BAIXA", servicoCentavos: 111, regularizacaoCentavos: 4691, justificativa: "Dois serviços distintos conferidos." } });
  expect(r.opcoes[0].unicoCentavos).toBe(111); expect(r.opcoes[0].regularizacaoIncluida).toBeUndefined(); expect(r.regularizacaoCentavos).toBe(4691); expect(r.pendencias).toEqual([]);
});
test.each(["RECORRENTE", "COMPARAR"])("pedido de encerramento impede modalidade %s pela API", modalidadeServico => {
  const r = calc({ origem: "INATIVA", dados: { pretendeReativar: "BAIXAR", modalidadeServico }, ajustes: { tipoServicoAvulso: "BAIXA", servicoCentavos: 111, justificativa: "Encerramento sintético com modalidade incorreta." } });
  expect(r.politicaComercial.encerramentoEmpresa).toBe(true);
  expect(r.pendencias).toContain("O cliente escolheu encerrar a empresa. Confira a modalidade avulsa e o serviço de encerramento antes de gerar a proposta.");
  r.pendencias = [];
  expect(pendenciasPoliticaComercial(r)).toContain("Encerramento exige somente serviço avulso de baixa, sem contabilidade mensal.");
});
test.each(["REGULARIZACAO", "OUTRO"])("pedido de encerramento exige BAIXA em vez de %s", tipoServicoAvulso => {
  const r = calc({ origem: "INATIVA", dados: { pretendeReativar: "BAIXAR", modalidadeServico: "AVULSO" }, necessaria: true, ajustes: { tipoServicoAvulso, servicoCentavos: 4691, regularizacaoCentavos: 4691, justificativa: "Encerramento sintético com classificação incorreta." } });
  expect(r.pendencias).toContain("O cliente escolheu encerrar a empresa. Confira a modalidade avulsa e o serviço de encerramento antes de gerar a proposta.");
});
test.each([false, true])("encerramento avulso válido discrimina regularização necessária=%s", necessaria => {
  const r = calc({ origem: "INATIVA", dados: { pretendeReativar: "BAIXAR", modalidadeServico: "AVULSO" }, necessaria, ajustes: { tipoServicoAvulso: "BAIXA", servicoCentavos: 111, ...(necessaria ? { regularizacaoCentavos: 4691 } : {}), justificativa: "Baixa sintética delimitada no diagnóstico." } });
  expect(r.opcoes).toEqual([expect.objectContaining({ chave: "AVULSO", unicoCentavos: 111, recorrente: false })]);
  expect(r.regularizacaoCentavos).toBe(necessaria ? 4691 : null);
  expect(pendenciasPoliticaComercial(r)).toEqual([]);
});
test("abertura avulsa não herda piso ou decisão de regularização", () => {
  expect(calc({ origem: "ABERTURA", dados: { modalidadeServico: "AVULSO" }, diagnostico: null, ajustes: { aberturaCentavos: 111, justificativa: "Abertura conforme escopo próprio." } }).pendencias).toEqual([]);
});
test("exige natureza explícita e rejeita duplicidade ou contradição do diagnóstico", () => {
  expect(calc({ dados: { modalidadeServico: "AVULSO" }, ajustes: { servicoCentavos: 111, justificativa: "Serviço sem classificação." } }).pendencias).toContain("Identifique o serviço avulso: regularização, baixa ou outro serviço.");
  expect(calc({ dados: { modalidadeServico: "AVULSO" }, necessaria: true, ajustes: { tipoServicoAvulso: "REGULARIZACAO", servicoCentavos: 6000, regularizacaoCentavos: 5000, justificativa: "Valores diferentes indevidos." } }).pendencias).toContain("O valor do serviço de regularização deve ser o mesmo do orçamento de regularização, sem cobrança duplicada.");
  expect(calc({ ajustes: { regularizacaoCentavos: 5000, justificativa: "Orçamento contrário ao diagnóstico." } }).pendencias).not.toEqual([]);
});
test("política congelada reprova adulteração mesmo que lista de pendências seja removida", () => {
  const r = calc(); r.opcoes[0].mensalCentavos = 1; r.pendencias = [];
  expect(pendenciasPoliticaComercial(r)).toContain("Mensalidade abaixo do mínimo da faixa e dos adicionais conferidos.");
});
test("projeção pública remove política, pisos e justificativa da decisão", () => {
  const r = calc({ necessaria: true, ajustes: { regularizacaoCentavos: 4691, justificativa: "Informação interna de negociação." } });
  const p = propostaParaCliente({ status: "APROVADA", snapshot: r });
  expect(p).not.toHaveProperty("politicaComercial"); expect(p.decisaoRegularizacao).toEqual({ necessaria: true, condicaoInicioMensal: "APOS_REGULARIZACAO" });
  expect(JSON.stringify(p)).not.toContain(decisao(true).justificativa);
});
function publico(snapshot, status = "APROVADA") {
  const proposta = { id: "p", onboardingId: "o", status, versao: 1, fichaVersao: 1, expiraEm: new Date("2099-01-01"), snapshot };
  const db = { onboarding: { findUnique: async () => ficha(), updateMany: jest.fn(async () => ({ count: 1 })) },
    propostaComercial: { findFirst: async () => proposta, updateMany: jest.fn(async () => ({ count: 1 })) }, onboardingEvento: { create: jest.fn(async () => ({})) } };
  db.$transaction = fn => fn(db);
  return { db, service: criarPropostasComerciais({ db }) };
}
test.each(["APROVADA", "ENVIADA"])("legado %s não pode publicar nem aceitar sem política congelada", async status => {
  const r = calc(); delete r.politicaComercial;
  const t = publico(r, status);
  await expect(t.service.publico("a".repeat(43))).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  await expect(t.service.publico("a".repeat(43), { confirmado: true, versao: 1, opcao: "RECORRENTE" })).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  expect(t.db.propostaComercial.updateMany).not.toHaveBeenCalled();
});
test.each(["sem politica", "mensal abaixo", "regularizacao abaixo"])("aprovação e emissão do link recusam %s", async caso => {
  const r = caso === "regularizacao abaixo" ? calc({ dados: { modalidadeServico: "AVULSO" }, necessaria: true, ajustes: { tipoServicoAvulso: "REGULARIZACAO", servicoCentavos: 111, justificativa: "Reprodução de valor inferior ao piso." } }) : calc();
  if (caso === "sem politica") delete r.politicaComercial;
  if (caso === "mensal abaixo") r.opcoes[0].mensalCentavos = 111;
  r.pendencias = []; // Lista do rascunho sozinha não autoriza aprovação.
  const t = publico(r, "RASCUNHO");
  await expect(t.service.aprovar("o", "p", { id: "contador", role: "contador" })).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  await expect(t.service.emitirLink("o", "p", { id: "contador", role: "contador" })).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  expect(t.db.propostaComercial.updateMany).not.toHaveBeenCalled();
});
test("aceite revalida mínimo congelado sem consultar catálogo posterior", async () => {
  const t = publico(calc());
  await expect(t.service.publico("a".repeat(43), { confirmado: true, versao: 1, opcao: "RECORRENTE" })).resolves.toMatchObject({ proposta: { status: "ACEITA" } });
  expect(t.db.propostaComercial.updateMany).toHaveBeenCalledTimes(1);
});
test.each(["RASCUNHO", "APROVADA", "ENVIADA"])("proposta %s de encerramento incoerente não passa à contratação", async status => {
  const r = calc({ origem: "INATIVA", dados: { pretendeReativar: "BAIXAR", modalidadeServico: "COMPARAR" }, ajustes: { tipoServicoAvulso: "BAIXA", servicoCentavos: 111, justificativa: "Reprodução sintética de encerramento com mensalidade." } });
  r.pendencias = [];
  const t = publico(r, status);
  if (status === "RASCUNHO") await expect(t.service.aprovar("o", "p", { id: "contador", role: "contador" })).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  await expect(t.service.emitirLink("o", "p", { id: "contador", role: "contador" })).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  await expect(t.service.publico("a".repeat(43), { confirmado: true, versao: 1, opcao: "RECORRENTE" })).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  expect(t.db.propostaComercial.updateMany).not.toHaveBeenCalled();
});
test("snapshot antigo sem decisão de encerramento exige revisão, preservando aceite existente", async () => {
  const r = calc(); delete r.politicaComercial.encerramentoEmpresa;
  const pendente = publico(r);
  await expect(pendente.service.publico("a".repeat(43))).rejects.toMatchObject({ code: "proposta_revisao_comercial" });
  const aceita = publico(r, "ACEITA");
  await expect(aceita.service.publico("a".repeat(43))).resolves.toMatchObject({ proposta: { opcoes: r.opcoes } });
  expect(aceita.db.propostaComercial.updateMany).not.toHaveBeenCalled();
});
test("contratação já aceita permanece exatamente como foi aceita", async () => {
  const snapshot = { opcoes: [{ chave: "RECORRENTE", recorrente: true, mensalCentavos: 111, unicoCentavos: 0 }], condicoes: "Condições históricas." };
  const t = publico(snapshot, "ACEITA");
  await expect(t.service.publico("a".repeat(43))).resolves.toMatchObject({ proposta: { opcoes: snapshot.opcoes } });
  expect(t.db.propostaComercial.updateMany).not.toHaveBeenCalled();
});
test("PDF de comparação esclarece cobrança única e condição antes da mensalidade", async () => {
  const snapshot = calc({ origem: "INATIVA", dados: { modalidadeServico: "COMPARAR" }, necessaria: true, ajustes: { tipoServicoAvulso: "REGULARIZACAO", regularizacaoCentavos: 4691, justificativa: "Orçamento sintético conferido." } });
  const pdf = await gerarPropostaPdf(propostaParaCliente({ versao: 1, status: "APROVADA", snapshot }));
  const lido = await pdfParse(new Uint8Array(pdf), { version: "v2.0.550" });
  expect(lido.text).toContain("Não há cobrança adicional de regularização");
  expect(lido.text).toContain("além dos honorários acima");
  expect(lido.text).toContain("condicionado à conclusão da regularização");
});
