// ⚠⚠ A FILA DAS SAÍDAS DO CLIENTE, DENTRO DA CONFERÊNCIA (29/08/2026).
//
// > Dono: *"essas saídas que o cliente digitar aparecem para o contador na aba de conferência"*.
//
// ⚠⚠ O que este arquivo protege é a DISTÂNCIA entre decidir e lançar. Confirmar aqui diz que a
// previsão do cliente FICA no fluxo dele — não cria `AccountingEntry`, que afirmaria que o dinheiro
// saiu. Uma tela que sugerisse o contrário faria o contador procurar a conta contábil que não
// existe neste caminho.

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createApiClient } from "../../../../api/client";
import { PainelDeSaidasDoCliente } from "../PainelDeSaidasDoCliente";

jest.mock("../../../../api/client", () => {
  const api = {
    getConferenciaSaidasDoCliente: jest.fn(),
    postConferenciaSaidaDecidir: jest.fn(),
  };
  return { createApiClient: () => api, __api: api };
});

const api = createApiClient();

const DUAS = {
  ok: true,
  indisponivel: false,
  saidas: [
    { id: "sa-1", data: "2026-09-18", valor: "3500.00", descricao: "Reforma da sala", estado: "PENDENTE" },
    { id: "sa-2", data: "2026-09-30", valor: "820.00", descricao: "Curso da equipe", estado: "PENDENTE" },
  ],
};

async function montar(resposta = DUAS, props = {}) {
  api.getConferenciaSaidasDoCliente.mockResolvedValue(resposta);
  api.postConferenciaSaidaDecidir.mockResolvedValue({ ok: true });
  render(<PainelDeSaidasDoCliente companyId="emp-1" {...props} />);
  await act(async () => {});
}

beforeEach(() => { jest.clearAllMocks(); });

describe("⚠⚠ a fronteira: decidir NÃO é lançar", () => {
  it("a tela DIZ que confirmar não lança nada", async () => {
    await montar();
    expect(screen.getByText(/não lança nada/i)).toBeInTheDocument();
    expect(screen.getByText(/se a previsão fica no fluxo do cliente/i)).toBeInTheDocument();
  });

  it("⚠ e não oferece conta contábil nenhuma — este caminho não tem débito nem crédito", async () => {
    await montar();
    expect(screen.queryByText(/conta|débito|crédito/i)).toBeNull();
  });
});

describe("⚠⚠ decidir", () => {
  it("confirmar manda `CONFIRMADA` e recarrega a fila", async () => {
    await montar();
    await act(async () => {
      screen.getAllByRole("button", { name: "Confirmar" })[0].click();
    });
    expect(api.postConferenciaSaidaDecidir).toHaveBeenCalledWith("emp-1", "sa-1", {
      estado: "CONFIRMADA", motivoRecusa: null,
    });
    // ⚠ Recarrega, nunca tira a linha na mão: quem decide o que sobra na fila é o servidor.
    await waitFor(() => expect(api.getConferenciaSaidasDoCliente).toHaveBeenCalledTimes(2));
  });

  it("⚠⚠ RECUSAR EXIGE MOTIVO — o botão nasce desabilitado, e nada é enviado sem ele", async () => {
    // Ausência nunca é resposta: o cliente precisa saber por que a linha dele saiu do fluxo. É a
    // mesma regra que o declarado já segue.
    await montar();
    await act(async () => { screen.getAllByRole("button", { name: "Recusar…" })[0].click(); });
    const recusar = screen.getByRole("button", { name: "Recusar" });
    expect(recusar).toBeDisabled();
    fireEvent.click(recusar);
    expect(api.postConferenciaSaidaDecidir).not.toHaveBeenCalled();
  });

  it("⚠ com motivo, ele viaja junto", async () => {
    await montar();
    await act(async () => { screen.getAllByRole("button", { name: "Recusar…" })[0].click(); });
    fireEvent.change(screen.getByPlaceholderText(/Por que esta saída não fica/), {
      target: { value: "Isto é despesa pessoal do sócio" },
    });
    await act(async () => { screen.getByRole("button", { name: "Recusar" }).click(); });
    expect(api.postConferenciaSaidaDecidir).toHaveBeenCalledWith("emp-1", "sa-1", {
      estado: "RECUSADA", motivoRecusa: "Isto é despesa pessoal do sócio",
    });
  });

  it("⚠⚠ a frase do SERVIDOR vence — ela distingue 'já decidida' de 'não existe'", async () => {
    await montar();
    api.postConferenciaSaidaDecidir.mockRejectedValue({
      code: "saida_ja_decidida",
      corpo: { message: "Esta saída já foi decidida pelo seu contador." },
    });
    await act(async () => {
      screen.getAllByRole("button", { name: "Confirmar" })[0].click();
    });
    expect(screen.getByText(/já foi decidida/i)).toBeInTheDocument();
  });

  it("⚠ ele avisa quem desenha o SELO do botão de Conferência", async () => {
    // O selo conta ESTA fila também: sem o aviso, o número ficaria um a mais até a próxima abertura.
    const aoDecidir = jest.fn();
    await montar(DUAS, { aoDecidir });
    await act(async () => {
      screen.getAllByRole("button", { name: "Confirmar" })[0].click();
    });
    await waitFor(() => expect(aoDecidir).toHaveBeenCalled());
  });
});

describe("⚠⚠ as ausências não se confundem", () => {
  it("⚠⚠ INDISPONÍVEL não é 'nada pendente' — a migration é ato do dono", async () => {
    // Um painel que sumisse aqui faria o contador concluir que o cliente não escreveu nada. É a
    // mesma distinção que `nao_consultada` guarda na Situação Fiscal.
    await montar({ ok: true, indisponivel: true, saidas: [] });
    expect(screen.getByText(/tabela ainda não existe neste banco/i)).toBeInTheDocument();
    expect(screen.getByText(/limitação do sistema, não uma afirmação sobre esta empresa/i)).toBeInTheDocument();
  });

  it("⚠ fila VAZIA diz que está vazia — o painel não some", async () => {
    // Sumir esconderia que a fila existe, e o contador não saberia que o cliente PODE escrever.
    await montar({ ok: true, indisponivel: false, saidas: [] });
    expect(screen.getByText(/não acrescentou nenhuma saída ainda/i)).toBeInTheDocument();
  });
});

describe("⚠ a permissão", () => {
  it("sem poder escrever, os botões somem E o motivo é dito", async () => {
    // O servidor recusaria com 403; um botão que sempre falha é pior que a ausência dele.
    await montar(DUAS, { podeEscrever: false });
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.getAllByText(/Só um contador da empresa pode decidir/i).length).toBe(2);
  });
});

describe("⚠ a data é CIVIL", () => {
  it("`2026-09-18` sai `18/09/2026`, sem `new Date`", async () => {
    // O construtor de data interpretaria em UTC e mostraria o dia 17 no fuso de São Paulo.
    await montar();
    expect(screen.getByText(/18\/09\/2026/)).toBeInTheDocument();
  });
});
