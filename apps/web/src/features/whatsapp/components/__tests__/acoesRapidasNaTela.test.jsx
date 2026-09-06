// AS AÇÕES RÁPIDAS — a ligação, dentro do chat da empresa (F3, 06/09/2026).
//
// A regra pura tem teste próprio. O que se prende aqui é o que ela não alcança: que os botões
// chegam ao DOM montados pelo chat da empresa, que o motivo do bloqueio é TEXTO (não `title`), que
// a escolha vai para a rota certa, e que "virar anotação" NÃO grava nada — ela devolve texto.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatDaEmpresa } from "../ChatDaEmpresa";

const FIO = {
  id: "cv1", telefoneE164: "5521999998888", telefoneMascarado: "+55…8888", nomePerfilProvedor: "Maria",
  portalClientId: "pc-1", empresa: { id: "pc-1", razao: "ACME LTDA" }, contato: { id: "c1", nome: "Maria Silva", papel: "sócia" },
  atendidaPor: null, atendente: null, atendidaDesde: null, naoLidas: 0, updatedAt: "2026-09-06T12:00:00Z",
  janela: { situacao: "ABERTA" }, pendencia: null, ultimaMensagem: { corpo: "oi", registradaEm: "2026-09-06T12:00:00Z" },
};
const MENSAGENS = [
  { id: "m1", direcao: "in", tipo: "text", corpo: "quero parcelar o DAS", autor: null, registradaEm: "2026-09-06T11:00:00Z" },
  { id: "m2", direcao: "in", tipo: "image", corpo: null, autor: null, temMidia: true, registradaEm: "2026-09-06T11:05:00Z" },
];

function apiFalso(over = {}, fio = FIO) {
  return {
    listarConversasWhatsapp: jest.fn(async () => ({ ok: true, conversas: [fio], temMais: false })),
    getMensagensWhatsapp: jest.fn(async () => ({ ok: true, conversa: fio, temMais: false, mensagens: MENSAGENS })),
    assumirConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    devolverConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    responderConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    vincularConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    getCompanyGuides: jest.fn(async () => [
      { guideId: "g1", tipo: "SIMPLES", competencia: "2026-08" },
      { guideId: "g2", tipo: "INSS", competencia: "2026-08" },
    ]),
    listCompanyDocuments: jest.fn(async () => ({ ok: true, documentos: [{ id: "doc-1", nome: "Contrato social.pdf" }] })),
    enviarGuiaWhatsapp: jest.fn(async () => ({ ok: true })),
    enviarDocumentoWhatsapp: jest.fn(async () => ({ ok: true })),
    ...over,
  };
}

async function montar(api = apiFalso(), props = {}) {
  render(<ChatDaEmpresa api={api} companyId="pc-1" onVirarAnotacao={jest.fn()} {...props} />);
  await screen.findByTestId("acoes-rapidas");
  return api;
}

describe("a tira chega ao DOM pelo chat da empresa", () => {
  it("as três ações aparecem, e as três habilitadas dentro da janela", async () => {
    await montar();
    expect(screen.getByTestId("acao-ENVIAR_GUIA")).toBeEnabled();
    expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeEnabled();
    expect(screen.getByTestId("acao-VIRAR_ANOTACAO")).toBeEnabled();
  });

  it("⚠ sem destino de anotação (o /whatsapp) a ação NÃO é montada", async () => {
    render(<ChatDaEmpresa api={apiFalso()} companyId="pc-1" />);
    await screen.findByTestId("acoes-rapidas");
    expect(screen.queryByTestId("acao-VIRAR_ANOTACAO")).toBeNull();
  });
});

describe("⚠⚠ fora da janela: guia SIM, documento NÃO — e o motivo é TEXTO", () => {
  const expirado = { ...FIO, janela: { situacao: "EXPIRADA" } };

  it("o documento fica desabilitado com a frase na tela, e a guia continua clicável", async () => {
    await montar(apiFalso({}, expirado));
    expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeDisabled();
    expect(screen.getByTestId("acao-ENVIAR_GUIA")).toBeEnabled();
    // ⚠ `title` não conta: não aparece no teclado nem no toque.
    expect(screen.getByTestId("motivo-ENVIAR_DOCUMENTO")).toHaveTextContent(/documento não é modelo/);
  });
});

describe("enviar guia", () => {
  it("lista as guias com o rótulo da aba Guias e manda o id escolhido", async () => {
    const api = await montar();
    fireEvent.click(screen.getByTestId("acao-ENVIAR_GUIA"));
    const painel = await screen.findByTestId("escolha-do-envio");
    const select = await within(painel).findByLabelText("Guia a enviar");
    // ⚠ O rótulo é o MESMO da aba Guias (`rotuloTipoGuia`) — nem "DAS" aqui e "SIMPLES" lá, nem o
    // contrário: uma segunda tradução faria a parcela de parcelamento aparecer com outro nome.
    expect(select).toHaveTextContent("SIMPLES · 2026-08");
    fireEvent.change(select, { target: { value: "g2" } });
    fireEvent.click(within(painel).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(api.enviarGuiaWhatsapp).toHaveBeenCalledWith("pc-1", "g2"));
  });
});

describe("enviar documento", () => {
  it("⚠ manda o id do FIO e o do documento — a empresa não viaja no corpo", async () => {
    const api = await montar();
    fireEvent.click(screen.getByTestId("acao-ENVIAR_DOCUMENTO"));
    const painel = await screen.findByTestId("escolha-do-envio");
    const select = await within(painel).findByLabelText("Documento a enviar");
    fireEvent.change(select, { target: { value: "doc-1" } });
    fireEvent.click(within(painel).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(api.enviarDocumentoWhatsapp).toHaveBeenCalledWith("cv1", "doc-1"));
  });

  it("⚠ a recusa do SERVIDOR aparece com a frase dele, nunca 'falhou'", async () => {
    const erro = Object.assign(new Error("fora"), {
      status: 409, code: "FORA_DA_JANELA",
      payload: { message: "A janela de 24h fechou: só modelo aprovado agora." },
    });
    const api = await montar(apiFalso({ enviarDocumentoWhatsapp: jest.fn(async () => { throw erro; }) }));
    fireEvent.click(screen.getByTestId("acao-ENVIAR_DOCUMENTO"));
    const painel = await screen.findByTestId("escolha-do-envio");
    fireEvent.change(await within(painel).findByLabelText("Documento a enviar"), { target: { value: "doc-1" } });
    fireEvent.click(within(painel).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/só modelo aprovado agora/));
    expect(api.enviarDocumentoWhatsapp).toHaveBeenCalled();
  });

  it("empresa sem documento guardado DIZ isso — não fica um select vazio", async () => {
    await montar(apiFalso({ listCompanyDocuments: jest.fn(async () => ({ ok: true, documentos: [] })) }));
    fireEvent.click(screen.getByTestId("acao-ENVIAR_DOCUMENTO"));
    expect(await screen.findByTestId("escolha-vazia")).toHaveTextContent(/não tem documento guardado/);
  });
});

describe("⚠⚠ virar anotação NÃO grava nada — devolve texto para o contador editar", () => {
  it("a mensagem é ESCOLHIDA, e o texto sai com quando, quem e o que foi dito", async () => {
    const onVirarAnotacao = jest.fn();
    await montar(apiFalso(), { onVirarAnotacao });
    fireEvent.click(screen.getByTestId("acao-VIRAR_ANOTACAO"));
    const painel = await screen.findByTestId("escolha-do-envio");
    const select = await within(painel).findByLabelText("Mensagem que vira anotação");
    // ⚠ Só as que TÊM texto: a mídia que não sabemos abrir não tem o que copiar.
    expect(select).toHaveTextContent("quero parcelar o DAS");
    expect(select.querySelectorAll("option")).toHaveLength(2); // "— escolha —" + a única com texto
    fireEvent.change(select, { target: { value: "m1" } });
    fireEvent.click(within(painel).getByRole("button", { name: /Levar para a anotação/ }));
    await waitFor(() => expect(onVirarAnotacao).toHaveBeenCalled());
    const texto = onVirarAnotacao.mock.calls[0][0];
    expect(texto).toMatch(/Maria Silva no WhatsApp/);
    expect(texto).toMatch(/"quero parcelar o DAS"/);
  });

  it("⚠ nenhuma chamada de envio acontece — a anotação não fala com a Meta", async () => {
    const onVirarAnotacao = jest.fn();
    const api = await montar(apiFalso(), { onVirarAnotacao });
    fireEvent.click(screen.getByTestId("acao-VIRAR_ANOTACAO"));
    const painel = await screen.findByTestId("escolha-do-envio");
    fireEvent.change(await within(painel).findByLabelText("Mensagem que vira anotação"), { target: { value: "m1" } });
    fireEvent.click(within(painel).getByRole("button", { name: /Levar para a anotação/ }));
    await waitFor(() => expect(onVirarAnotacao).toHaveBeenCalled());
    expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled();
    expect(api.enviarGuiaWhatsapp).not.toHaveBeenCalled();
    expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
  });
});
