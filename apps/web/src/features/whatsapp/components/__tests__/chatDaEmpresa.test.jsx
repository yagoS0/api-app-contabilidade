// O CHAT DENTRO DA EMPRESA — a ligação (F2, 06/09/2026).
//
// A regra pura (`fiosDaEmpresa`) tem teste próprio; isto prende o que ela não alcança: que a
// listagem é pedida COM a empresa, que o fio abre sozinho, que o seletor só existe com dois, e que
// falha de carga não se parece com "esta empresa não fala por WhatsApp".

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatDaEmpresa } from "../ChatDaEmpresa";

const SOCIA = {
  id: "cv1", telefoneE164: "5521999998888", telefoneMascarado: "+55…8888", nomePerfilProvedor: "Maria",
  portalClientId: "pc-1", empresa: { id: "pc-1", razao: "ACME LTDA" }, contato: { id: "c1", nome: "Maria Silva", papel: "sócia" },
  atendidaPor: null, atendente: null, atendidaDesde: null, naoLidas: 0, updatedAt: "2026-09-06T12:00:00Z",
  janela: { situacao: "ABERTA" }, pendencia: null, ultimaMensagem: { corpo: "oi", registradaEm: "2026-09-06T12:00:00Z" },
};
const FINANCEIRO = {
  ...SOCIA, id: "cv2", telefoneMascarado: "+55…7777", contato: { id: "c2", nome: "João Financeiro", papel: "financeiro" },
  updatedAt: "2026-09-05T12:00:00Z",
};

function apiFalso(conversas, over = {}) {
  return {
    listarConversasWhatsapp: jest.fn(async () => ({ ok: true, conversas, temMais: false })),
    getMensagensWhatsapp: jest.fn(async (id) => ({
      ok: true,
      conversa: conversas.find((c) => c.id === id),
      temMais: false,
      mensagens: [{ id: `m-${id}`, direcao: "in", tipo: "text", corpo: `mensagem de ${id}`, autor: null, registradaEm: "2026-09-06T11:00:00Z" }],
    })),
    assumirConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    devolverConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    responderConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    vincularConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    ...over,
  };
}

describe("⚠ a listagem é pedida COM a empresa — nunca a caixa geral filtrada na tela", () => {
  it("manda o companyId no parâmetro que o servidor intersecta com a carteira", async () => {
    const api = apiFalso([SOCIA]);
    render(<ChatDaEmpresa api={api} companyId="pc-1" />);
    await waitFor(() => expect(api.listarConversasWhatsapp).toHaveBeenCalledWith("todas", { empresa: "pc-1" }));
  });
});

describe("um fio só", () => {
  it("⚠ abre SOZINHO — a aba é uma conversa, não uma caixa de entrada", async () => {
    const api = apiFalso([SOCIA]);
    render(<ChatDaEmpresa api={api} companyId="pc-1" />);
    await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledWith("cv1"));
    const fio = await screen.findByTestId("fio");
    expect(within(fio).getByTestId("balao-m-cv1")).toHaveTextContent("mensagem de cv1");
    expect(within(fio).getByTestId("pessoa-da-conversa")).toHaveTextContent("Maria Silva");
  });

  it("⚠ com um fio só NÃO há seletor — ele perguntaria o que não tem alternativa", async () => {
    render(<ChatDaEmpresa api={apiFalso([SOCIA])} companyId="pc-1" />);
    await screen.findByTestId("fio");
    expect(screen.queryByTestId("seletor-de-contato")).toBeNull();
  });
});

describe("dois fios da mesma empresa — o seletor", () => {
  it("o seletor lista as PESSOAS com o papel, e trocar abre o outro fio", async () => {
    const api = apiFalso([SOCIA, FINANCEIRO]);
    render(<ChatDaEmpresa api={api} companyId="pc-1" />);
    const seletor = await screen.findByTestId("seletor-de-contato");
    expect(seletor).toHaveTextContent("Maria Silva · sócia");
    expect(seletor).toHaveTextContent("João Financeiro · financeiro");
    await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledWith("cv1"));
    fireEvent.change(seletor, { target: { value: "cv2" } });
    await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledWith("cv2"));
    await waitFor(() => expect(screen.getByTestId("balao-m-cv2")).toBeInTheDocument());
  });

  it("⚠ a EMPRESA não se repete em cada opção — aqui ela é a mesma em todo fio", async () => {
    render(<ChatDaEmpresa api={apiFalso([SOCIA, FINANCEIRO])} companyId="pc-1" />);
    const seletor = await screen.findByTestId("seletor-de-contato");
    expect(seletor).not.toHaveTextContent("ACME");
  });
});

describe("⚠⚠ ausência e falha não se parecem", () => {
  it("empresa sem fio nenhum diz DE QUEM é a vez — não 'não encontrado'", async () => {
    render(<ChatDaEmpresa api={apiFalso([])} companyId="pc-1" />);
    const vazio = await screen.findByTestId("chat-sem-fio");
    expect(vazio).toHaveTextContent(/Quem abre a conversa é o cliente/);
    expect(screen.queryByTestId("fio")).toBeNull();
  });

  it("⚠ falha de carga NÃO vira 'não há conversa'", async () => {
    const api = apiFalso([], { listarConversasWhatsapp: jest.fn(async () => { throw new Error("timeout"); }) });
    render(<ChatDaEmpresa api={api} companyId="pc-1" />);
    const falha = await screen.findByTestId("chat-falha");
    expect(falha).toHaveTextContent(/Não dá para afirmar que não há nenhuma/);
    expect(screen.queryByTestId("chat-sem-fio")).toBeNull();
  });

  it("⚠ o fio que não abre não é tentado para sempre — uma vez por id", async () => {
    const api = apiFalso([SOCIA], { getMensagensWhatsapp: jest.fn(async () => { throw new Error("404"); }) });
    render(<ChatDaEmpresa api={api} companyId="pc-1" />);
    await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
  });
});
