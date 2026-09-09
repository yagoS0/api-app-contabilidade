import { processarEmissaoGuiada } from "../EmissaoGuiadaWhatsappService.js";
import { responderMenuWhatsapp, IDS_MENU_WHATSAPP } from "../MenuWhatsappService.js";
import { prepararTomadorDoCliente } from "../../tomador/prepararTomadorDoCliente.js";

jest.mock("@anthropic-ai/sdk", () => ({ __esModule: true, default: jest.fn(() => { throw new Error("PROIBIDO_USAR_ANTHROPIC_NO_TESTE"); }) }));
jest.mock("../WhatsappLeaseService.js", () => ({ adquirirLease: jest.fn(async () => ({ id: "lease", token: "owner" })), renovarLease: jest.fn(async () => true), liberarLease: jest.fn(async () => {}) }));
const DOC = "11222333000181";
const AGORA = new Date("2026-09-09T15:00:00Z");
const ENDERECO = { CEP: "20040002", cMun: "3304557", xLgr: "Rua Sintética", nro: "10", xBairro: "Centro" };
const sessao = { ok: true, portalClientId: "pc-fixture", userId: "user-fixture", papel: "CLIENT_ADMIN", permissoesAssistente: ["EMISSAO_NFSE"] };
const vinculo = { situacao: "VINCULADO", empresas: [{ portalClientId: sessao.portalClientId }] };

function casa(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some(w => casa(row, w));
    if (k === "conversa") return true; // Guardas SQL reais são exercitadas no PostgreSQL do CI.
    if (v && typeof v === "object" && !(v instanceof Date)) return Object.entries(v).every(([op, valor]) => {
      if (op === "notIn") return !valor.includes(row[k]);
      if (op === "in") return valor.includes(row[k]);
      if (op === "gte") return row[k] >= valor;
      if (op === "lte") return row[k] <= valor;
      if (op === "gt") return row[k] > valor;
      if (op === "lt") return row[k] < valor;
      return row[k] === valor;
    });
    return row[k] === v || (row[k] == null && v === null);
  });
}

function fixture() {
  let seq = 0;
  const conversa = { id: "cv-fixture", portalClientId: sessao.portalClientId, telefoneE164: "5521999998888", escopoVerificado: true, atendidaPor: null, atendidaDesde: null, excluidaEm: null, automacaoInvalidadaEm: null };
  const tabelas = {};
  const model = nome => {
    tabelas[nome] = [];
    return {
      findFirst: jest.fn(async ({ where = {} } = {}) => tabelas[nome].find(r => casa(r, where)) || null),
      findUnique: jest.fn(async ({ where }) => tabelas[nome].find(r => casa(r, where)) || null),
      findMany: jest.fn(async ({ where = {} } = {}) => tabelas[nome].filter(r => casa(r, where))),
      create: jest.fn(async ({ data }) => {
        if (nome === "etapaEmissaoWhatsapp" && tabelas[nome].some(r => r.mensagemId === data.mensagemId)) throw new Error("UNIQUE_MESSAGE");
        const row = { id: `row-${++seq}`, createdAt: AGORA, ...data }; tabelas[nome].push(row); return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => { const rows = tabelas[nome].filter(r => casa(r, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length }; }),
      update: jest.fn(async ({ where, data }) => { const row = tabelas[nome].find(r => casa(r, where)); if (!row) throw new Error("NOT_FOUND"); Object.assign(row, data); return row; }),
    };
  };
  const client = Object.fromEntries(["rascunhoEmissaoWhatsapp", "etapaEmissaoWhatsapp", "acaoPendenteWhatsapp", "mensagemWhatsapp", "conversaWhatsapp"].map(n => [n, model(n)]));
  tabelas.conversaWhatsapp.push(conversa);
  client.$transaction = async fn => {
    const snapshot = structuredClone(tabelas);
    try { return await fn(client); } catch (e) { Object.keys(snapshot).forEach(k => { tabelas[k] = snapshot[k]; }); throw e; }
  };
  client.contatoWhatsapp = { findMany: jest.fn(async () => [{ userId: sessao.userId, permissoesAssistente: sessao.permissoesAssistente }]) };
  client.companyClientUser = { findUnique: jest.fn(async () => ({ role: "CLIENT_ADMIN", status: "ACTIVE" })) };
  const emitir = jest.fn(async () => ({ texto: "Nota emitida — número 123.", resultado: { status: "issued", numero: "123" }, filaHumana: false }));
  const servicos = {
    resolveLegacyCompanyId: jest.fn(async () => "legacy-fixture"),
    listarTomadoresEmitidos: jest.fn(async () => ({ tomadores: [], motivo: null })),
    buscarTomadoresEmitidos: jest.fn(async () => ({ tomadores: new Map(), motivo: null })),
    municipiosIbgeOuNulo: jest.fn(async () => []),
    consultarCnpj: jest.fn(async () => ({ ok: true, tomador: { nome: "Tomador Sintético", endereco: ENDERECO } })),
    consultarCep: jest.fn(async () => ({ ok: true, endereco: { ...ENDERECO, nro: null } })),
    prepararTomadorDoCliente,
    autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true })),
    listarPerfisEmissao: jest.fn(async () => []),
    prepararDadosFiscaisDoCliente: jest.fn(async ({ servico, competencia }) => ({ ok: true, competencia, regime: 3, pTotTribSN: 6, aliquotaDps: { informar: false }, servico: { ...servico, codigoServicoNacional: "010101", aliquota: 2, issRetido: false }, origens: { pTotTribSN: "historico" }, avisos: [] })),
    validateNfsePayload: jest.fn(data => ({ ok: true, data })),
    executores: { EMITIR_NFSE: emitir },
    acoesDeps: { autorizarPermissaoDaAcao: async () => ({ ok: true }), autorizarEmissaoDoCliente: async () => ({ ok: true }) },
  };
  const conferirAcesso = jest.fn(async () => { if (conversa.atendidaPor || conversa.atendidaDesde || conversa.excluidaEm) throw new Error("ACESSO_REVOGADO"); });
  const args = { conversa, sessao, agora: AGORA, client, conferirAcesso, servicos, log: { error: jest.fn(), warn: jest.fn() } };
  const novaMensagem = texto => { const mensagem = { id: `in-${++seq}`, conversaId: conversa.id, direcao: "in", tipo: "text", corpo: texto, registradaEm: new Date(AGORA.getTime() + seq * 1000), respondidaPelaIaEm: null }; tabelas.mensagemWhatsapp.push(mensagem); return mensagem; };
  const responder = (texto, extra = {}) => processarEmissaoGuiada({ ...args, mensagem: novaMensagem(texto), texto, ...extra });
  return { args, responder, novaMensagem, client, servicos, emitir, conversa, tabelas, conferirAcesso };
}

async function revisar(f) {
  await f.responder("emitir nota", { iniciar: true });
  await f.responder(DOC);
  return f.responder("Descrição: Consultoria mensal; valor: 1.500,50; competência: atual");
}

describe("conversação guiada persistente sem IA", () => {
  let fetchOriginal;
  beforeEach(() => { fetchOriginal = global.fetch; global.fetch = jest.fn(() => { throw new Error("REDE_REAL_PROIBIDA"); }); });
  afterEach(() => { expect(global.fetch).not.toHaveBeenCalled(); global.fetch = fetchOriginal; });

  test("continuar sem rascunho não inicia emissão", async () => {
    const f = fixture();
    expect(await f.responder("continuar")).toEqual({ tratado: false });
    expect(f.tabelas.rascunhoEmissaoWhatsapp).toHaveLength(0);
  });

  test("CNPJ, serviço/valor/competência, revisão e código executam uma vez; sim nunca emite", async () => {
    const f = fixture();
    const r = await revisar(f);
    expect(r).toMatchObject({ tratado: true, motivo: "EMISSAO_REVISAR" });
    expect(r.texto).toContain("Tomador Sintético");
    expect(f.servicos.consultarCnpj).toHaveBeenCalledTimes(1);
    expect(f.emitir).not.toHaveBeenCalled();
    const codigo = f.tabelas.acaoPendenteWhatsapp[0].codigo;
    await f.responder("sim");
    expect(f.emitir).not.toHaveBeenCalled();
    const mensagem = f.novaMensagem(`CONFIRMAR ${codigo}`);
    const primeiro = await processarEmissaoGuiada({ ...f.args, mensagem, texto: mensagem.corpo });
    const repetido = await processarEmissaoGuiada({ ...f.args, mensagem, texto: mensagem.corpo });
    expect(primeiro.texto).toContain("Nota emitida");
    expect(repetido).toEqual(primeiro);
    expect(f.emitir).toHaveBeenCalledTimes(1);
  });

  test("reentrega e nova instância retomam a mesma pergunta sem coletar duas vezes", async () => {
    const f = fixture();
    await f.responder("emitir nota", { iniciar: true });
    const mensagem = f.novaMensagem(DOC);
    const r = await processarEmissaoGuiada({ ...f.args, mensagem, texto: DOC });
    const versao = f.tabelas.rascunhoEmissaoWhatsapp[0].versao;
    expect(await processarEmissaoGuiada({ ...f.args, mensagem, texto: DOC })).toEqual(r);
    expect(f.tabelas.rascunhoEmissaoWhatsapp[0].versao).toBe(versao);
    expect(f.servicos.consultarCnpj).toHaveBeenCalledTimes(1);
    expect((await f.responder("Consultoria contábil")).texto).toMatch(/valor/i);
    expect(f.tabelas.rascunhoEmissaoWhatsapp[0].estado.origens.tomadorNome).toBe("cnpj");
  });

  test("correção troca código, preserva coleta e cancela autorização antiga", async () => {
    const f = fixture(); await revisar(f);
    const antiga = f.tabelas.acaoPendenteWhatsapp[0];
    const r = await f.responder("corrigir valor: 2.000,00");
    expect(r.motivo).toBe("EMISSAO_REVISAR");
    expect(antiga.status).toBe("cancelada");
    expect(f.tabelas.acaoPendenteWhatsapp[1].codigo).not.toBe(antiga.codigo);
    await f.responder(`CONFIRMAR ${antiga.codigo}`);
    expect(f.emitir).not.toHaveBeenCalled();
    expect(f.tabelas.rascunhoEmissaoWhatsapp[0].estado.dados.valor).toBe(2000);
  });

  test("falha após correção não deixa código antigo utilizável", async () => {
    const f = fixture(); await revisar(f);
    f.servicos.prepararDadosFiscaisDoCliente.mockRejectedValueOnce(new Error("falha controlada"));
    await expect(f.responder("corrigir valor: 2.000,00")).rejects.toThrow("falha controlada");
    expect(f.tabelas.acaoPendenteWhatsapp[0].status).toBe("cancelada");
  });

  test("novo CPF não consulta CNPJ; pergunta nome/CEP e completa o endereço", async () => {
    const f = fixture(); await f.responder("emitir nota", { iniciar: true });
    await f.responder("52998224725");
    await f.responder("Descrição: Consultoria; valor: 900,00; competência: atual");
    expect(f.servicos.consultarCnpj).not.toHaveBeenCalled();
    await f.responder("Nome: Pessoa Sintética; CEP: 20040-002; número: 25");
    expect(f.servicos.consultarCep).toHaveBeenCalled();
    expect(f.tabelas.acaoPendenteWhatsapp.at(-1)?.payload.tomador.endereco).toMatchObject({ CEP: "20040002", nro: "25", xBairro: "Centro" });
  });

  test("cadastro fiscal incompleto encaminha preservando os dados e sem perguntar tributos", async () => {
    const f = fixture();
    f.servicos.prepararDadosFiscaisDoCliente.mockResolvedValue({ ok: false, motivo: "FISCAL_INCOMPLETO", encaminharEscritorio: true });
    const r = await revisar(f);
    expect(r.filaHumana).toBe(true);
    expect(f.tabelas.rascunhoEmissaoWhatsapp[0].estado.dados.valor).toBe(1500.5);
    expect(f.tabelas.acaoPendenteWhatsapp).toHaveLength(0);
  });

  test("outro usuário não lê recibo e troca de empresa/corte não retoma rascunho", async () => {
    const f = fixture(); const mensagem = f.novaMensagem("emitir nota");
    await processarEmissaoGuiada({ ...f.args, mensagem, texto: mensagem.corpo, iniciar: true });
    await expect(processarEmissaoGuiada({ ...f.args, sessao: { ...sessao, userId: "outro" }, mensagem, texto: DOC })).rejects.toMatchObject({ codigo: "AUTOMACAO_INVALIDADA" });
    expect((await f.responder(DOC, { sessao: { ...sessao, portalClientId: "outra" } })).tratado).toBe(false);
    f.conversa.automacaoInvalidadaEm = new Date(AGORA.getTime() + 1);
    expect((await f.responder(DOC)).tratado).toBe(false);
  });

  test("menu conduz emissão mesmo com texto livre/IA desligados", async () => {
    const f = fixture(); const cloud = Object.fromEntries(["enviarTexto", "enviarLista", "enviarBotoes"].map(n => [n, jest.fn(async () => ({ wamid: `wamid-${Math.random()}` }))]));
    const atender = async (texto, interacao = null) => {
      const mensagem = f.novaMensagem(texto);
      return responderMenuWhatsapp({ registro: { conversa: f.conversa, mensagem, vinculo }, texto, interacao, agora: AGORA,
        client: f.client, cloud, textoLivreDisponivel: false, servicosColeta: f.servicos, conferirJanela: async () => ({ situacao: "ABERTA" }), resolverVinculo: async () => vinculo });
    };
    expect((await atender("", { id: IDS_MENU_WHATSAPP.CLIENTE_EMISSAO })).acao).toBe("EMISSAO_GUIADA");
    await atender(DOC);
    await atender("Descrição: Consultoria; valor: 950,00; competência: atual");
    expect(f.conversa.atendidaDesde).toBeNull();
    expect(f.tabelas.acaoPendenteWhatsapp).toHaveLength(1);
    expect(f.emitir).not.toHaveBeenCalled();
  });

  test("pausa explícita responde sem IA e retoma pelo texto, preservando a coleta", async () => {
    const f = fixture(); await f.responder("emitir nota", { iniciar: true }); await f.responder(DOC);
    expect(await f.responder("pausar")).toMatchObject({ tratado: true, motivo: "COLETA_PAUSADA" });
    expect((await f.responder("preciso da minha guia")).tratado).toBe(false);
    expect((await f.responder("continuar emissão")).texto).toMatch(/serviço/i);
    expect(f.tabelas.rascunhoEmissaoWhatsapp[0].estado.dados.tomadorDoc).toBe(DOC);
  });

  test("primeira mensagem pode trazer todos os dados básicos", async () => {
    const f = fixture();
    const r = await f.responder(`Quero emitir uma nota. CNPJ: ${DOC}; descrição: Consultoria; valor: 1200,00; competência: atual`);
    expect(r.motivo).toBe("EMISSAO_REVISAR");
    expect(f.tabelas.acaoPendenteWhatsapp).toHaveLength(1);
  });

  test("múltiplos perfis requerem uma escolha real antes de preparar", async () => {
    const f = fixture();
    f.servicos.listarPerfisEmissao.mockResolvedValue([{ id: "p1", nome: "Consultoria" }, { id: "p2", nome: "Treinamento" }]);
    const r = await revisar(f);
    expect(r.texto).toContain("perfil");
    expect(f.tabelas.acaoPendenteWhatsapp).toHaveLength(0);
    const escolhido = await f.responder("", { interacao: { id: r.opcoes[1].id } });
    expect(escolhido.motivo).toBe("EMISSAO_REVISAR");
    expect(f.tabelas.acaoPendenteWhatsapp[0].payload.perfilId).toBe("p2");
    expect((await f.responder("", { interacao: { id: r.opcoes[0].id } })).motivo).toBe("OPCAO_ANTIGA");
    expect(f.tabelas.acaoPendenteWhatsapp).toHaveLength(1);
  });

  test("crash após executor recupera a resposta sem executar novamente", async () => {
    const f = fixture(); await revisar(f);
    const codigo = f.tabelas.acaoPendenteWhatsapp[0].codigo;
    const mensagem = f.novaMensagem(`CONFIRMAR ${codigo}`);
    f.client.etapaEmissaoWhatsapp.create.mockRejectedValueOnce(new Error("crash após ato"));
    await expect(processarEmissaoGuiada({ ...f.args, mensagem, texto: mensagem.corpo })).rejects.toThrow("crash após ato");
    const r = await processarEmissaoGuiada({ ...f.args, mensagem, texto: mensagem.corpo });
    expect(r.texto).toContain("Nota emitida");
    expect(f.emitir).toHaveBeenCalledTimes(1);
    expect((await f.responder(`CONFIRMAR ${codigo}`)).texto).toContain("Nota emitida");
    expect(f.emitir).toHaveBeenCalledTimes(1);
  });

  test("reserva sem desfecho impede novo pedido mesmo após expiração do rascunho", async () => {
    const f = fixture(); await revisar(f);
    f.tabelas.acaoPendenteWhatsapp[0].status = "confirmada";
    f.tabelas.rascunhoEmissaoWhatsapp[0].expiraEm = new Date(0);
    const r = await f.responder("emitir nota", { iniciar: true });
    expect(r.filaHumana).toBe(true);
    expect(f.emitir).not.toHaveBeenCalled();
    expect(f.tabelas.acaoPendenteWhatsapp).toHaveLength(1);
  });

  test("falha na gravação de recibo reverte rascunho e pendência juntos", async () => {
    const f = fixture(); await f.responder("emitir nota", { iniciar: true }); await f.responder(DOC);
    f.client.etapaEmissaoWhatsapp.create.mockRejectedValueOnce(new Error("recibo indisponível"));
    await expect(f.responder("Descrição: Consultoria; valor: 950,00; competência: atual")).rejects.toThrow("recibo indisponível");
    expect(await f.client.acaoPendenteWhatsapp.findMany()).toHaveLength(0);
    expect((await f.client.rascunhoEmissaoWhatsapp.findUnique({ where: { conversaId: f.conversa.id } })).estado.etapa).toBe("DESCRICAO");
  });

  test("preparação usa também o validador real de NFS-e", async () => {
    const f = fixture(); delete f.servicos.validateNfsePayload;
    expect((await revisar(f)).motivo).toBe("EMISSAO_REVISAR");
    expect(f.emitir).not.toHaveBeenCalled();
  });

  test("confirmação seguida de correção mantém coleta utilizável e não emite o resumo antigo", async () => {
    const f = fixture(); await revisar(f);
    const codigo = f.tabelas.acaoPendenteWhatsapp[0].codigo;
    const confirmacao = f.novaMensagem(`CONFIRMAR ${codigo}`);
    const correcao = f.novaMensagem("corrigir valor: 800,00");
    expect((await processarEmissaoGuiada({ ...f.args, mensagem: confirmacao, texto: confirmacao.corpo })).codigo).toBe("CONFIRMACAO_SUPERADA");
    expect(f.emitir).not.toHaveBeenCalled();
    const r = await processarEmissaoGuiada({ ...f.args, mensagem: correcao, texto: correcao.corpo });
    expect(r.motivo).toBe("EMISSAO_REVISAR");
    expect(f.tabelas.acaoPendenteWhatsapp.at(-1).payload.servico.valor).toBe(800);
  });

  test("iniciar nova coleta invalida pendência antiga preparada fora do fluxo", async () => {
    const f = fixture();
    f.tabelas.acaoPendenteWhatsapp.push({ id: "antiga", conversaId: f.conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId, status: "pendente", codigo: "A7K2", expiraEm: new Date(AGORA.getTime() + 60000) });
    await f.responder("emitir nota", { iniciar: true });
    expect(f.tabelas.acaoPendenteWhatsapp[0].status).toBe("cancelada");
    expect(f.emitir).not.toHaveBeenCalled();
  });

  test("código solto sem coleta não cria estado quebrado para a próxima mensagem", async () => {
    const f = fixture();
    expect((await f.responder("CONFIRMAR A7K2")).codigo).toBe("SEM_PENDENCIA");
    expect((await f.responder("não sei")).texto).toContain("CPF/CNPJ");
    await f.responder(DOC);
    expect((await f.responder("Descrição: Consultoria; valor: 900,00; competência: atual")).motivo).toBe("EMISSAO_REVISAR");
  });

  test("retomada com dados e correção após expiração aproveitam a mesma coleta", async () => {
    const f = fixture(); await revisar(f); await f.responder("pausar");
    expect((await f.responder("Quero emitir nota. valor: 1300,00")).motivo).toBe("EMISSAO_REVISAR");
    const atual = f.tabelas.acaoPendenteWhatsapp.at(-1);
    expect(atual.payload.servico.valor).toBe(1300);
    atual.expiraEm = new Date(0);
    expect((await f.responder("corrigir valor: 1500,00")).motivo).toBe("EMISSAO_REVISAR");
    expect(f.tabelas.acaoPendenteWhatsapp.at(-1).payload.servico.valor).toBe(1500);
    expect(f.emitir).not.toHaveBeenCalled();
  });

  test("cancelamento recebido antes do resumo novo não cancela esse pedido", async () => {
    const f = fixture(); await revisar(f);
    const cancelar = f.novaMensagem("CANCELAR PEDIDO");
    f.tabelas.acaoPendenteWhatsapp[0].createdAt = new Date(cancelar.registradaEm.getTime() + 1000);
    expect((await processarEmissaoGuiada({ ...f.args, mensagem: cancelar, texto: cancelar.corpo })).codigo).toBe("CANCELAMENTO_ANTERIOR_RESUMO");
    expect(f.tabelas.acaoPendenteWhatsapp[0].status).toBe("pendente");
  });
});
