// A LIGAÇÃO — a seção de WhatsApp existe na aba e chama a API certa, de baixo para cima:
//
//   a aba GUIAS               monta  `ContatosWhatsapp` (⚠ mudou de lugar em 05/09/2026 — antes era
//                                     a aba de senha e acesso; decisão do dono: a configuração de
//                                     envio fica junto das guias)
//   `ContatosWhatsapp`       chama  `whatsapp.salvar(payload)` / `whatsapp.remover(id)` / `definirCanal`
//   `useContatosWhatsapp`    chama  `api.listarContatosWhatsapp` / `salvarContatoWhatsapp` /
//                                    `removerContatoWhatsapp` / `definirCanalEnvio`
//
// ⚠ As invariantes que este arquivo prende:
//   1. o contato SEM opt-in aparece dizendo que NÃO recebe — nunca só uma caixa desmarcada;
//   2. o formulário grava `optIn: true` + origem e o `userId` da pessoa escolhida;
//   3. remover CONFIRMA repetindo nome e telefone, e sem confirmação NADA é chamado;
//   4. trocar o canal chama o PATCH e, recusado, o select VOLTA ao valor anterior;
//   5. erro de carga NÃO zera a lista que já estava na tela.

import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ContatosWhatsapp } from "../ContatosWhatsapp";
import { useContatosWhatsapp } from "../../hooks/useContatosWhatsapp";

const MARIA_PORTAL = { userId: "u1", nome: "Maria do Cliente", email: "maria@empresa.com.br", papel: "OWNER", situacaoUsuario: "active", ultimaTroca: null };

const COM_OPT_IN = {
  id: "c1", portalClientId: "pc-1", nome: "Maria do Cliente", papel: "sócia", telefoneE164: "5521999998888",
  optInEm: "2026-08-20T13:00:00.000Z", optInOrigem: "contrato", ativo: true, userId: "u1",
};
const SEM_OPT_IN = {
  id: "c2", portalClientId: "pc-1", nome: "Financeiro", papel: "financeiro", telefoneE164: "552198887777",
  optInEm: null, optInOrigem: null, ativo: true, userId: null,
};

function vaultFalso() {
  return {
    credenciais: [], cofre: null, podeRevelar: false, papelMinimoRevelar: "FIRM_ADMIN",
    carregando: false, erro: null, informacoes: [], carregandoInfos: false, erroInfos: null,
    reveladas: new Map(), revelar: jest.fn(), esconder: jest.fn(),
    criar: jest.fn(), excluir: jest.fn(), criarInfo: jest.fn(), excluirInfo: jest.fn(),
    recarregar: jest.fn(), recarregarInfos: jest.fn(),
  };
}

// O `acesso` é um estado pronto (não o hook): esta suíte é sobre a seção de WhatsApp, e a lista de
// usuários do portal é o único dado que ela consome de lá.
function acessoFalso() {
  return {
    usuarios: [MARIA_PORTAL], podeDefinirSenha: false, papelMinimo: "ACCOUNTANT", carregando: false,
    erro: null, senhaNova: null, salvandoPara: null, definirSenha: jest.fn(), esconderSenha: jest.fn(), recarregar: jest.fn(),
  };
}

function apiFalso(over = {}) {
  return {
    listarContatosWhatsapp: jest.fn(async () => ({ ok: true, contatos: [COM_OPT_IN, SEM_OPT_IN], canalPadraoEnvio: "WHATSAPP" })),
    salvarContatoWhatsapp: jest.fn(async (_c, input) => ({ ok: true, contato: { id: "c3", ...input } })),
    removerContatoWhatsapp: jest.fn(async () => ({ ok: true })),
    definirCanalEnvio: jest.fn(async (_c, canal) => ({ ok: true, canalPadraoEnvio: String(canal).toUpperCase() })),
    ...over,
  };
}

function Ponte({ api, companyId = "pc-1", feedback }) {
  const whatsapp = useContatosWhatsapp({ api, companyId, feedback });
  return <ContatosWhatsapp whatsapp={whatsapp} usuarios={acessoFalso().usuarios} />;
}

async function montar({ api = apiFalso() } = {}) {
  const feedback = { notifySuccess: jest.fn(), notifyError: jest.fn() };
  const utils = render(<Ponte api={api} feedback={feedback} />);
  await waitFor(() => expect(api.listarContatosWhatsapp).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId("secao-whatsapp")).toHaveTextContent(/2 contato/));
  return { ...utils, api, feedback };
}

afterEach(() => { jest.restoreAllMocks(); });

describe("a seção existe e diz quem recebe", () => {
  it("lista os dois contatos com o telefone formatado e a situação de cada um", async () => {
    await montar();
    const maria = screen.getByTestId("contato-whatsapp-c1");
    expect(maria).toHaveTextContent("+55 (21) 99999-8888");
    expect(maria).toHaveTextContent(/recebe guias/);
    expect(maria).toHaveTextContent(/opt-in em/);
    expect(maria).toHaveAttribute("data-situacao", "RECEBE");
    // ⚠ Quem é a PESSOA, lida da lista do portal — nunca adivinhada pelo nome.
    expect(maria).toHaveTextContent(/pessoa do portal: Maria do Cliente/);

    const fin = screen.getByTestId("contato-whatsapp-c2");
    expect(fin).toHaveAttribute("data-situacao", "SEM_OPT_IN");
    expect(fin).toHaveTextContent(/sem opt-in — não recebe/);
    expect(fin).toHaveTextContent(/não ligado a uma pessoa do portal/);
  });

  it("⚠ o número de 8 dígitos com prefixo de celular recebe o aviso de formato antigo", async () => {
    await montar();
    expect(screen.getByTestId("aviso-formato-antigo-c2")).toHaveTextContent(/formato antigo/);
    expect(screen.queryByTestId("aviso-formato-antigo-c1")).toBeNull();
  });

  it("com um contato que recebe, a empresa NÃO ganha a frase de 'só sai por e-mail'", async () => {
    await montar();
    expect(screen.queryByTestId("situacao-empresa-whatsapp")).toBeNull();
  });

  it("sem opt-in em NINGUÉM a frase diz que as guias só saem por e-mail até registrar a autorização", async () => {
    const api = apiFalso({ listarContatosWhatsapp: jest.fn(async () => ({ ok: true, contatos: [SEM_OPT_IN], canalPadraoEnvio: "EMAIL" })) });
    const feedback = { notifySuccess: jest.fn(), notifyError: jest.fn() };
    render(<Ponte api={api} feedback={feedback} />);
    await waitFor(() => expect(screen.getByTestId("situacao-empresa-whatsapp")).toHaveTextContent(/nenhum com opt-in/));
  });

  it("o canal padrão vem do servidor e aparece selecionado", async () => {
    await montar();
    expect(screen.getByLabelText("Canal padrão de envio das guias")).toHaveValue("WHATSAPP");
  });
});

describe("o formulário grava o que a rota espera", () => {
  it("opt-in marcado + pessoa escolhida → payload com optIn, origem e userId; telefone cru vai como digitado", async () => {
    const { api } = await montar();
    fireEvent.click(screen.getByRole("button", { name: /Adicionar contato/ }));
    const form = screen.getByTestId("form-contato-whatsapp");
    fireEvent.change(within(form).getByPlaceholderText(/quem recebe/), { target: { value: "João Sócio" } });
    fireEvent.change(within(form).getByPlaceholderText(/\(21\) 99999-8888/), { target: { value: "(21) 97777-6666" } });
    // A tela diz como o número será gravado ANTES de salvar.
    expect(form).toHaveTextContent(/será gravado como \+55 \(21\) 97777-6666/);
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "u1" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.change(within(form).getByPlaceholderText(/contrato, formulário/), { target: { value: "contrato de prestação" } });
    fireEvent.click(within(form).getByRole("button", { name: /Salvar contato/ }));

    await waitFor(() => expect(api.salvarContatoWhatsapp).toHaveBeenCalledTimes(1));
    const [companyId, payload] = api.salvarContatoWhatsapp.mock.calls[0];
    expect(companyId).toBe("pc-1");
    expect(payload).toEqual({
      nome: "João Sócio", papel: "", telefone: "(21) 97777-6666",
      // ⚠ `email` VIAJA VAZIO de propósito (05/09/2026): no servidor a string vazia é "sem e-mail",
      // e é assim que se APAGA o endereço de quem passou a receber só por WhatsApp.
      email: "",
      optIn: true, optInOrigem: "contrato de prestação", userId: "u1",
    });
    // Salvou → recarregou a lista.
    await waitFor(() => expect(api.listarContatosWhatsapp).toHaveBeenCalledTimes(2));
  });

  it("⚠ telefone inválido: o botão fica DESABILITADO com o motivo, e a API não é chamada", async () => {
    const { api } = await montar();
    fireEvent.click(screen.getByRole("button", { name: /Adicionar contato/ }));
    const form = screen.getByTestId("form-contato-whatsapp");
    fireEvent.change(within(form).getByPlaceholderText(/quem recebe/), { target: { value: "Alguém" } });
    fireEvent.change(within(form).getByPlaceholderText(/\(21\) 99999-8888/), { target: { value: "123" } });
    const botao = within(form).getByRole("button", { name: /Salvar contato/ });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/inválido/i);
    fireEvent.click(botao);
    expect(api.salvarContatoWhatsapp).not.toHaveBeenCalled();
  });

  it("opt-in DESMARCADO grava optIn:false sem origem — e o feedback diz que ainda não recebe", async () => {
    const { api, feedback } = await montar();
    fireEvent.click(screen.getByRole("button", { name: /Adicionar contato/ }));
    const form = screen.getByTestId("form-contato-whatsapp");
    fireEvent.change(within(form).getByPlaceholderText(/quem recebe/), { target: { value: "Sem Opt-in" } });
    fireEvent.change(within(form).getByPlaceholderText(/\(21\) 99999-8888/), { target: { value: "21955554444" } });
    fireEvent.click(within(form).getByRole("button", { name: /Salvar contato/ }));
    await waitFor(() => expect(api.salvarContatoWhatsapp).toHaveBeenCalled());
    const payload = api.salvarContatoWhatsapp.mock.calls[0][1];
    expect(payload.optIn).toBe(false);
    expect(payload).not.toHaveProperty("optInOrigem");
    expect(payload).not.toHaveProperty("userId");
    await waitFor(() => expect(feedback.notifySuccess).toHaveBeenCalledWith(expect.stringMatching(/ainda não recebe/)));
  });
});

describe("remover confirma repetindo os dados", () => {
  it("cancelada a confirmação, NADA é chamado; confirmada, chama com o id e a frase repete nome e telefone", async () => {
    const { api } = await montar();
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(screen.getByTestId("contato-whatsapp-c2")).getByRole("button", { name: /Remover/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/Financeiro/);
    expect(confirm.mock.calls[0][0]).toMatch(/\+55 \(21\) 9888-7777/);
    expect(api.removerContatoWhatsapp).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(screen.getByTestId("contato-whatsapp-c2")).getByRole("button", { name: /Remover/ }));
    await waitFor(() => expect(api.removerContatoWhatsapp).toHaveBeenCalledWith("pc-1", "c2"));
  });
});

describe("o canal padrão", () => {
  it("trocar chama o PATCH com o valor novo", async () => {
    const { api } = await montar();
    fireEvent.change(screen.getByLabelText("Canal padrão de envio das guias"), { target: { value: "PERGUNTAR" } });
    await waitFor(() => expect(api.definirCanalEnvio).toHaveBeenCalledWith("pc-1", "PERGUNTAR"));
    expect(screen.getByLabelText("Canal padrão de envio das guias")).toHaveValue("PERGUNTAR");
  });

  it("⚠ recusado pelo servidor, o select VOLTA ao valor anterior — a tela não afirma uma troca que não houve", async () => {
    const api = apiFalso({ definirCanalEnvio: jest.fn(async () => { const e = new Error("Canal deve ser um de…"); e.status = 400; throw e; }) });
    const { feedback } = await montar({ api });
    fireEvent.change(screen.getByLabelText("Canal padrão de envio das guias"), { target: { value: "EMAIL" } });
    await waitFor(() => expect(feedback.notifyError).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText("Canal padrão de envio das guias")).toHaveValue("WHATSAPP"));
  });
});

describe("erro de carga não apaga o que já estava na tela", () => {
  it("a segunda leitura falha: a lista continua com os dois e o feedback recebe o erro", async () => {
    const api = apiFalso();
    const { feedback } = await montar({ api });
    api.listarContatosWhatsapp.mockImplementationOnce(async () => { const e = new Error("500 interno"); e.status = 500; throw e; });
    // Uma remoção bem-sucedida dispara a recarga, que agora falha.
    jest.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(screen.getByTestId("contato-whatsapp-c1")).getByRole("button", { name: /Remover/ }));
    await waitFor(() => expect(feedback.notifyError).toHaveBeenCalledWith(expect.stringMatching(/500 interno/)));
    expect(screen.getByTestId("contato-whatsapp-c1")).toBeInTheDocument();
    expect(screen.getByTestId("contato-whatsapp-c2")).toBeInTheDocument();
  });
});
