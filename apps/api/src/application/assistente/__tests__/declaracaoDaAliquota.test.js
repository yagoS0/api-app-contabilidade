// Declaração compartilhada e ferramenta reais; banco/autorização externa são dublês.
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
// Resolve o fonte deste checkout mesmo quando node_modules é compartilhado com outro worktree.
jest.mock("@contabilidade/shared/declaracao-nfse", () => jest.requireActual("../../../../../../packages/shared/src/nfse/declaracaoNfse.js"));
import { linhasDoEspelho, textoDeConfirmacao } from "@contabilidade/shared/declaracao-nfse";
import { executarFerramenta } from "../ferramentas/index.js";
import { TODAS_PERMISSOES_ASSISTENTE } from "../../whatsapp/permissoesAssistente.js";

const AUSENTE = "não informada; depende da configuração de emissão";
const DADOS = { tomadorDoc: "12345678000190", tomadorNome: "Tomador sintético", descricao: "Consultoria", valor: 1000, competencia: "2026-09" };
function contexto(perfis = []) {
  return {
    sessao: { ok: true, portalClientId: "pc-teste", userId: "u-teste", papel: "CLIENT_ADMIN", permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE] },
    conversa: { id: "cv-teste" }, prisma: {}, agora: new Date("2026-09-08T15:00:00Z"), janela: { aberta: true },
    servicos: { autorizarEmissaoDoCliente: async () => ({ ok: true }), listarPerfisEmissao: async () => perfis,
      criarPendencia: jest.fn(async ({ corpo }) => ({ texto: corpo, codigo: "A7K2" })) },
  };
}

it.each([null, undefined, ""])("alíquota ausente (%s) não atribui uma taxa à prefeitura", (aliquota) => {
  const dados = { tomador: { nome: "Tomador sintético" }, servico: { descricao: "Consultoria", valor: 1000, aliquota } };
  expect(linhasDoEspelho(dados).find(l => l.rotulo === "Alíquota de ISS").valor).toBe(AUSENTE);
  expect(textoDeConfirmacao(dados)).toContain(`Alíquota de ISS: ${AUSENTE}`);
});

it.each([0, 5])("alíquota informada %s permanece no resumo e no payload, sem mudar cálculo", async (aliquota) => {
  const ctx = contexto();
  const r = await executarFerramenta("preparar_emissao", { ...DADOS, aliquota }, ctx);
  expect(r.ok).toBe(true);
  const pedido = ctx.servicos.criarPendencia.mock.calls[0][0];
  expect(pedido.payload.servico.aliquota).toBe(aliquota);
  expect(pedido.corpo).toContain(`Alíquota de ISS: ${aliquota},00%`);
});

it("prévia sem alíquota continua declarando ausência e preserva null no payload", async () => {
  const ctx = contexto();
  const r = await executarFerramenta("preparar_emissao", DADOS, ctx);
  expect(r.ok).toBe(true);
  const pedido = ctx.servicos.criarPendencia.mock.calls[0][0];
  expect(pedido.payload.servico.aliquota).toBeNull();
  expect(pedido.corpo).toContain(`Alíquota de ISS: ${AUSENTE}`);
});

it("perfil escolhido permanece no pedido sem apresentar taxa de ISS ainda não resolvida", async () => {
  const ctx = contexto([{ id: "perfil-consultoria", nome: "Consultoria", codigoServicoNacional: "170101", pAliq: 5 }]);
  const r = await executarFerramenta("preparar_emissao", { ...DADOS, perfilId: "perfil-consultoria" }, ctx);
  expect(r.ok).toBe(true);
  const pedido = ctx.servicos.criarPendencia.mock.calls[0][0];
  expect(pedido.payload.perfilId).toBe("perfil-consultoria");
  expect(pedido.payload.servico.aliquota).toBeNull();
  expect(pedido.corpo).toContain("Perfil de serviço: Consultoria (170101)");
  expect(pedido.corpo).toContain(`Alíquota de ISS: ${AUSENTE}`);
  expect(pedido.corpo).not.toContain("Alíquota de ISS: 5,00%");
});
