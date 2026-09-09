jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { calcularOpcoes as calcularComCatalogo, preencherTexto, catalogoValido } from "../CatalogoComercial.js";
import { CATALOGO_SINTETICO } from "./fixtures/catalogoSintetico.js";
import { aplicarCampos, proximaPergunta } from "../LeadService.js";
import { criarRecursosComerciais } from "../RecursosComerciaisService.js";
import { criarPropostasComerciais } from "../PropostasComerciaisService.js";
import { decidirRespostaComercial } from "../../assistente/AssistenteComercialService.js";

const calcularOpcoes = p => calcularComCatalogo({ catalogo: CATALOGO_SINTETICO, ...p });
const ficha = dados => ({ origem: "ABERTURA", dados: { modalidadeServico: "COMPARAR", regimePretendido: "SIMPLES", qtdFuncionarios: 2, notasRecebidasMes: 12, ...dados } });
test("catálogo rejeita divisão por zero, preços negativos e faixas fora de ordem", () => {
  expect(catalogoValido(CATALOGO_SINTETICO)).toBe(true);
  for (const alterar of [c => c.blocoRecebidas.quantidade = 0, c => c.faixas[0].SIMPLES = -1, c => c.faixas.reverse(), c => c.condicoes = 3]) {
    const c = structuredClone(CATALOGO_SINTETICO); alterar(c);
    expect(catalogoValido(c)).toBe(false);
    expect(() => calcularOpcoes({ ficha: ficha({}), catalogo: c })).toThrow("catálogo");
  }
});
test("abertura avulsa e mensal são opções distintas; preço ausente pede conferência", () => {
  const r = calcularOpcoes({ ficha: ficha({}) });
  expect(r.opcoes.map(o => o.chave)).toEqual(["AVULSO", "RECORRENTE"]);
  expect(r.opcoes[0].unicoCentavos).toBeNull(); expect(r.opcoes[1].mensalCentavos).toBe(13711);
  expect(r.pendencias).toContain("Definir honorários do serviço avulso.");
});
test.each([[0, 13711], [2, 13711], [3, 34717], [5, 34717], [6, 56921], [8, 56921]])("faixa sintética de %i funcionários custa %i", (qtdFuncionarios, esperado) => {
  const r = calcularOpcoes({ ficha: ficha({ qtdFuncionarios, notasRecebidasMes: 0, consultoriaMensal: false }) });
  expect(r.opcoes[1].mensalCentavos).toBe(esperado);
});
test("volume, consultoria e pró-labore não são confundidos", () => {
  const r = calcularOpcoes({ ficha: ficha({ notasRecebidasMes: 20, consultoriaMensal: true, temProLabore: true }) });
  expect(r.opcoes[1].mensalCentavos).toBe(16404);
  const incluido = calcularOpcoes({ ficha: ficha({ qtdFuncionarios: 7, notasRecebidasMes: 36, consultoriaMensal: true }) });
  expect(incluido.opcoes[1].mensalCentavos).toBe(56921);
});
test("não saber regime/volume é pendência, nunca zero presumido", () => {
  const r = calcularOpcoes({ ficha: ficha({ regimePretendido: "A_DEFINIR", notasRecebidasMes: undefined }) });
  expect(r.opcoes[1].mensalCentavos).toBeNull(); expect(r.pendencias.length).toBeGreaterThan(0);
});
test("avulso explícito dispensa mensalidade e não cria assinatura recorrente", () => {
  const r = calcularOpcoes({ ficha: ficha({ modalidadeServico: "AVULSO", regimePretendido: undefined, qtdFuncionarios: undefined }), ajustes: { aberturaCentavos: 123456, justificativa: "Honorários conferidos" } });
  expect(r.opcoes).toHaveLength(1); expect(r.opcoes[0].recorrente).toBe(false); expect(r.pendencias).toEqual([]);
});
test("lista pode ser apagada e campos ocultos são podados", () => {
  expect(aplicarCampos("ABERTURA", { tipoEmpresa: "LTDA", socios: [{ nome: "Ana" }] }, [{ campo: "socios", acao: "set", valor: [] }]).socios).toEqual([]);
  expect(() => aplicarCampos("ABERTURA", {}, [{ campo: "qtdFuncionarios", acao: "set", valor: "nenhum" }])).toThrow();
  expect(() => aplicarCampos("ABERTURA", {}, [{ campo: "aprovado", acao: "set", valor: true }])).toThrow();
});
test("primeiro contato não exige escolher enquadramento jurídico", () => {
  expect(proximaPergunta(null).campo).toBe("origem");
  expect(proximaPergunta({ origem: "INATIVA", dados: {} }).campo).toBe("cnpj");
  expect(proximaPergunta({ origem: "ABERTURA", dados: {} }).campo).toBe("responsavelNome");
});
test("template falha quando variável falta, em vez de enviar espaços vazios", () => {
  expect(() => preencherTexto("Procuração {{procuradorCnpj}}", {})).toThrow("procuradorCnpj");
  expect(preencherTexto("Olá {{nome}}", { nome: "Ana" })).toBe("Olá Ana");
});
test("institucional aprovado prevalece sobre variável manipulada", async () => {
  const service = criarRecursosComerciais({ db: { recursoComercial: { findUnique: async () => ({ id: "o", tipo: "ORIENTACAO", aprovadoEm: new Date(), texto: "{{procuradorCnpj}} {{nome}}", chave: "autorizar", versao: 2 }), findFirst: async () => ({ dados: { procuradorCnpj: "11222333000181" } }) } } });
  const p = await service.prepararOrientacao("o", { procuradorCnpj: "injetado", nome: "Ana" });
  expect(p.texto).toBe("11222333000181 Ana"); expect(p.referencia.versao).toBe(2);
});
test("cliente, identidade ambígua e humano bloqueiam o perfil comercial", () => {
  const r = { conversa: { telefoneE164: "5511999999999", chaveEscopo: "fila:5511999999999" }, mensagem: { registradaEm: new Date() }, vinculo: { situacao: "DESCONHECIDO" } };
  const decidir = r => decidirRespostaComercial({ r, flag: true, piloto: ["5511999999999"] });
  expect(decidir(r).responde).toBe(true);
  expect(decidir({ ...r, conversa: { ...r.conversa, portalClientId: "empresa" } }).responde).toBe(false);
  expect(decidir({ ...r, conversa: { ...r.conversa, atendidaDesde: new Date() } }).responde).toBe(false);
  expect(decidir({ ...r, vinculo: { situacao: "AMBIGUO" } }).responde).toBe(false);
  expect(decidirRespostaComercial({ r, flag: true, piloto: [] }).responde).toBe(false);
});
test("proposta pública não expõe preço interno, diagnóstico, tokenHash ou ids", async () => {
  const p = { id: "interno", onboardingId: "lead", versao: 3, status: "APROVADA", fichaVersao: 0, expiraEm: new Date(), tokenHash: "hash", snapshot: { destinatario: "Ana", opcoes: [], catalogoId: "privado", justificativa: "negociação interna", diagnostico: "privado" } };
  const s = criarPropostasComerciais({ db: { onboarding: { findUnique: async () => ({ versao: 0, status: "RASCUNHO" }) }, propostaComercial: { findFirst: async () => p } } });
  const r = await s.publico("a".repeat(43));
  expect(r.proposta).not.toHaveProperty("id"); expect(r.proposta).not.toHaveProperty("justificativa"); expect(r.proposta).not.toHaveProperty("catalogoId");
  await expect(s.publico("errado")).rejects.toMatchObject({ status: 404 });
});
