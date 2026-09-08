import { responderMenuWhatsapp, botoesDoCliente, linhasDoCliente, IDS_MENU_WHATSAPP, acaoDoTextoLivre } from "../MenuWhatsappService.js";

const AGORA = new Date("2026-09-08T15:00:00.000Z");
const janelaAberta = jest.fn(async () => ({ situacao: "ABERTA" }));
const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function registro({ cliente = false, texto = "oi", atendidaDesde = null } = {}) {
  const vinculo = cliente
    ? { situacao: "VINCULADO", empresas: [{ portalClientId: "pc1" }] }
    : { situacao: "DESCONHECIDO", empresas: [] };
  return {
    conversa: { id: "cv1", telefoneE164: "5521999998888", portalClientId: cliente ? "pc1" : null, escopoVerificado: cliente, excluidaEm: null, automacaoInvalidadaEm: null, atendidaPor: null, atendidaDesde },
    mensagem: { id: "m1", conversaId: "cv1", direcao: "in", corpo: texto, registradaEm: AGORA },
    vinculo,
  };
}

const resolverCliente = jest.fn(async () => ({ situacao: "VINCULADO", empresas: [{ portalClientId: "pc1" }] }));

function banco({ cliente = false, permissoes = [], menuRecente = false, semPessoa = false, inativo = false } = {}) {
  const conversa = registro({ cliente }).conversa;
  return {
    mensagemWhatsapp: {
      findFirst: jest.fn(async ({ where }) => where.turnoIaId ? null : menuRecente ? { id: "out-old" } : null),
      create: jest.fn(async ({ data }) => ({ id: "out1", ...data })),
      update: jest.fn(async ({ data }) => ({ id: "out1", ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    conversaWhatsapp: {
      findUnique: jest.fn(async () => ({ ...conversa })),
      update: jest.fn(async ({ data }) => ({ ...conversa, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    contatoWhatsapp: { findMany: jest.fn(async () => cliente ? [{ id: "ct1", nome: "Julia", userId: semPessoa ? null : "u1", permissoesAssistente: permissoes }] : []) },
    companyClientUser: { findUnique: jest.fn(async () => cliente && !semPessoa ? ({ role: "CLIENT_ADMIN", status: inativo ? "INACTIVE" : "ACTIVE" }) : null) },
  };
}

function nuvem() {
  return {
    enviarTexto: jest.fn(async () => ({ wamid: "wamid.text" })),
    enviarBotoes: jest.fn(async () => ({ wamid: "wamid.buttons" })),
    enviarLista: jest.fn(async () => ({ wamid: "wamid.list" })),
  };
}

describe("menus por perfil e permissão", () => {
  it("cliente vê somente atalhos cobertos por permissão e papel", () => {
    const sessao = { ok: true, papel: "CLIENT_ADMIN", permissoesAssistente: ["GUIAS", "RECALCULO_GUIA"] };
    expect(botoesDoCliente(sessao).map((b) => b.id)).toEqual([IDS_MENU_WHATSAPP.CLIENTE_GUIAS_MES, IDS_MENU_WHATSAPP.CLIENTE_MAIS]);
    expect(linhasDoCliente(sessao).map((l) => l.id)).toEqual([
      IDS_MENU_WHATSAPP.CLIENTE_QUANTO_DEVO, IDS_MENU_WHATSAPP.CLIENTE_RECALCULO, IDS_MENU_WHATSAPP.CLIENTE_EQUIPE,
    ]);
  });

  it("texto livre claro não é interrompido por menu no cliente", () => {
    expect(acaoDoTextoLivre("Quero a guia do INSS de agosto", { cliente: true })).toBeNull();
    expect(acaoDoTextoLivre("menu", { cliente: true })).toBe("MENU");
  });
});

describe("roteamento sem modelo", () => {
  it("lead recebe os três botões estáveis", async () => {
    const client = banco();
    const cloud = nuvem();
    const r = await responderMenuWhatsapp({ registro: registro(), texto: "oi", agora: AGORA, client, cloud, conferirJanela: janelaAberta, logger: log });
    expect(r).toMatchObject({ tratado: true, acao: "MENU" });
    expect(cloud.enviarBotoes.mock.calls[0][0].botoes.map((b) => b.id)).toEqual([
      IDS_MENU_WHATSAPP.LEAD_ANALISAR, IDS_MENU_WHATSAPP.LEAD_CLIENTE, IDS_MENU_WHATSAPP.LEAD_EQUIPE,
    ]);
  });

  it("clique em situação fiscal revalida e usa apenas a foto salva", async () => {
    const client = banco({ cliente: true, permissoes: ["SITUACAO_FISCAL"] });
    const cloud = nuvem();
    const executar = jest.fn(async () => ({ ok: true, situacao: "REGULAR", consultadaEm: "08/09/2026", relatorioDe: "08/09/2026", diagnosticos: [], observacao: "Foto salva." }));
    const r = await responderMenuWhatsapp({
      registro: registro({ cliente: true }), interacao: { tipo: "button_reply", id: IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL, titulo: "outro" },
      agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log,
    });
    expect(r).toMatchObject({ tratado: true, acao: "SITUACAO_FISCAL" });
    expect(executar).toHaveBeenCalledWith("situacao_fiscal", {}, expect.objectContaining({ sessao: expect.objectContaining({ portalClientId: "pc1", userId: "u1" }) }));
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/Última situação fiscal salva: REGULAR/);
  });

  it("id forjado sem permissão não executa ferramenta", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] });
    const cloud = nuvem();
    const executar = jest.fn();
    await responderMenuWhatsapp({
      registro: registro({ cliente: true }), interacao: { tipo: "button_reply", id: IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL },
      agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log,
    });
    expect(executar).not.toHaveBeenCalled();
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/não está autorizado/);
  });

  it("não envia menu calculado antes de o vínculo do contato ser revogado", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] });
    client.contatoWhatsapp.findMany
      .mockResolvedValueOnce([{ id: "ct1", nome: "Julia", userId: "u1", permissoesAssistente: ["GUIAS"] }])
      .mockResolvedValue([]);
    const cloud = nuvem();

    await expect(responderMenuWhatsapp({
      registro: registro({ cliente: true }), texto: "menu", agora: AGORA,
      client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log,
    })).rejects.toMatchObject({ codigo: "ACESSO_REVOGADO" });

    expect(client.mensagemWhatsapp.create).not.toHaveBeenCalled();
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
  });

  it("não lê empresa quando o vínculo atual ficou ambíguo", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] });
    const cloud = nuvem();
    const entrada = registro({ cliente: true });
    entrada.vinculo = { situacao: "AMBIGUO", empresas: [{ portalClientId: "pc1" }, { portalClientId: "pc2" }] };

    const r = await responderMenuWhatsapp({ registro: entrada, texto: "menu", agora: AGORA, client, cloud, conferirJanela: janelaAberta, logger: log });

    expect(r).toEqual({ tratado: false, motivo: "SEM_ESCOPO_VERIFICADO" });
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
  });

  it("não responde mensagem anterior ao corte de automação", async () => {
    const client = banco();
    const cloud = nuvem();
    const entrada = registro();
    entrada.conversa.automacaoInvalidadaEm = new Date("2026-09-08T15:01:00.000Z");

    const r = await responderMenuWhatsapp({ registro: entrada, texto: "oi", agora: AGORA, client, cloud, conferirJanela: janelaAberta, logger: log });

    expect(r).toEqual({ tratado: false, motivo: "AUTOMACAO_INVALIDADA" });
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
  });

  it.each([
    ["sem pessoa ligada", { semPessoa: true }, /ainda não ligado a um acesso do portal/],
    ["com vínculo inativo", { inativo: true }, /acesso ligado a ele não está ativo/],
  ])("cliente conhecido %s vai para a equipe sem receber oferta de lead", async (_nome, falha, esperado) => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"], ...falha });
    const cloud = nuvem();

    const r = await responderMenuWhatsapp({
      registro: registro({ cliente: true }), texto: "oi", agora: AGORA,
      client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log,
    });

    expect(r).toMatchObject({ tratado: true, motivo: "SEM_SESSAO_CLIENTE", acao: "EQUIPE" });
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(esperado);
    expect(client.conversaWhatsapp.updateMany).toHaveBeenCalled();
  });

  it("guias do mês usa vencimento, mostra competência e ensina a pedir o PDF", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] });
    const cloud = nuvem();
    const executar = jest.fn(async () => ({ ok: true, guias: [
      { tipo: "DAS", competencia: "2026-08", valorFormatado: "R$ 826,66", vencimento: "20/09/2026" },
      { tipo: "INSS", competencia: "2026-07", valorFormatado: "R$ 100,00", vencimento: "20/08/2026" },
    ] }));

    await responderMenuWhatsapp({
      registro: registro({ cliente: true }), interacao: { tipo: "button_reply", id: IDS_MENU_WHATSAPP.CLIENTE_GUIAS_MES },
      agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log,
    });

    expect(executar).toHaveBeenCalledWith("quanto_devo", {}, expect.any(Object));
    const texto = cloud.enviarTexto.mock.calls[0][0].texto;
    expect(texto).toMatch(/vencimento em 09\/2026/);
    expect(texto).toMatch(/DAS · competência 2026-08/);
    expect(texto).not.toMatch(/INSS/);
    expect(texto).toMatch(/receber o PDF/);
  });

  it("pedido para a equipe respeita o expediente e assume o fio", async () => {
    const client = banco();
    const cloud = nuvem();
    await responderMenuWhatsapp({
      registro: registro(), interacao: { tipo: "button_reply", id: IDS_MENU_WHATSAPP.LEAD_EQUIPE },
      agora: new Date("2026-09-08T23:00:00.000Z"), client, cloud, conferirJanela: janelaAberta, logger: log,
    });
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/fora do horário/);
    expect(client.conversaWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { atendidaDesde: expect.any(Date) } }));
  });

  it("não repete menu interativo dentro de 24 horas", async () => {
    const client = banco({ menuRecente: true });
    const cloud = nuvem();
    await responderMenuWhatsapp({ registro: registro(), texto: "oi", agora: AGORA, client, cloud, conferirJanela: janelaAberta, logger: log });
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
    expect(cloud.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ texto: expect.stringMatching(/menu continua/) }));
  });

  it("pedido explícito reabre o menu mesmo dentro do cooldown", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"], menuRecente: true });
    const cloud = nuvem();
    await responderMenuWhatsapp({
      registro: registro({ cliente: true, texto: "menu" }), texto: "menu", agora: AGORA,
      client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log,
    });
    expect(cloud.enviarBotoes).toHaveBeenCalledTimes(1);
  });
});
