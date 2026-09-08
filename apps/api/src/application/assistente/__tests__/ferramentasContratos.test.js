// Exercita as ferramentas com os serviços/serializers reais e banco em memória que honra filtros.
// Nenhum cliente fiscal, Meta, BrasilAPI ou modelo é chamado.
jest.mock("../../../infrastructure/db/prisma.js", () => {
  const db = {
    guide: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    portalInvoice: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    serviceInvoice: { findMany: jest.fn(), findFirst: jest.fn() },
    portalClient: { findUnique: jest.fn() },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
    companyDocument: { findMany: jest.fn() },
  };
  return { prisma: { ...db, $transaction: (ops) => Promise.all(ops) } };
});

import { prisma } from "../../../infrastructure/db/prisma.js";
import { executarFerramenta } from "../ferramentas/index.js";
import { EXECUTORES } from "../AcoesPendentesService.js";
import { TODAS_PERMISSOES_ASSISTENTE } from "../../whatsapp/permissoesAssistente.js";
import { listGuidesByCompany } from "../../guides/GuideService.js";

const AGORA = new Date("2026-09-08T12:00:00Z");
const EMPRESA = { id: "pc-1", cnpj: "11222333000181", companyId: "legacy-1" };
const GUIA = { id: "g1", portalClientId: "pc-1", tipo: "INSS", competencia: "2026-08", valor: 720, vencimento: new Date("2026-09-20"), paymentStatus: "OPEN", status: "PROCESSED", liberadaCliente: true };
const NOTA = { id: "n1", clientId: "pc-1", type: "NFSE", papel: "EMIT", emitenteDoc: EMPRESA.cnpj, numero: "8", competencia: new Date("2026-09-01"), issueDate: new Date("2026-09-02"), createdAt: new Date("2026-09-02"), total: 12000, status: "AUTORIZADA", tomadorNome: "Cliente de exemplo", tomadorDoc: "12345678000190", chaveAcesso: "1".repeat(50) };
const NOVA = { id: "si-9", companyId: "legacy-1", numeroNfse: "9", competencia: new Date("2026-09-01"), createdAt: new Date("2026-09-08"), updatedAt: new Date("2026-09-08"), valorServicos: 1500, status: "issued", tomadorDoc: "12345678000190", tomadorNome: "Cliente de exemplo", chaveAcesso: "2".repeat(50), rpsSerie: "00001", rpsNumero: "9" };
const silencio = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

function casa(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === "AND") return (Array.isArray(v) ? v : [v]).every((f) => casa(row, f));
    if (k === "OR") return v.some((f) => casa(row, f));
    if (k === "NOT") return !casa(row, v);
    const atual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.entries(v).every(([op, val]) => {
        if (op === "in") return val.includes(atual);
        if (op === "notIn") return !val.includes(atual);
        if (op === "not") return val === null ? atual != null : atual !== val;
        if (op === "gte") return atual != null && atual >= val;
        if (op === "gt") return atual != null && atual > val;
        if (op === "lt") return atual != null && atual < val;
        if (op === "lte") return atual != null && atual <= val;
        if (op === "contains") return String(atual || "").toLowerCase().includes(String(val).toLowerCase());
        if (op === "equals") return atual === val;
        return op === "mode";
      });
    }
    return atual === v || (v === null && atual == null);
  });
}

function tabela(model, rows) {
  model.findMany.mockImplementation(async ({ where, orderBy, skip = 0, take } = {}) => {
    const sorted = rows.filter((r) => casa(r, where)).slice();
    const ordens = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    sorted.sort((a, b) => {
      for (const ordem of ordens) for (const [key, dir] of Object.entries(ordem)) {
        if (a[key] > b[key]) return dir === "desc" ? -1 : 1;
        if (a[key] < b[key]) return dir === "desc" ? 1 : -1;
      }
      return 0;
    });
    return sorted.slice(skip, take ? skip + take : undefined);
  });
  model.findFirst?.mockImplementation(async ({ where }) => rows.find((r) => casa(r, where)) || null);
  model.count?.mockImplementation(async ({ where }) => rows.filter((r) => casa(r, where)).length);
}

function contexto(over = {}) {
  return {
    sessao: { ok: true, portalClientId: "pc-1", userId: "u1", papel: "CLIENT_ADMIN", permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE] },
    conversa: { id: "cv1" }, prisma, janela: { aberta: true }, agora: AGORA, log: silencio,
    enviarDocumento: jest.fn(async () => ({ wamid: "wamid.fixture" })),
    servicos: {},
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  tabela(prisma.guide, [GUIA]);
  tabela(prisma.portalInvoice, [NOTA]);
  tabela(prisma.serviceInvoice, []);
  tabela(prisma.companyDocument, []);
  prisma.portalClient.findUnique.mockResolvedValue(EMPRESA);
});

describe("guias: pedido natural → consulta real → id utilizável", () => {
  it("preserva o id após o serializer real para permitir o envio do PDF", async () => {
    const c = contexto({ servicos: { getGuidePdfBuffer: jest.fn(async () => Buffer.from("%PDF")) } });
    const lista = await executarFerramenta("listar_guias", {}, c);
    expect(lista.guias[0].guideId).toBe("g1");
    const envio = await executarFerramenta("enviar_pdf_da_guia", { guideId: lista.guias[0].guideId }, c);
    expect(envio.enviado).toBe(true);
  });

  it.each(["OPEN", "PAID", "OVERDUE"])("filtra situação de pagamento %s sem confundir processamento", async (status) => {
    tabela(prisma.guide, [{ ...GUIA, id: "alvo", paymentStatus: status }, { ...GUIA, id: "outra", paymentStatus: status === "PAID" ? "OPEN" : "PAID" }]);
    const r = await executarFerramenta("listar_guias", { status }, contexto());
    expect(r.guias.map((g) => g.guideId)).toEqual(["alvo"]);
    expect(prisma.guide.findMany.mock.calls[0][0].where).toMatchObject({ portalClientId: "pc-1", paymentStatus: status, liberadaCliente: true });
  });

  it("mantém separado o filtro de processamento usado pelo portal", async () => {
    await listGuidesByCompany({ portalClientId: "pc-1", status: "PROCESSED" });
    expect(prisma.guide.findMany.mock.calls[0][0].where.status).toBe("PROCESSED");
  });

  it("busca o mês do vencimento sem trocar pela competência", async () => {
    tabela(prisma.guide, [GUIA, { ...GUIA, id: "proximo", competencia: "2026-09", vencimento: new Date("2026-10-20") }]);
    const r = await executarFerramenta("listar_guias", { mesVencimento: "2026-09" }, contexto());
    expect(r.guias.map((g) => g.guideId)).toEqual(["g1"]);
    expect(r.guias[0].competencia).toBe("2026-08");
  });

  it("permite continuar a lista de guias para selecionar uma guia antiga", async () => {
    tabela(prisma.guide, Array.from({ length: 23 }, (_, i) => ({ ...GUIA, id: `g${i}`, updatedAt: new Date(AGORA.getTime() - i * 1000) })));
    const primeira = await executarFerramenta("listar_guias", { pagina: 1 }, contexto());
    const segunda = await executarFerramenta("listar_guias", { pagina: 2 }, contexto());
    expect(primeira).toMatchObject({ temMais: true, proximaPagina: 2 });
    expect(segunda.guias).toHaveLength(3);
    expect(segunda.guias[0].guideId).toBe("g20");
  });
});

describe("quanto devo: ausência de valor ou vencimento não apaga dívida", () => {
  it("não apresenta zero como total quando o valor não foi informado", async () => {
    tabela(prisma.guide, [{ ...GUIA, valor: null }]);
    const r = await executarFerramenta("quanto_devo", {}, contexto());
    expect(r).toMatchObject({ total: null, totalFormatado: null, totalParcial: true, semValor: 1 });
  });

  it("inclui guia sem vencimento, mantém centavos e distingue subtotal conhecido", async () => {
    tabela(prisma.guide, [{ ...GUIA, id: "a", valor: 0.1 }, { ...GUIA, id: "b", valor: 0.2 }, { ...GUIA, id: "c", valor: null, vencimento: null }]);
    const r = await executarFerramenta("quanto_devo", {}, contexto());
    expect(r.quantidade).toBe(3);
    expect(r.subtotalConhecido).toBe(0.3);
    expect(r.total).toBeNull();
    expect(r.guias.find((g) => g.guideId === "c").vencimento).toBeNull();
  });
});

describe("notas: o chat encontra a mesma nota que acabou de emitir", () => {
  it("serializa competência Date do Prisma em AAAA-MM", async () => {
    const r = await executarFerramenta("listar_notas", {}, contexto());
    expect(r.notas[0].competencia).toBe("2026-09");
  });

  it("inclui emissão recente da ServiceInvoice e permite enviar esse id", async () => {
    tabela(prisma.serviceInvoice, [NOVA, { ...NOVA, id: "alheia", companyId: "outra-empresa" }]);
    const gerarDanfseDaNota = jest.fn(async () => ({ pdf: Buffer.from("%PDF"), nomeArquivo: "danfse.pdf" }));
    const c = contexto({ servicos: { gerarDanfseDaNota } });
    const r = await executarFerramenta("listar_notas", {}, c);
    expect(r.notas[0]).toMatchObject({ notaId: NOVA.id, numero: "9", confirmadaPeloAdn: false });
    expect(r.notas).toHaveLength(2);
    await executarFerramenta("danfse_da_nota", { notaId: r.notas[0].notaId }, c);
    expect(gerarDanfseDaNota).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "pc-1", notaId: NOVA.id }));
  });

  it("confirma cancelamento da emissão recente com tomador, valor e data disponíveis", async () => {
    tabela(prisma.serviceInvoice, [NOVA]);
    const criarPendencia = jest.fn(async ({ corpo }) => ({ codigo: "A7K2", texto: corpo }));
    const c = contexto({ servicos: { criarPendencia, resolveLegacyCompanyId: async () => "legacy-1", autorizarEmissaoDoCliente: async () => ({ ok: true }) } });
    const r = await executarFerramenta("preparar_cancelamento", { notaId: NOVA.id, cMotivo: "2", justificativa: "O serviço solicitado não foi prestado" }, c);
    expect(r.ok).toBe(true);
    const { corpo } = criarPendencia.mock.calls[0][0];
    expect(corpo).toContain("Cliente de exemplo");
    expect(corpo).toMatch(/1.500,00/);
    expect(corpo).toContain("08/09/2026");
  });

  it("apresenta o rótulo real do motivo de cancelamento em vez de um código sem descrição", async () => {
    const criarPendencia = jest.fn(async ({ corpo }) => ({ codigo: "A7K2", texto: corpo }));
    await executarFerramenta("preparar_cancelamento", { notaId: NOTA.id, cMotivo: "2", justificativa: "O serviço solicitado não foi prestado" }, contexto({ servicos: { criarPendencia, autorizarEmissaoDoCliente: async () => ({ ok: true }) } }));
    expect(criarPendencia.mock.calls[0][0].corpo).toContain("2 — Serviço não prestado");
  });

  it("não duplica a emissão quando o ADN já trouxe a mesma chave", async () => {
    tabela(prisma.serviceInvoice, [{ ...NOVA, numeroNfse: NOTA.numero, chaveAcesso: NOTA.chaveAcesso }]);
    const r = await executarFerramenta("listar_notas", {}, contexto());
    expect(r.notas.map((n) => n.notaId)).toEqual(["n1"]);
  });

  it("encontra recebida com papel legado nulo pelo documento do tomador", async () => {
    tabela(prisma.portalInvoice, [{ ...NOTA, id: "recebida", papel: null, emitenteDoc: "12345678000190", tomadorDoc: EMPRESA.cnpj }]);
    const r = await executarFerramenta("listar_notas", { direcao: "recebidas" }, contexto());
    expect(r.notas.map((n) => n.notaId)).toEqual(["recebida"]);
  });

  it("permite procurar pelo número fora das 20 notas recentes", async () => {
    tabela(prisma.portalInvoice, Array.from({ length: 25 }, (_, i) => ({ ...NOTA, id: `n${i}`, numero: String(i + 1), issueDate: new Date(AGORA.getTime() - i * 1000) })));
    const r = await executarFerramenta("listar_notas", { busca: "25" }, contexto());
    expect(r.notas.map((n) => n.numero)).toEqual(["25"]);
  });

  it("sinaliza e permite continuar uma lista truncada", async () => {
    tabela(prisma.portalInvoice, Array.from({ length: 25 }, (_, i) => ({ ...NOTA, id: `n${i}`, issueDate: new Date(AGORA.getTime() - i * 1000) })));
    const primeira = await executarFerramenta("listar_notas", { pagina: 1 }, contexto());
    const segunda = await executarFerramenta("listar_notas", { pagina: 2 }, contexto());
    expect(primeira).toMatchObject({ temMais: true, proximaPagina: 2 });
    expect(segunda.notas).toHaveLength(5);
  });
});

describe("documentos: seleção não para nos primeiros 30 arquivos", () => {
  it("busca pelo nome e mantém o escopo da empresa", async () => {
    tabela(prisma.companyDocument, [
      ...Array.from({ length: 35 }, (_, i) => ({ id: `d${i}`, portalClientId: "pc-1", tipo: "CONTRATO_SOCIAL", nome: `Contrato ${i}`, createdAt: new Date(AGORA.getTime() - i * 1000) })),
      { id: "alvara", portalClientId: "pc-1", tipo: "OUTRO", nome: "Alvará municipal", createdAt: new Date("2026-01-01") },
      { id: "alheio", portalClientId: "pc-2", tipo: "OUTRO", nome: "Alvará municipal", createdAt: AGORA },
    ]);
    const r = await executarFerramenta("listar_documentos", { busca: "Alvará" }, contexto());
    expect(r.documentos.map((d) => d.documentId)).toEqual(["alvara"]);
  });

  it("indica que há outra página e permite continuar", async () => {
    tabela(prisma.companyDocument, Array.from({ length: 35 }, (_, i) => ({ id: `d${i}`, portalClientId: "pc-1", tipo: "CONTRATO_SOCIAL", nome: `Contrato ${i}`, createdAt: new Date(AGORA.getTime() - i * 1000) })));
    const primeira = await executarFerramenta("listar_documentos", { pagina: 1 }, contexto());
    const segunda = await executarFerramenta("listar_documentos", { pagina: 2 }, contexto());
    expect(primeira).toMatchObject({ temMais: true, proximaPagina: 2 });
    expect(segunda.documentos).toHaveLength(5);
  });
});

describe("atos confirmados: resultado fiscal aceito sobrevive à falha local", () => {
  it("cancelamento aceito seguido de erro ao atualizar banco não afirma que nada foi cancelado", async () => {
    const sendEvent = jest.fn(async () => ({ status: "accepted" }));
    const r = await EXECUTORES.CANCELAR_NFSE({
      acao: { portalClientId: "pc-1", payload: { chaveAcesso: NOTA.chaveAcesso, numero: "8" } }, log: silencio,
      deps: { resolveLegacyCompanyId: async () => "legacy-1", NfseService: { sendEvent }, NfseRepository: { updateByChaveAcesso: async () => { throw new Error("banco indisponível"); } } },
    });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ filaHumana: true, resultado: { status: "accepted", sincronizacaoPendente: true } });
    expect(r.texto).toMatch(/aceit/i);
    expect(r.texto).not.toMatch(/nada foi cancelado|cancelamento não saiu/i);
  });

  it("erro não classificado da emissão não afirma que a nota foi recusada antes de sair", async () => {
    const r = await EXECUTORES.EMITIR_NFSE({
      acao: { portalClientId: "pc-1", payload: {} }, log: silencio,
      deps: { resolveLegacyCompanyId: async () => "legacy-1", NfseService: { issue: async () => { throw new Error("Falha ao gravar resultado"); } } },
    });
    expect(r).toMatchObject({ filaHumana: true, resultado: { indeterminado: true } });
    expect(r.texto).not.toMatch(/recusada antes de sair|nada foi emitido/i);
  });

  it("recálculo sem guia na releitura não confirma atualização com valor zero inventado", async () => {
    const r = await EXECUTORES.RECALCULAR_GUIA({
      acao: { portalClientId: "pc-1", payload: { guideId: "g1" } }, log: silencio, agora: AGORA,
      client: { guide: { findFirst: async () => ({ ...GUIA, tipo: "SIMPLES", source: "SERPRO" }), findUnique: async () => null } },
      deps: { canGuideRecalculate: () => true, isGuideOverdue: () => true, comContextoSerpro: async (_c, fn) => fn(), capturePgdasGuideForCompany: async () => ({ guide: { guideId: "g1" } }), markGuideOpenBySerpro: async () => {} },
    });
    expect(r.filaHumana).toBe(true);
    expect(r.texto).not.toMatch(/Guia atualizada:|R\$\s*0,00/);
  });
});

describe("entrada de emissão sem strict do provedor: validação local antes de serviços", () => {
  it.each([
    ["valor textual", { valor: "mil reais" }],
    ["campo não definido", { acessoDireto: true }],
    ["retenção textual", { valorRetidoIRRF: "15" }],
    ["ISS retido textual", { issRetido: "sim" }],
    ["endereço com campo extra", { endereco: { cMun: "3304557", CEP: "20000000", xLgr: "Rua", nro: "1", xCpl: null, xBairro: "Centro", permissao: true } }],
    ["endereço com número de município inválido", { endereco: { cMun: 3304557, CEP: "20000000", xLgr: "Rua", nro: "1", xCpl: null, xBairro: "Centro" } }],
    ["objeto nulo", null],
  ])("recusa %s sem consultar autorização nem criar pendência", async (_nome, extra) => {
    const autorizarEmissaoDoCliente = jest.fn(async () => ({ ok: true }));
    const criarPendencia = jest.fn();
    const dados = extra === null ? null : { tomadorDoc: "12345678000190", tomadorNome: "Cliente de exemplo", descricao: "Consultoria", valor: 1000, ...extra };
    const r = await executarFerramenta("preparar_emissao", dados, contexto({ servicos: { autorizarEmissaoDoCliente, criarPendencia } }));
    expect(r).toMatchObject({ ok: false, motivo: "DADOS_EMISSAO_INVALIDOS" });
    expect(autorizarEmissaoDoCliente).not.toHaveBeenCalled();
    expect(criarPendencia).not.toHaveBeenCalled();
  });
});
