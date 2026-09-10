import { responderMenuWhatsapp, botoesDoCliente, linhasDoCliente, IDS_MENU_WHATSAPP, acaoDoTextoLivre } from "../MenuWhatsappService.js";
import { executarFerramenta } from "../../assistente/ferramentas/index.js";
jest.mock("../WhatsappLeaseService.js", () => ({ adquirirLease: jest.fn(async () => ({ id: "lease", token: "owner" })), renovarLease: jest.fn(async () => true), liberarLease: jest.fn(async () => {}) }));

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
    acaoPendenteWhatsapp: { findFirst: jest.fn(async () => null) },
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
    enviarDocumento: jest.fn(async () => ({ wamid: "wamid.document" })),
  };
}

describe("menus por perfil e permissão", () => {
  it("pedido direto de pessoa usa handoff determinístico, mas uma dúvida livre vai ao modelo", () => {
    expect(acaoDoTextoLivre("quero falar com o contador", { cliente: true })).toBe("EQUIPE");
    expect(acaoDoTextoLivre("qual a situação fiscal da minha empresa?", { cliente: true })).toBeNull();
    expect(acaoDoTextoLivre("minha situação fiscal", { cliente: true })).toBeNull();
  });
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
  it("a intenção de emissão resolvida inicia a coleta e preserva a indicação do tomador", async () => {
    const texto = "emitir uma nota para a Lente";
    const entrada = registro({ cliente: true, texto });
    entrada.contexto = { resultado: { acaoOperacao: "EMISSAO" } };
    const client = banco({ cliente: true, permissoes: ["EMISSAO_NFSE"] }), cloud = nuvem();
    const coleta = jest.fn(async () => ({ tratado: true, texto: "Qual o CPF/CNPJ do tomador?" }));
    const r = await responderMenuWhatsapp({ registro: entrada, texto, coleta, agora: AGORA, client, cloud,
      conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log });
    expect(r).toMatchObject({ tratado: true, acao: "EMISSAO_GUIADA" });
    expect(coleta).toHaveBeenCalledWith(expect.objectContaining({ iniciar: true, texto,
      sessao: expect.objectContaining({ portalClientId: "pc1" }) }));
    expect(cloud.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ texto: expect.stringContaining("CPF/CNPJ do tomador") }));
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
  });
  it("a apresentação inicial não consome um pedido substantivo", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] }), cloud = nuvem();
    const r = await responderMenuWhatsapp({ registro: registro({ cliente: true, texto: "preciso da guia do INSS" }), texto: "preciso da guia do INSS", agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente });
    expect(r).toMatchObject({ tratado: false, inicioExibido: true });
    expect(cloud.enviarBotoes).toHaveBeenCalledTimes(1);
    expect(client.mensagemWhatsapp.updateMany).not.toHaveBeenCalled();
    expect(client.mensagemWhatsapp.create).toHaveBeenCalledWith({ data: expect.objectContaining({ turnoIaId: "menu-inicio:m1" }) });
  });
  it("pendência aberta preserva a conversa sem apresentação automática", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] }), cloud = nuvem();
    client.acaoPendenteWhatsapp = { findFirst: jest.fn(async () => ({ id: "ap1", codigo: "A7K2", expiraEm: new Date(AGORA.getTime() + 60000) })) };
    const args = { registro: registro({ cliente: true }), agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente };
    expect((await responderMenuWhatsapp({ ...args, texto: "esse valor é total?" })).tratado).toBe(false);
    expect((await responderMenuWhatsapp({ ...args, texto: "olá" })).tratado).toBe(false);
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
  });
  it("depois do menu, texto livre não envia menu nem executa um atalho", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"], menuRecente: true }), cloud = nuvem(), executar = jest.fn();
    const r = await responderMenuWhatsapp({ registro: registro({ cliente: true }), texto: "minha situação fiscal", agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente });
    expect(r.tratado).toBe(false);
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
    expect(cloud.enviarTexto).not.toHaveBeenCalled();
    expect(executar).not.toHaveBeenCalled();
  });
  it("menu aguarda o lease do mesmo fio, sem responder enquanto a IA está ocupada", async () => {
    const client = banco({ cliente: true }), cloud = nuvem(), adquirirLease = jest.fn(async () => null);
    await expect(responderMenuWhatsapp({ registro: registro({ cliente: true }), texto: "menu", client, cloud, adquirirLease })).rejects.toMatchObject({ codigo: "FIO_OCUPADO" });
    expect(adquirirLease).toHaveBeenCalledWith("ia:cv1", expect.objectContaining({ client }));
    expect(client.contatoWhatsapp.findMany).not.toHaveBeenCalled();
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
  });
  it("sem IA habilitada, pedido em texto recebe atendimento humano em vez de silêncio", async () => {
    const client = banco({ cliente: true }), cloud = nuvem();
    const r = await responderMenuWhatsapp({ registro: registro({ cliente: true }), texto: "minha guia venceu", textoLivreDisponivel: false, agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente });
    expect(r).toMatchObject({ tratado: true, acao: "EQUIPE" });
    expect(client.conversaWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ atendidaDesde: AGORA }) }));
  });
  it("o aviso de encaminhamento depende da gravação e a falha de transporte preserva a fila", async () => {
    const client = banco({ cliente: true }), cloud = nuvem();
    client.conversaWhatsapp.updateMany.mockResolvedValueOnce({ count: 0 });
    const args = { registro: registro({ cliente: true }), texto: "quero falar com a equipe", agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente };
    await expect(responderMenuWhatsapp(args)).rejects.toMatchObject({ codigo: "AUTOMACAO_INVALIDADA" });
    expect(cloud.enviarTexto).not.toHaveBeenCalled();
    cloud.enviarTexto.mockRejectedValueOnce(new Error("timeout"));
    await expect(responderMenuWhatsapp(args)).rejects.toThrow("timeout");
    expect(client.conversaWhatsapp.updateMany.mock.invocationCallOrder.at(-1)).toBeLessThan(cloud.enviarTexto.mock.invocationCallOrder[0]);
  });
  it("reentrega depois da apresentação não perde o pedido nem repete as opções", async () => {
    const client = banco({ cliente: true }), cloud = nuvem();
    client.mensagemWhatsapp.findFirst.mockImplementation(async ({ where }) => where.turnoIaId === "menu-inicio:m1" ? { id: "intro" } : null);
    const r = await responderMenuWhatsapp({ registro: registro({ cliente: true }), texto: "preciso da última nota", agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente });
    expect(r.tratado).toBe(false);
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
    expect(client.mensagemWhatsapp.updateMany).not.toHaveBeenCalled();
  });
  it("quanto devo informa subtotal quando uma guia está sem valor", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"] }), cloud = nuvem();
    await responderMenuWhatsapp({ registro: registro({ cliente: true }), interacao: { id: IDS_MENU_WHATSAPP.CLIENTE_QUANTO_DEVO }, agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, executar: async () => ({ ok: true, quantidade: 2, totalParcial: true, semValor: 1, subtotalConhecidoFormatado: "R$ 100,00", totalFormatado: null }) });
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toContain("R$ 100,00");
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toContain("não consigo afirmar o total");
    expect(cloud.enviarTexto.mock.calls[0][0].texto).not.toContain("null");
  });
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
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/Na consulta salva de 08\/09\/2026, não foram indicadas pendências/);
    expect(cloud.enviarTexto.mock.calls[0][0].texto).not.toContain("REGULAR");
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

  it("saudação de cliente com menu recente recebe resposta breve sem seguir ao modelo", async () => {
    const client = banco({ cliente: true, permissoes: ["GUIAS"], menuRecente: true }), cloud = nuvem();
    const r = await responderMenuWhatsapp({ registro: registro({ cliente: true }), texto: "Olá", agora: AGORA, client, cloud, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log });
    expect(r).toMatchObject({ tratado: true, acao: "MENU" });
    expect(cloud.enviarBotoes).not.toHaveBeenCalled();
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toBe("Olá! Como posso ajudar? Pode escrever seu pedido por aqui.");
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

describe("situação fiscal pelo botão; texto livre permanece no assistente", () => {
  function cenario() {
    const client = banco({ cliente: true, permissoes: ["SITUACAO_FISCAL"] }), cloud = nuvem();
    client.companyFiscalStatus = { findUnique: jest.fn(async () => ({ situacao: "EM_PARCELAMENTO", texto: "relatório salvo", checkedAt: new Date("2026-07-24T12:00:00Z"), ultimoRelatorioEm: new Date("2026-07-24T12:00:00Z") })) };
    client.portalClient = { findUnique: jest.fn(async () => ({ razao: "Empresa teste", cnpj: "11222333000181" })) };
    const servicos = { parseSitfisRelatorio: jest.fn(() => ({ diagnosticos: [] })), gerarPdfSitfisTabela: jest.fn(async () => Buffer.from("PDF de teste")) };
    const executar = (nome, input, ctx) => executarFerramenta(nome, input, { ...ctx, servicos });
    return { client, cloud, servicos, executar };
  }
  it.each(["botao"])("%s entrega anexo e confirma somente depois da Meta", async (texto) => {
    const { client, cloud, executar } = cenario();
    await responderMenuWhatsapp({ registro: registro({ cliente: true, texto }), texto,
      ...(texto === "botao" ? { interacao: { id: IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL } } : {}),
      agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log });
    expect(cloud.enviarDocumento).toHaveBeenCalledTimes(1);
    expect(cloud.enviarDocumento).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/pdf", nomeArquivo: "situacao-fiscal-11222333000181.pdf" }));
    const resposta = cloud.enviarTexto.mock.calls[0][0].texto;
    expect(resposta).toContain("Enviei o relatório fiscal salvo, de 24/07/2026, em PDF");
    expect(resposta).not.toContain("EM_PARCELAMENTO");
    expect(cloud.enviarDocumento.mock.invocationCallOrder[0]).toBeLessThan(cloud.enviarTexto.mock.invocationCallOrder[0]);
  });
  it("falha no transporte não confirma o anexo", async () => {
    const { client, cloud, executar } = cenario();
    cloud.enviarDocumento.mockRejectedValue(Object.assign(new Error("timeout"), { codigo: "ENVIO_INDETERMINADO" }));
    await responderMenuWhatsapp({ registro: registro({ cliente: true }), interacao: { id: IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL }, agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log });
    expect(cloud.enviarTexto.mock.calls[0][0].texto).not.toMatch(/Enviei|foi enviado/);
    expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/envio não está confirmado/);
  });
  it("revogar o acesso durante geração barra anexo e texto", async () => {
    const { client, cloud, servicos, executar } = cenario();
    servicos.gerarPdfSitfisTabela.mockImplementation(async () => { client.contatoWhatsapp.findMany.mockResolvedValue([]); return Buffer.from("PDF"); });
    await expect(responderMenuWhatsapp({ registro: registro({ cliente: true }), interacao: { id: IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL }, agora: AGORA, client, cloud, executar, conferirJanela: janelaAberta, resolverVinculo: resolverCliente, logger: log })).rejects.toMatchObject({ codigo: "ACESSO_REVOGADO" });
    expect(cloud.enviarDocumento).not.toHaveBeenCalled();
    expect(cloud.enviarTexto).not.toHaveBeenCalled();
  });
  it("pergunta com outro pedido ou período continua na IA", () => {
    expect(acaoDoTextoLivre("Quero saber a situação fiscal da empresa e minhas guias", { cliente: true })).toBeNull();
    expect(acaoDoTextoLivre("Quero a situação fiscal de janeiro", { cliente: true })).toBeNull();
  });
});
