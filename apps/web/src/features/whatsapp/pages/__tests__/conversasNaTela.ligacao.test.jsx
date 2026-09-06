// A TELA DE CONVERSAS — a ligação, com o hook de verdade e uma API dublê.
//
// O que fica travado: (1) a fila (não vinculada) aparece em DESTAQUE e com a contagem; (2) o fio
// mostra QUEM escreveu cada balão; (3) a janela é dita ANTES de digitar (campo desabilitado com o
// motivo, e a API de responder NÃO é chamada); (4) Assumir/Devolver chamam a API certa; (5) o
// vínculo manda a empresa e o contato, e o número NÃO vai no corpo.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WhatsappPage } from "../renderWhatsappPage";

const COM_IA = {
  id: "cv1", telefoneE164: "5521999998888", telefoneMascarado: "+55…8888", nomePerfilProvedor: "Maria", portalClientId: "pc-1", empresa: { id: "pc-1", razao: "ACME LTDA" },
  atendidaPor: null, atendente: null, atendidaDesde: null, naFilaDoEscritorio: false, updatedAt: "2026-09-02T12:00:00Z", naoLidas: 1,
  janela: { situacao: "ABERTA" }, pendencia: { id: "ap1", tipo: "RECALCULAR_GUIA", codigo: "K9M3", expiraEm: "2026-09-02T12:10:00Z" },
  contato: { id: "ctt1", nome: "Maria Silva", papel: "sócia" },
  ultimaMensagem: { corpo: "monta a atualizada", registradaEm: "2026-09-02T12:00:00Z" },
};
const ASSUMIDA = { ...COM_IA, id: "cv2", contato: null, telefoneMascarado: "+55…7777", empresa: { id: "pc-2", razao: "BETA LTDA" }, portalClientId: "pc-2", atendidaPor: "u1", atendente: { nome: "Ana" }, janela: { situacao: "EXPIRADA" }, pendencia: null, naoLidas: 0, updatedAt: "2026-08-30T12:00:00Z" };
const FILA = { ...COM_IA, id: "cv3", contato: null, telefoneMascarado: "+55…6666", nomePerfilProvedor: "Carlos", portalClientId: null, empresa: null, pendencia: null, naoLidas: 1, vinculo: { motivo: "DESCONHECIDO" }, updatedAt: "2026-09-02T11:00:00Z" };

const MENSAGENS = {
  cv1: [
    { id: "m1", direcao: "in", tipo: "text", corpo: "quanto devo?", autor: null, registradaEm: "2026-09-02T11:50:00Z" },
    { id: "m2", direcao: "out", tipo: "text", corpo: "Há 1 guia em aberto.", autor: "IA", registradaEm: "2026-09-02T11:51:00Z" },
    { id: "m3", direcao: "out", tipo: "text", corpo: "Para confirmar, responda CONFIRMAR K9M3.", autor: "SISTEMA", registradaEm: "2026-09-02T11:52:00Z" },
  ],
  cv2: [{ id: "m4", direcao: "out", tipo: "text", corpo: "Vou verificar.", autor: "HUMANO", registradaEm: "2026-08-30T12:00:00Z" }],
  cv3: [{ id: "m5", direcao: "in", tipo: "text", corpo: "é da contabilidade?", autor: null, registradaEm: "2026-09-02T11:00:00Z" }],
};

function apiFalso(over = {}) {
  const conversas = { cv1: COM_IA, cv2: ASSUMIDA, cv3: FILA };
  return {
    listarConversasWhatsapp: jest.fn(async () => ({ ok: true, conversas: Object.values(conversas), consumoIa: { escritorio: { centavos: 137, teto: 6000, chamadas: 12 } } })),
    getMensagensWhatsapp: jest.fn(async (id) => ({ ok: true, conversa: conversas[id], mensagens: MENSAGENS[id] || [] })),
    assumirConversaWhatsapp: jest.fn(async (id) => ({ ok: true, conversa: { ...conversas[id], atendidaPor: "u1" } })),
    devolverConversaWhatsapp: jest.fn(async (id) => ({ ok: true, conversa: { ...conversas[id], atendidaPor: null } })),
    responderConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    vincularConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    getPortalAccessUsers: jest.fn(async () => ({ ok: true, usuarios: [{ userId: "u9", nome: "Dono", email: "dono@x.com" }] })),
    ...over,
  };
}

const COMPANIES = [{ companyId: "pc-1", razao: "ACME LTDA" }, { companyId: "pc-2", razao: "BETA LTDA" }];

async function montar(api = apiFalso()) {
  render(<WhatsappPage api={api} companies={COMPANIES} onBack={() => {}} />);
  await waitFor(() => expect(api.listarConversasWhatsapp).toHaveBeenCalled());
  await screen.findByTestId("conversa-cv1");
  return api;
}

describe("a lista", () => {
  it("a fila vem PRIMEIRO, em destaque, com a contagem e o consumo do assistente (estimativa)", async () => {
    await montar();
    const linhas = screen.getAllByTestId(/^conversa-/);
    expect(linhas[0]).toHaveAttribute("data-testid", "conversa-cv3");
    expect(linhas[0]).toHaveAttribute("data-situacao", "FILA_SEM_EMPRESA");
    expect(linhas[0]).toHaveTextContent(/número sem cadastro — vincule/);
    expect(screen.getByTestId("contagem-fila")).toHaveTextContent(/1 número sem cadastro/);
    expect(screen.getByTestId("consumo-ia")).toHaveTextContent(/US\$ 1\.37 de US\$ 60\.00 \(estimativa/);
    expect(screen.getByTestId("conversa-cv1")).toHaveTextContent(/pedido K9M3 aguardando confirmação/);
    expect(screen.getByTestId("conversa-cv2")).toHaveTextContent(/assumida por Ana/);
  });
});

describe("o fio", () => {
  it("mostra QUEM escreveu cada balão e a pendência aberta", async () => {
    await montar();
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("balao-m1")).toHaveTextContent(/Maria/);
    expect(within(fio).getByTestId("balao-m2")).toHaveTextContent(/assistente \(IA\)/);
    expect(within(fio).getByTestId("balao-m3")).toHaveTextContent(/mensagem fixa/);
    expect(within(fio).getByTestId("pendencia-aberta")).toHaveTextContent(/K9M3/);
    // Com a IA: oferece Assumir, não Devolver.
    expect(within(fio).getByRole("button", { name: /Assumir/ })).toBeInTheDocument();
    expect(within(fio).queryByRole("button", { name: /Devolver/ })).toBeNull();
  });

  it("⚠ janela EXPIRADA: o campo nasce DESABILITADO com o motivo, e a API de responder NÃO é chamada", async () => {
    const api = await montar();
    fireEvent.click(screen.getByTestId("conversa-cv2"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("resposta-bloqueada")).toHaveTextContent(/fechou/);
    const campo = within(fio).getByLabelText("Responder ao cliente");
    expect(campo).toBeDisabled();
    expect(within(fio).getByRole("button", { name: /^Responder$/ })).toBeDisabled();
    expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
    // Assumida: oferece Devolver.
    fireEvent.click(within(fio).getByRole("button", { name: /Devolver à IA/ }));
    await waitFor(() => expect(api.devolverConversaWhatsapp).toHaveBeenCalledWith("cv2"));
  });

  it("janela ABERTA: responder chama a API com o texto e limpa o campo; Assumir chama a API", async () => {
    const api = await montar();
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    const campo = within(fio).getByLabelText("Responder ao cliente");
    fireEvent.change(campo, { target: { value: "Já vi, respondo em instantes." } });
    fireEvent.click(within(fio).getByRole("button", { name: /^Responder$/ }));
    await waitFor(() => expect(api.responderConversaWhatsapp).toHaveBeenCalledWith("cv1", "Já vi, respondo em instantes."));
    await waitFor(() => expect(within(screen.getByTestId("fio")).getByLabelText("Responder ao cliente")).toHaveValue(""));
    fireEvent.click(within(screen.getByTestId("fio")).getByRole("button", { name: /Assumir/ }));
    await waitFor(() => expect(api.assumirConversaWhatsapp).toHaveBeenCalledWith("cv1"));
  });

  it("⚠ a recusa do servidor (409 FORA_DA_JANELA) aparece com a mensagem dele, nunca 'falhou'", async () => {
    const api = apiFalso({ responderConversaWhatsapp: jest.fn(async () => { const e = new Error("fora"); e.status = 409; e.code = "FORA_DA_JANELA"; e.payload = { message: "A janela de 24h fechou: só modelo aprovado agora." }; throw e; }) });
    await montar(api);
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    fireEvent.change(within(fio).getByLabelText("Responder ao cliente"), { target: { value: "oi" } });
    fireEvent.click(within(fio).getByRole("button", { name: /^Responder$/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/só modelo aprovado agora/));
  });
});

describe("vincular — a fila esvazia por aqui", () => {
  it("o formulário só aparece na não vinculada; manda empresa + contato, e o telefone NÃO vai no corpo", async () => {
    const api = await montar();
    fireEvent.click(screen.getByTestId("conversa-cv3"));
    const fio = await screen.findByTestId("fio");
    const form = within(fio).getByTestId("form-vincular");
    const botao = within(form).getByRole("button", { name: /Vincular/ });
    expect(botao).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Empresa do vínculo"), { target: { value: "pc-1" } });
    await waitFor(() => expect(api.getPortalAccessUsers).toHaveBeenCalledWith("pc-1"));
    fireEvent.change(within(form).getByLabelText("Nome do contato"), { target: { value: "Carlos" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    await waitFor(() => expect(within(form).getByLabelText("Pessoa do portal").querySelectorAll("option").length).toBe(2));
    fireEvent.change(within(form).getByLabelText("Pessoa do portal"), { target: { value: "u9" } });
    fireEvent.click(within(form).getByRole("button", { name: /Vincular/ }));
    await waitFor(() => expect(api.vincularConversaWhatsapp).toHaveBeenCalledTimes(1));
    const [id, body] = api.vincularConversaWhatsapp.mock.calls[0];
    expect(id).toBe("cv3");
    expect(body).toEqual({ portalClientId: "pc-1", contato: { nome: "Carlos", optIn: true, optInOrigem: "vinculo_pela_conversa", userId: "u9" } });
    expect(JSON.stringify(body)).not.toMatch(/telefone/);
  });
  it("na conversa vinculada o formulário de vínculo NÃO aparece", async () => {
    await montar();
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    await screen.findByTestId("fio");
    expect(screen.queryByTestId("form-vincular")).toBeNull();
  });
});

// ── ⚠⚠ QUEM está falando E de QUAL empresa (06/09/2026) ────────────────────────────────────────
//
// A regra pura tem teste próprio; isto prende a LIGAÇÃO — o defeito favorito deste projeto é o
// bloco certo que ninguém chama. Antes, a linha fazia `empresa?.razao || nomePerfilProvedor || tel`
// e numa conversa de cliente o contador via a EMPRESA e nunca sabia quem estava falando.

describe("⚠⚠ a linha diz QUEM e de QUAL empresa — as duas", () => {
  it("com contato cadastrado: a pessoa em cima, a empresa embaixo, e o papel junto", async () => {
    await montar();
    const linha = screen.getByTestId("conversa-cv1");
    const pessoa = within(linha).getByTestId("pessoa-da-conversa");
    expect(pessoa).toHaveTextContent("Maria Silva");
    expect(pessoa).toHaveAttribute("data-origem", "CADASTRO");
    expect(linha).toHaveTextContent("sócia");
    // ⚠ A empresa NÃO sumiu — ela desceu para a própria linha.
    expect(within(linha).getByTestId("empresa-da-conversa")).toHaveTextContent("ACME LTDA");
    // Nome do cadastro não leva ressalva.
    expect(within(linha).queryByTestId("aviso-do-nome")).toBeNull();
  });

  it("⚠ sem cadastro, o nome do PERFIL aparece MARCADO — é o que a pessoa escreveu no aparelho dela", async () => {
    await montar();
    const linha = screen.getByTestId("conversa-cv2");
    expect(within(linha).getByTestId("pessoa-da-conversa")).toHaveAttribute("data-origem", "PERFIL");
    expect(within(linha).getByTestId("aviso-do-nome")).toHaveTextContent(/não do cadastro/);
  });

  it("⚠ na fila a ausência de empresa é DITA, não deixada em branco", async () => {
    await montar();
    const linha = screen.getByTestId("conversa-cv3");
    const empresa = within(linha).getByTestId("empresa-da-conversa");
    expect(empresa).toHaveAttribute("data-sem-empresa", "sim");
    expect(empresa).toHaveTextContent(/sem empresa/);
  });

  it("o cabeçalho do fio aberto responde as MESMAS duas perguntas", async () => {
    await montar();
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("pessoa-da-conversa")).toHaveTextContent("Maria Silva");
    expect(within(fio).getByTestId("empresa-da-conversa")).toHaveTextContent("ACME LTDA");
  });
});

describe("⚠ a mídia recebida vira frase, e o corte deixa de ser silencioso", () => {
  const comMidia = {
    getMensagensWhatsapp: jest.fn(async () => ({
      ok: true,
      conversa: COM_IA,
      temMais: true,
      mensagens: [{ id: "m9", direcao: "in", tipo: "image", corpo: null, autor: null, temMidia: true, registradaEm: "2026-09-02T11:00:00Z" }],
    })),
  };

  it("balão de imagem diz o que chegou E que não dá para abrir ainda — nunca '[image]'", async () => {
    await montar(apiFalso(comMidia));
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    const balao = within(fio).getByTestId("balao-m9");
    expect(balao).toHaveTextContent(/imagem/);
    expect(balao).toHaveTextContent(/ainda não baixa/);
    expect(balao).not.toHaveTextContent("[image]");
  });

  it("⚠⚠ com `temMais`, o fio AVISA que há mensagens mais antigas", async () => {
    await montar(apiFalso(comMidia));
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("aviso-paginacao")).toHaveTextContent(/mais antigas/);
  });

  it("⚠ `temMais: false` cala — a tela não avisa o que não existe", async () => {
    const api = apiFalso({ getMensagensWhatsapp: jest.fn(async (id) => ({ ok: true, conversa: COM_IA, temMais: false, mensagens: MENSAGENS[id] || [] })) });
    await montar(api);
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).queryByTestId("aviso-paginacao")).toBeNull();
  });

  it("⚠⚠ servidor SEM o campo não vira 'não há mais' — vira 'não sei'", async () => {
    // O dublê padrão não manda `temMais`: é exatamente o servidor antigo.
    await montar();
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("aviso-paginacao")).toHaveTextContent(/Não dá para afirmar/);
  });
});

describe("⚠ a listagem carrega a empresa quando há uma escolhida", () => {
  it("sem empresa, a chamada não inventa filtro nenhum", async () => {
    const api = await montar();
    expect(api.listarConversasWhatsapp).toHaveBeenCalledWith("todas", { empresa: null });
  });
});

describe("⚠ o balão e o cabeçalho não discordam sobre quem escreveu", () => {
  it("o autor do balão de entrada é o nome do CADASTRO, o mesmo do cabeçalho", async () => {
    await montar();
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    // Cabeçalho e balão saem da mesma autoridade — o perfil ("Maria") não vence o cadastro.
    expect(within(fio).getByTestId("pessoa-da-conversa")).toHaveTextContent("Maria Silva");
    expect(within(fio).getByTestId("balao-m1")).toHaveTextContent("Maria Silva");
  });

  it("⚠ sem nome nenhum o balão continua dizendo 'cliente' — não vira o telefone", async () => {
    const semNome = { ...COM_IA, contato: null, nomePerfilProvedor: null };
    const api = apiFalso({ getMensagensWhatsapp: jest.fn(async (id) => ({ ok: true, conversa: semNome, mensagens: MENSAGENS[id] || [] })) });
    await montar(api);
    fireEvent.click(screen.getByTestId("conversa-cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("balao-m1")).toHaveTextContent(/^cliente ·/);
  });
});
