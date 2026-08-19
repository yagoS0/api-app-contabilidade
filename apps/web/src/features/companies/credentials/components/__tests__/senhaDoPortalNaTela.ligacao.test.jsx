// A LIGAÇÃO — componente sem chamador é o defeito favorito deste projeto, então isto prova a
// corrente inteira, de baixo para cima:
//
//   `CompanyCredentialsTab`  monta  `AcessoPortalCliente`  quando recebe `acesso`
//   `AcessoPortalCliente`    chama  `acesso.definirSenha(userId)` só DEPOIS da confirmação
//   `useAcessoPortalCliente` chama  `api.resetPortalUserPassword(companyId, userId, {confirmado:true})`
//
// ⚠ As três invariantes que este arquivo existe para prender:
//   1. o PRIMEIRO clique NÃO troca senha nenhuma — ele só arma a confirmação;
//   2. a senha volta UMA VEZ à tela e NUNCA é gravada em `localStorage`/`sessionStorage`;
//   3. com DOIS usuários, a tela mostra os dois e a senha aparece embaixo da linha CERTA.

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanyCredentialsTab } from "../renderCompanyCredentialsTab";
import { useAcessoPortalCliente } from "../../hooks/useAcessoPortalCliente";

const MARIA = {
  userId: "u1", nome: "Maria do Cliente", email: "maria@empresa.com.br",
  papel: "OWNER", situacaoUsuario: "active",
  ultimaTroca: {
    origem: "CLIENTE_RECUPERACAO", em: "2026-08-11T09:14:00.000Z",
    autorUserId: "u1", autorNome: null, autorEmail: null,
  },
};
const JOAO = {
  userId: "u2", nome: "João Sócio", email: "joao@empresa.com.br",
  papel: "CLIENT_ADMIN", situacaoUsuario: "active", ultimaTroca: null,
};

const SENHA_GERADA = "Kfrp-7twn-Qx3m";

// Cofre vazio e inerte: esta suíte é sobre a seção de cima.
function vaultFalso() {
  return {
    credenciais: [], cofre: null, podeRevelar: false, papelMinimoRevelar: "FIRM_ADMIN",
    carregando: false, erro: null, informacoes: [], carregandoInfos: false, erroInfos: null,
    reveladas: new Map(), revelar: jest.fn(), esconder: jest.fn(),
    criar: jest.fn(), excluir: jest.fn(), criarInfo: jest.fn(), excluirInfo: jest.fn(),
    recarregar: jest.fn(), recarregarInfos: jest.fn(),
  };
}

function apiFalso(over = {}) {
  return {
    getPortalAccessUsers: jest.fn(async () => ({
      ok: true, usuarios: [MARIA], podeDefinirSenha: true, papelMinimoDefinirSenha: "ACCOUNTANT",
    })),
    resetPortalUserPassword: jest.fn(async (_c, userId) => ({
      ok: true,
      senha: SENHA_GERADA,
      usuario: { userId, nome: "Maria do Cliente", email: "maria@empresa.com.br", papel: "OWNER" },
      troca: { origem: "ESCRITORIO", em: "2026-08-19T12:00:00.000Z", autorNome: "Contador Fulano" },
    })),
    ...over,
  };
}

// Ponte real: o hook de verdade, montado como a página o monta.
function Ponte({ api, companyId = "pc-1", feedback }) {
  const acesso = useAcessoPortalCliente({ api, companyId, feedback });
  return (
    <CompanyCredentialsTab vault={vaultFalso()} acesso={acesso} razaoSocial="EMPRESA TESTE LTDA" />
  );
}

async function montar({ api = apiFalso(), companyId } = {}) {
  const feedback = { notifySuccess: jest.fn(), notifyError: jest.fn() };
  const utils = render(<Ponte api={api} companyId={companyId} feedback={feedback} />);
  await waitFor(() => expect(api.getPortalAccessUsers).toHaveBeenCalled());
  return { ...utils, api, feedback };
}

describe("a seção existe e tem chamador", () => {
  test("a aba monta a seção e a lista chega pelo hook", async () => {
    await montar();
    expect(await screen.findByText("Acesso do cliente ao portal")).toBeInTheDocument();
    expect(screen.getByTestId("usuario-portal-u1")).toBeInTheDocument();
    expect(screen.getByText("maria@empresa.com.br")).toBeInTheDocument();
  });

  test("⚠ a tela DIZ que não existe mostrar a senha atual", async () => {
    await montar();
    expect(screen.getByText(/não existe mostrar a senha atual/i)).toBeInTheDocument();
  });

  test("⚠ o ESTADO mostra a última troca, inclusive quando foi o PRÓPRIO CLIENTE", async () => {
    await montar();
    // É isto que o "portal do contador também muda" quer dizer: não há senha a sincronizar, há
    // estado a refletir.
    expect(screen.getByTestId("estado-senha-u1")).toHaveTextContent(/recuperação de e-mail/i);
  });

  test("a aba sem `acesso` não quebra — e não monta a seção", () => {
    render(<CompanyCredentialsTab vault={vaultFalso()} />);
    expect(screen.queryByText("Acesso do cliente ao portal")).not.toBeInTheDocument();
  });
});

describe("a confirmação repete os dados, e o primeiro clique não troca nada", () => {
  test("⚠ o PRIMEIRO clique só ARMA — nenhuma chamada sai", async () => {
    const { api } = await montar();

    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));

    expect(api.resetPortalUserPassword).not.toHaveBeenCalled();
    const dialogo = screen.getByTestId("confirmacao-senha-u1");
    expect(dialogo).toHaveTextContent("Maria do Cliente");
    expect(dialogo).toHaveTextContent("maria@empresa.com.br");
    expect(dialogo).toHaveTextContent("EMPRESA TESTE LTDA");
    expect(dialogo).toHaveTextContent(/sess(ões|oes) abertas/i);
    expect(dialogo).toHaveTextContent(/uma única vez/i);
    expect(dialogo).not.toHaveTextContent(/tem certeza/i);
  });

  test("cancelar fecha e não chama nada", async () => {
    const { api } = await montar();
    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));
    await waitFor(() => expect(screen.queryByTestId("confirmacao-senha-u1")).not.toBeInTheDocument());
    expect(api.resetPortalUserPassword).not.toHaveBeenCalled();
  });

  test("⚠ confirmar chama a API com `confirmado: true` e o userId CERTO", async () => {
    const { api } = await montar();
    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });
    // Duplo cinto: a tela confirmou E o campo viaja explícito. O servidor recusa sem ele.
    expect(api.resetPortalUserPassword).toHaveBeenCalledWith("pc-1", "u1", { confirmado: true });
  });
});

describe("a senha nova aparece UMA VEZ", () => {
  test("aparece na tela depois de confirmar, com o aviso de que é a única vez", async () => {
    await montar();
    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });

    expect(await screen.findByTestId("valor-senha-nova")).toHaveTextContent(SENHA_GERADA);
    expect(screen.getByTestId("senha-nova-portal")).toHaveTextContent(/única vez/i);
  });

  test("⚠⚠ a senha NUNCA vai para localStorage/sessionStorage", async () => {
    const setLocal = jest.spyOn(Storage.prototype, "setItem");
    await montar();
    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });
    await screen.findByTestId("valor-senha-nova");

    // O que se grava lá sobrevive ao logout, ao fechar a aba e à troca de usuário na mesma máquina.
    const gravado = JSON.stringify(setLocal.mock.calls);
    expect(gravado).not.toContain(SENHA_GERADA);
    setLocal.mockRestore();
  });

  test("⚠ a senha NUNCA entra num `title`", async () => {
    await montar();
    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });
    await screen.findByTestId("valor-senha-nova");

    // `title` vira tooltip e entra em captura de tela sem que ninguém tenha pedido.
    const comTitle = Array.from(document.querySelectorAll("[title]")).map((e) => e.getAttribute("title"));
    expect(comTitle.join(" | ")).not.toContain(SENHA_GERADA);
  });

  test("'já repassei' some com a senha, e ela não volta", async () => {
    await montar();
    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });
    await screen.findByTestId("valor-senha-nova");

    fireEvent.click(screen.getByRole("button", { name: /já repassei/i }));
    await waitFor(() => expect(screen.queryByTestId("valor-senha-nova")).not.toBeInTheDocument());
  });

  test("⚠ definir NÃO recarrega a lista — recarregar apagaria a senha que acabou de aparecer", async () => {
    const { api } = await montar();
    expect(api.getPortalAccessUsers).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /definir uma senha nova/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });
    await screen.findByTestId("valor-senha-nova");

    expect(api.getPortalAccessUsers).toHaveBeenCalledTimes(1);
    // O estado da linha é atualizado no lugar, com o que a própria resposta devolveu.
    expect(screen.getByTestId("estado-senha-u1")).toHaveTextContent(/pelo escritório/i);
  });
});

describe("⚠ DOIS usuários — a tela não escolhe sozinha", () => {
  const apiDois = () =>
    apiFalso({
      getPortalAccessUsers: jest.fn(async () => ({
        ok: true, usuarios: [MARIA, JOAO], podeDefinirSenha: true, papelMinimoDefinirSenha: "ACCOUNTANT",
      })),
    });

  test("os dois aparecem, com o aviso, e cada um com o próprio botão", async () => {
    await montar({ api: apiDois() });
    expect(screen.getByTestId("usuario-portal-u1")).toBeInTheDocument();
    expect(screen.getByTestId("usuario-portal-u2")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-usuarios-portal")).toHaveTextContent(/2 usuários/);
    expect(screen.getAllByRole("button", { name: /definir uma senha nova/i })).toHaveLength(2);
  });

  test("⚠ a senha aparece embaixo da linha CERTA, e o outro usuário não mostra nada", async () => {
    const api = apiDois();
    await montar({ api });

    // O segundo botão é o do João.
    fireEvent.click(screen.getAllByRole("button", { name: /definir uma senha nova/i })[1]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sim, definir uma senha nova/i }));
    });
    await screen.findByTestId("valor-senha-nova");

    expect(api.resetPortalUserPassword).toHaveBeenCalledWith("pc-1", "u2", { confirmado: true });
    expect(screen.getByTestId("usuario-portal-u2")).toContainElement(screen.getByTestId("valor-senha-nova"));
    expect(screen.getByTestId("usuario-portal-u1")).not.toContainElement(screen.getByTestId("valor-senha-nova"));
  });

  test("usuário sem registro de troca diz isso — não inventa data", async () => {
    await montar({ api: apiDois() });
    expect(screen.getByTestId("estado-senha-u2")).toHaveTextContent(/não há registro/i);
  });
});

describe("papel insuficiente e falha de carga", () => {
  test("⚠ STAFF vê o estado com o botão DESABILITADO, nomeando o motivo", async () => {
    const api = apiFalso({
      getPortalAccessUsers: jest.fn(async () => ({
        ok: true, usuarios: [MARIA], podeDefinirSenha: false, papelMinimoDefinirSenha: "ACCOUNTANT",
      })),
    });
    await montar({ api });

    const botao = screen.getByRole("button", { name: /definir uma senha nova/i });
    expect(botao).toBeDisabled();
    // Botão desabilitado NOMEIA o motivo — ninguém descobre o 403 clicando.
    expect(botao).toHaveAttribute("title", expect.stringContaining("ACCOUNTANT"));
  });

  test("⚠ falha de carga NÃO se parece com 'esta empresa não tem usuário'", async () => {
    const api = apiFalso({
      getPortalAccessUsers: jest.fn(async () => { throw new Error("caiu a rede"); }),
    });
    const { feedback } = await montar({ api });

    expect(screen.getByTestId("aviso-usuarios-portal")).toHaveTextContent(/não foi possível ler/i);
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
    expect(feedback.notifyError).toHaveBeenCalled();
  });
});
