// ⚠⚠ CANCELAR UMA NFS-e PELO PORTAL DO CLIENTE — a corrente inteira, e ela pratica ATO FISCAL
// IRREVERSÍVEL.
//
// > Decisão do dono (19/08/2026): *"esqueça substituir então, deixe apenas o cancelar."*
//
// O que esta suíte prova, e por que cada coisa:
//   1. ⚠⚠ a confirmação REPETE OS DADOS — número, tomador, valor, data. "Tem certeza?" não é
//      confirmação: aprende-se a clicar sem ler, e o clique na linha errada recebe a mesma
//      pergunta que o clique na certa;
//   2. ⚠ o motivo é LISTA FECHADA (`1`/`2`/`9`, do `TSCodJustCanc`) e **não vem pré-selecionado**;
//   3. ⚠ o mínimo da justificativa aparece ANTES de digitar, não como erro depois;
//   4. ⚠⚠ o desfecho de TRANSPORTE **DESABILITA** — não convida a repetir;
//   5. ⚠ o botão da linha ABRE a confirmação, nunca cancela direto.
//
// ⚠⚠ NADA É CANCELADO DE VERDADE: `api.cancelarNota` é espião, e um `afterEach` confere que
// nenhum caso o chamou sem passar pela confirmação. `api.emitirNfse` explode se for tocado.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../../shell/AppShell";

const CNPJ = "11222333000181";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: CNPJ,
  myRole: "OWNER",
  emissaoNfseLiberada: true,
  legacyCompany: {
    regimeTributario: "SIMPLES_NACIONAL",
    inscricaoMunicipal: "1234567",
    codigoServicoNacional: "010101",
    codigoServicoMunicipal: "1.01",
    rpsSerie: "1",
  },
};

function nota(patch = {}) {
  return {
    invoiceId: "inv-1001",
    type: "NFSE",
    numero: "13000",
    competencia: "2026-06",
    issueDate: "2026-06-10T00:00:00.000Z",
    status: "EMITIDA",
    total: 2300,
    emitente: { nome: "ACME SERVICOS LTDA", cnpj: CNPJ },
    tomador: { nome: "TOMADOR EXEMPLO LTDA", cnpjCpf: "44555666000177" },
    updatedAt: "2026-06-11T00:00:00.000Z",
    hasXml: true,
    hasPdf: false,
    // ⚠ `papel` passou a viajar no contrato em 20/08/2026 — é ele que distingue a nota que a
    // empresa EMITIU da que ela RECEBEU.
    papel: "EMIT",
    confirmadaPeloAdn: true,
    ...patch,
  };
}

function resposta(lista) {
  return {
    data: lista,
    page: 1,
    limit: 25,
    total: lista.length,
    summary: { totalInvoices: lista.length, totalAmount: 2300, pageAmount: 2300 },
  };
}

/** O erro como `realApi` o lança: `ApiError` com `corpo` inteiro. */
function recusa(status, code, message, corpo = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.corpo = { error: code, message, ...corpo };
  return err;
}

const JUSTIFICATIVA_OK = "Servico nao foi prestado ao tomador";

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getCompanies").mockResolvedValue([EMPRESA]);
  jest.spyOn(api, "getInvoices").mockResolvedValue(resposta([nota()]));
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "cancelarNota").mockResolvedValue({ ok: true, status: "cancelled" });
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  window.location.hash = "";
  jest.restoreAllMocks();
});

async function abrirNotas() {
  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("link", { name: "Notas" }));
  await act(async () => {});
  await screen.findByText("Notas emitidas");
}

const botaoCancelarDaLinha = () =>
  within(document.querySelector("tbody tr")).getByRole("button", { name: "Cancelar" });

async function abrirConfirmacao() {
  await abrirNotas();
  fireEvent.click(botaoCancelarDaLinha());
  await act(async () => {});
  return screen.getByRole("dialog");
}

function preencher({ motivo = "2", justificativa = JUSTIFICATIVA_OK } = {}) {
  fireEvent.change(document.getElementById("cancelar-motivo"), { target: { value: motivo } });
  fireEvent.change(document.getElementById("cancelar-justificativa"), {
    target: { value: justificativa },
  });
}

const botaoConfirmar = () => screen.getByRole("button", { name: "Cancelar esta nota" });

describe("⚠ 5. o botão da linha ABRE a confirmação — ele não cancela", () => {
  test("clicar em Cancelar não chama a API", async () => {
    await abrirNotas();
    fireEvent.click(botaoCancelarDaLinha());
    await act(async () => {});
    expect(api.cancelarNota).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("Voltar fecha sem cancelar nada", async () => {
    await abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelarNota).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ 1. a confirmação REPETE OS DADOS DA NOTA", () => {
  test("número, tomador, valor e data estão no diálogo", async () => {
    const dialogo = await abrirConfirmacao();
    expect(within(dialogo).getByText("13000")).toBeInTheDocument();
    expect(within(dialogo).getByText(/TOMADOR EXEMPLO LTDA/)).toBeInTheDocument();
    expect(within(dialogo).getByText("R$ 2.300,00")).toBeInTheDocument();
    expect(within(dialogo).getByText("10/06/2026")).toBeInTheDocument();
  });

  test('⚠ NÃO é um "tem certeza?"', async () => {
    const dialogo = await abrirConfirmacao();
    expect(dialogo.textContent).not.toMatch(/tem certeza/i);
    // E o botão destrutivo é nomeado pelo que faz, nunca "OK"/"Sim".
    expect(within(dialogo).queryByRole("button", { name: /^(OK|Sim)$/i })).not.toBeInTheDocument();
    expect(botaoConfirmar()).toBeInTheDocument();
  });

  test("diz que a nota cancelada não volta", async () => {
    const dialogo = await abrirConfirmacao();
    expect(dialogo.textContent).toMatch(/não volta/i);
  });
});

describe("⚠ 2. o motivo é lista FECHADA e não vem escolhido", () => {
  test("as três opções do `TSCodJustCanc`, e nada além", async () => {
    await abrirConfirmacao();
    const opcoes = [...document.getElementById("cancelar-motivo").options].map((o) => o.value);
    // "" é o "Escolha…" — os códigos são exatamente 1, 2 e 9.
    expect(opcoes).toEqual(["", "1", "2", "9"]);
    // ⚠ E NENHUM da lista da SUBSTITUIÇÃO (01…05, 99), que é outro tipo do XSD.
    expect(opcoes).not.toContain("01");
    expect(opcoes).not.toContain("99");
  });

  test("⚠⚠ NADA vem pré-selecionado — declarar motivo por conta própria foi o defeito do backend", async () => {
    await abrirConfirmacao();
    expect(document.getElementById("cancelar-motivo").value).toBe("");
    expect(botaoConfirmar()).toBeDisabled();
  });
});

describe("⚠ 3. o mínimo da justificativa aparece ANTES de digitar", () => {
  test("o diálogo já nasce dizendo o mínimo e quantos faltam", async () => {
    const dialogo = await abrirConfirmacao();
    expect(dialogo.textContent).toMatch(/Mínimo de 15 caracteres/);
    expect(dialogo.textContent).toMatch(/faltam 15/);
  });

  test("a contagem acompanha o que foi digitado", async () => {
    await abrirConfirmacao();
    preencher({ justificativa: "erro" });
    await act(async () => {});
    expect(screen.getByRole("dialog").textContent).toMatch(/faltam 11/);
    expect(botaoConfirmar()).toBeDisabled();
  });

  test("com motivo e 15 caracteres, o botão libera", async () => {
    await abrirConfirmacao();
    preencher({ justificativa: "a".repeat(15) });
    await act(async () => {});
    expect(botaoConfirmar()).toBeEnabled();
  });

  test("⚠ motivo sem justificativa NÃO libera, e justificativa sem motivo também não", async () => {
    await abrirConfirmacao();
    preencher({ motivo: "2", justificativa: "" });
    await act(async () => {});
    expect(botaoConfirmar()).toBeDisabled();

    preencher({ motivo: "", justificativa: JUSTIFICATIVA_OK });
    await act(async () => {});
    expect(botaoConfirmar()).toBeDisabled();
  });
});

describe("o desfecho feliz", () => {
  test("manda motivo e justificativa, fecha o diálogo e RECARREGA a lista", async () => {
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    await waitFor(() => expect(api.cancelarNota).toHaveBeenCalled());

    expect(api.cancelarNota).toHaveBeenCalledWith("pc-001", "inv-1001", {
      cMotivo: "2",
      justificativa: JUSTIFICATIVA_OK,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // ⚠ Sem o recarregamento, a nota continuaria "Emitida" na tela depois de cancelada.
    expect(api.getInvoices.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("⚠⚠ 4. TRANSPORTE — desfecho DESCONHECIDO: a tela DESABILITA, não convida a repetir", () => {
  beforeEach(() => {
    api.cancelarNota.mockRejectedValue(
      recusa(502, "nfse_cancelamento_transporte", "A resposta do sistema nacional não voltou.", {
        camada: "TRANSPORTE",
        podeTentarDeNovo: false,
        correcao:
          "NÃO envie o cancelamento de novo: consulte a situação da nota antes de decidir.",
      })
    );
  });

  test("o botão que cancela SOME, e sobra só Fechar", async () => {
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    // ⚠ Espera a RECUSA chegar à tela antes de medir os botões — sem isso a asserção corre contra
    // o estado anterior e o "some" passaria por engano, medindo o instante errado.
    await screen.findByRole("alert");

    expect(screen.queryByRole("button", { name: "Cancelar esta nota" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });

  test("⚠ a tela diz que NÃO SE SABE, e manda NÃO reenviar", async () => {
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    await screen.findByText(/Não sabemos se a nota foi cancelada/i);
    expect(screen.getByRole("alert").textContent).toMatch(/N[ÃA]O envie o cancelamento de novo/i);
  });

  test("⚠⚠ e os campos travam — não há como reenviar por dentro do diálogo", async () => {
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    await screen.findByRole("alert");

    expect(document.getElementById("cancelar-motivo")).toBeDisabled();
    expect(document.getElementById("cancelar-justificativa")).toBeDisabled();
    expect(api.cancelarNota).toHaveBeenCalledTimes(1);
  });
});

describe("⚠ RECEITA e recusas NOSSAS — aí SIM dá para corrigir e tentar de novo", () => {
  test("recusa do sistema nacional: a mensagem aparece e o botão CONTINUA lá", async () => {
    api.cancelarNota.mockRejectedValue(
      recusa(422, "nfse_cancelamento_rejeitado", "E0046 - NFS-e já cancelada.", {
        camada: "RECEITA",
        podeTentarDeNovo: true,
      })
    );
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    await screen.findByText(/O sistema nacional recusou o cancelamento/i);
    expect(screen.getByRole("alert").textContent).toMatch(/E0046/);
    expect(botaoConfirmar()).toBeEnabled();
  });

  test("⚠ motivo recusado traz a LISTA ACEITA do servidor para a tela", async () => {
    api.cancelarNota.mockRejectedValue(
      recusa(400, "c_motivo_invalido", "O motivo do evento é de lista fechada.", {
        camada: "NOSSA",
        podeTentarDeNovo: true,
        motivosAceitos: [
          { codigo: "1", rotulo: "Erro na emissão" },
          { codigo: "2", rotulo: "Serviço não prestado" },
          { codigo: "9", rotulo: "Outros" },
        ],
      })
    );
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    await screen.findByText(/O motivo do cancelamento não foi aceito/i);
    expect(screen.getByRole("alert").textContent).toMatch(/Serviço não prestado/);
  });
});

describe("⚠ BOTÃO IMPOSSÍVEL NÃO SOME — desabilitado, e o motivo continua alcançável", () => {
  // ⚠⚠ ATUALIZADO EM 19/08/2026, junto com a consolidação da frase repetida. Estes casos exigiam
  // o motivo como TEXTO VISÍVEL ao lado do botão. Os três impedimentos abaixo são da NOTA, não
  // desta ação — e cada botão da linha escrevendo o seu fazia a MESMA frase aparecer duas vezes
  // lado a lado ("Ainda não confirmada." no DANFSe e no Cancelar).
  //
  // ⚠ NÃO FOI RELAXADO: o que o caso protege — o botão NÃO some, ele NÃO abre o diálogo, e o
  // motivo CONTINUA alcançável — está tudo medido, e o `title` passou a ser a asserção do motivo.
  // Ver `lib/impedimento.js`.
  test.each([
    ["nota já CANCELADA", { status: "CANCELADA" }, /já não está válida/i],
    ["NF-e", { type: "NFE" }, /apenas NFS-e/i],
    ["ainda não confirmada pelo ADN", { confirmadaPeloAdn: false, hasXml: false }, /chave de acesso/i],
    // ⚠⚠ NOTA RECEBIDA — dono, 20/08/2026. Cancelar é ato do EMITENTE.
    ["RECEBIDA (papel DEST)", { papel: "DEST" }, /emitida PARA a sua empresa/i],
    [
      "RECEBIDA (deduzida pelo CNPJ, sem `papel`)",
      // A nota recebida de verdade tem os DOIS lados invertidos: quem emitiu foi um terceiro, e a
      // tomadora é a nossa empresa. Trocar só o tomador descreveria uma nota que a empresa emitiu
      // PARA SI MESMA — outro caso, e ele NÃO é impedimento de cancelamento.
      {
        papel: null,
        emitente: { nome: "PRESTADOR TERCEIRO LTDA", cnpj: "44555666000177" },
        tomador: { nome: "ACME SERVICOS LTDA", cnpjCpf: CNPJ },
      },
      /emitida PARA a sua empresa/i,
    ],
  ])("%s: desabilitado, com o motivo no `title` e NADA de texto repetido", async (_caso, patch, motivo) => {
    api.getInvoices.mockResolvedValue(resposta([nota(patch)]));
    await abrirNotas();
    const botao = botaoCancelarDaLinha();
    expect(botao).toBeInTheDocument();
    expect(botao).toBeDisabled();
    // ⚠ O motivo não sumiu — ele está no `title`, que não é texto na tela.
    expect(botao.getAttribute("title")).toMatch(motivo);
    // ⚠⚠ E a célula não escreve nada: o estado da nota é dito UMA vez por linha, pela coluna Tipo,
    // pelo chip e pelo `title`/`aria` dele.
    expect(botao.closest("td").textContent.trim()).toBe("Cancelar");

    fireEvent.click(botao);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelarNota).not.toHaveBeenCalled();
  });

  test("⚠ a frase que aparecia DUAS vezes na linha não aparece nenhuma", async () => {
    api.getInvoices.mockResolvedValue(resposta([nota({ confirmadaPeloAdn: false, hasXml: false })]));
    await abrirNotas();
    const linha = document.querySelector("tbody tr");
    expect(linha.textContent).not.toMatch(/Ainda não confirmada/);
  });
});

describe("⚠⚠ o CANCELAMENTO ENVIADO é feedback da ação — e não se confunde com a nota mais clara", () => {
  async function cancelarComSucesso() {
    await abrirConfirmacao();
    preencher();
    await act(async () => {});
    fireEvent.click(botaoConfirmar());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }

  test("a linha muda de estado no DOM, e é um estado PRÓPRIO", async () => {
    await cancelarComSucesso();
    const linha = document.querySelector("tbody tr");
    expect(linha.getAttribute("data-estado-nota")).toBe("cancelamento_enviado");
    // ⚠⚠ NÃO é o estado da nota emitida-não-confirmada: são dois fatos diferentes.
    expect(linha.getAttribute("data-estado-nota")).not.toBe("aguardando_adn");
  });

  test("⚠ o servidor CONTINUA dizendo EMITIDA — e é justamente por isso que a marca existe", async () => {
    await cancelarComSucesso();
    // A lista lê `PortalInvoice` (projeção do ADN) e nós não a escrevemos. Sem a marca local, a
    // linha voltaria ao normal e o clique pareceria não ter funcionado.
    expect(document.querySelector("tbody tr .chip").textContent).toBe("Emitida");
    expect(document.querySelector("tbody tr").getAttribute("data-estado-nota")).toBe("cancelamento_enviado");
  });

  test("⚠ o estado chega a quem não enxerga: `title`/`aria` do chip", async () => {
    await cancelarComSucesso();
    const chip = document.querySelector("tbody tr .chip");
    expect(chip.getAttribute("title")).toMatch(/Cancelamento enviado/i);
    expect(chip.getAttribute("aria-label")).toMatch(/Cancelamento enviado/i);
  });

  test("⚠⚠ NENHUMA explicação em texto na tela", async () => {
    await cancelarComSucesso();
    const corpo = document.body.textContent;
    for (const frase of [
      /aguardando confirmação do sistema nacional/i,
      /a lista mostra a nota como cancelada/i,
      /cancelamento enviado/i,
    ]) {
      expect(corpo).not.toMatch(frase);
    }
  });

  test("⚠⚠ e NÃO dá para mandar cancelar duas vezes", async () => {
    await cancelarComSucesso();
    const botao = botaoCancelarDaLinha();
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelarNota).toHaveBeenCalledTimes(1);
  });
});
