// OS ATOS DO CONTRATO, NA TELA — excluir, desfazer a rescisão, e a ausência que parou de ser muda.
//
// Este arquivo cobre a LIGAÇÃO (os textos e a aritmética moram em `lib/exclusaoParcelamento.js`, com
// teste próprio). O que ele trava é o que o dono relatou, ponto por ponto:
//
//   1. o contrato RESCINDIDO era INVISÍVEL na aba (a lista filtrava `status !== "RESCINDIDO"`) —
//      contrato invisível é contrato incorrigível, e era exatamente o caso dele;
//   2. as prestações dele sumiam da fila de baixa SEM UMA PALAVRA — fila vazia é o mesmo pixel de
//      "não há nada pendente";
//   3. a confirmação da exclusão tem de REPETIR OS DADOS, não perguntar "tem certeza?";
//   4. sem motivo, o botão não age — e diz por quê.

import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ParcelamentoTab } from "../renderParcelamentoTab.jsx";

const mockListPendentes = jest.fn();
const mockListSemGuia = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    listParcelasPendentesBaixa: (...a) => mockListPendentes(...a),
    listParcelasSemGuiaPendentes: (...a) => mockListSemGuia(...a),
    lancarBaixaManualParcela: jest.fn(),
    lancarBaixaParcela: jest.fn(),
    buscarPagamentoGuia: jest.fn(),
  }),
}));

const RESCINDIDO = {
  id: "parc-rescindido", label: "OUTRO 2026 — rescindido por engano", tipo: "OUTRO",
  status: "RESCINDIDO", numeroParcelamento: "3", numParcelas: 12, parcelasTotal: 12,
  parcelasPagas: 0, principalPerParcela: 633.96, totalValue: 38037.74,
  guides: [], parcelas: [], parcelasContratadas: [], risco: null,
};

const PREVIEW_EXCLUSAO = {
  parcelamento: { id: "parc-rescindido", label: RESCINDIDO.label, numeroParcelamento: "3" },
  modo: "DELECAO",
  competenciaContraLancamento: null,
  competenciasFechadas: [],
  cabecalhoRemovido: true,
  prestacoes: { total: 12, quitadas: 2, semEvidencia: 10 },
  guias: { total: 1, baixadas: 0, voltamAContarComo: ["DAS"], lista: [] },
  lancamentos: {
    total: 1, apagados: 1, preservados: 0, linhasDeRastreio: 0,
    lista: [{ id: "e1", tipo: "PROVISAO", competencia: "2026-01", historico: "PROVISÃO OUTRO — principal", tipoLinha: "PRINCIPAL", valor: 12000, mesFechado: false }],
  },
  totalDesfeito: 12000,
  motivoObrigatorio: true,
  avisos: [],
  bloqueios: [],
};

function montar({ semGuia = [], foraDaFila = null, contratos = [RESCINDIDO], hook = {} } = {}) {
  mockListPendentes.mockResolvedValue({ ok: true, parcelas: [] });
  mockListSemGuia.mockResolvedValue({ ok: true, parcelas: semGuia, foraDaFila });
  const parcelamentos = {
    parcelamentos: contratos, loading: false, error: null,
    load: jest.fn(), listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
    previewExclusao: jest.fn(async () => PREVIEW_EXCLUSAO),
    excluir: jest.fn(async () => ({ ok: true })),
    previewDesfazerRescisao: jest.fn(async () => ({
      parcelamento: { id: RESCINDIDO.id, label: RESCINDIDO.label },
      modo: "DELECAO", competenciaContraLancamento: null, competenciasFechadas: [],
      lancamentos: { total: 0, preservados: 0, lista: [] }, totalDesfeito: 0,
      prestacoes: { total: 12, quitadas: 0, semEvidencia: 12, voltamParaFila: 12 },
      riscoAoReativar: null, bloqueios: [],
    })),
    desfazerRescisao: jest.fn(async () => ({ ok: true })),
    ...hook,
  };
  render(<ParcelamentoTab companyId="c1" parcelamentos={parcelamentos} />);
  return parcelamentos;
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  mockListPendentes.mockReset();
  mockListSemGuia.mockReset();
});

const COM_ESCONDIDAS = {
  prestacoes: 12,
  contratos: [{ parcelamentoId: "parc-rescindido", label: "OUTRO 2026", numeroParcelamento: "3", prestacoes: 12 }],
  motivo: "PARCELAMENTO_RESCINDIDO",
};

describe("⚠ a ausência da rescisão deixou de ser muda", () => {
  // ⚠ A INFORMAÇÃO PASSOU A MORAR EM UM LUGAR SÓ (Fase 1), e este teste virou dois porque a
  // separação é o ponto: a FILA diz que há prestações fora dela (senão a ausência volta a ser muda)
  // e aponta; a SEÇÃO "Contratos rescindidos" guarda o contrato, a contagem e as duas saídas.
  // Antes as duas coisas estavam nos dois lugares — a mesma frase, a mesma lista e o mesmo botão,
  // duplicados a uma tela de distância.
  it("a fila DIZ quantas prestações estão fora, e aponta para onde a informação está", async () => {
    await act(async () => { montar({ semGuia: [], foraDaFila: COM_ESCONDIDAS }); });

    // ⚠ A âncora deixou de ser o título da fila: com a fila VAZIA ela não escreve mais nada
    // (dono, 21/08/2026). Ancoramos no próprio fato dos rescindidos — que é o que este teste
    // mede, e que SOBREVIVE à fila vazia justamente por não ser a ausência de itens nela.
    const painel = screen.getByText(/prestações estão fora desta fila/i).closest("section");
    expect(within(painel).getByText(/12 prestações estão fora desta fila/i)).toBeTruthy();
    expect(within(painel).getByRole("button", { name: /Ver contratos rescindidos/i })).toBeTruthy();
    // ⚠ E o que saiu daqui NÃO É CAPACIDADE: o desfazer continua existindo, na seção para onde o
    // ponteiro leva — o que saiu foi a segunda cópia dele.
    expect(within(painel).queryByRole("button", { name: /Desfazer rescisão/i })).toBeNull();
  });

  it("a contagem de prestações fora da fila aparece no contrato, na seção dos rescindidos", async () => {
    await act(async () => { montar({ semGuia: [], foraDaFila: COM_ESCONDIDAS }); });

    // ⚠ `\(` no seletor: o ponteiro da fila também diz "Ver contratos rescindidos", e é assim que
    // deve ser — a seção é a que traz a CONTAGEM entre parênteses.
    const secao = screen.getByText(/Contratos rescindidos \(/i).closest("section");
    // ⚠ ESTE NÚMERO NÃO É `parcelasTotal`. É quantas prestações VENCIDAS estão fora da fila de
    // baixa por causa da rescisão — o número que o dono nunca viu, e o único que a seção não sabia
    // sozinha. Ele veio da fila e é desenhado aqui, uma vez.
    expect(within(secao).getByText(/12 prestações vencidas/i)).toBeTruthy();
    expect(within(secao).getByText(/fora da fila de baixa por causa da rescisão/i)).toBeTruthy();
    expect(within(secao).getByRole("button", { name: /Desfazer rescisão/i })).toBeTruthy();
    expect(within(secao).getByRole("button", { name: /Excluir contrato/i })).toBeTruthy();
  });

  // ⚠ CONTRATO ÓRFÃO: a lista de parcelamentos pode falhar (o `error` do hook), e aí o contrato que
  // está segurando prestações fora da fila não estaria em lugar nenhum. A seção o desenha assim
  // mesmo — some a duplicação, nunca a informação.
  it("contrato fora da lista ainda aparece, com a contagem e o caminho de volta", async () => {
    await act(async () => { montar({ semGuia: [], foraDaFila: COM_ESCONDIDAS, contratos: [] }); });

    const secao = screen.getByText(/Contratos rescindidos \(/i).closest("section");
    expect(within(secao).getByText(/OUTRO 2026/)).toBeTruthy();
    expect(within(secao).getByText(/12 prestações vencidas/i)).toBeTruthy();
    expect(within(secao).getByRole("button", { name: /Desfazer rescisão/i })).toBeTruthy();
  });

  it("sem nada escondido, nenhum aviso aparece — aviso permanente é aviso ignorado", async () => {
    await act(async () => {
      montar({ semGuia: [], foraDaFila: { prestacoes: 0, contratos: [], motivo: "PARCELAMENTO_RESCINDIDO" } });
    });
    // ⚠ SEM ÂNCORA, E DE PROPÓSITO. Este teste mede a AUSÊNCIA do ponteiro dos rescindidos, então
    // ancorar nele seria circular. E desde 21/08/2026 a fila vazia não escreve título nenhum, então
    // também não há painel onde procurar: a asserção passa a ser sobre a TELA INTEIRA, que é o que
    // "nenhum aviso aparece" sempre quis dizer.
    expect(screen.queryByText(/fora desta fila/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Ver contratos rescindidos/i })).toBeNull();
  });
});

describe("⚠ o contrato rescindido deixou de ser invisível", () => {
  it("aparece em seção própria, com as DUAS saídas", async () => {
    await act(async () => { montar({}); });

    const secao = screen.getByText(/Contratos rescindidos \(1\)/i).closest("section");
    expect(within(secao).getByText(/OUTRO nº 3/)).toBeTruthy();
    expect(within(secao).getByText(/12 prestações/)).toBeTruthy();
    expect(within(secao).getByRole("button", { name: /Desfazer rescisão/i })).toBeTruthy();
    expect(within(secao).getByRole("button", { name: /Excluir contrato/i })).toBeTruthy();
  });

  it("sem contrato rescindido, a seção não existe", async () => {
    await act(async () => { montar({ contratos: [{ ...RESCINDIDO, status: "ATIVO", risco: null }] }); });
    expect(screen.queryByText(/Contratos rescindidos/i)).toBeNull();
  });
});

describe("a confirmação da exclusão REPETE OS DADOS", () => {
  async function abrirExclusao() {
    const hook = montar({});
    await act(async () => {});
    const secao = screen.getByText(/Contratos rescindidos/i).closest("section");
    await act(async () => {
      fireEvent.click(within(secao).getByRole("button", { name: /Excluir contrato/i }));
    });
    return hook;
  }

  it("mostra prestações, quitadas, guia e o total — e não um 'tem certeza?'", async () => {
    await abrirExclusao();

    const dialog = screen.getByRole("dialog", { name: /Excluir parcelamento/i });
    expect(within(dialog).getByText(/1 lançamento sai do razão, somando R\$ 12\.000,00/)).toBeTruthy();
    expect(within(dialog).getByText(/12 prestações do contrato deixam de existir/)).toBeTruthy();
    expect(within(dialog).getByText(/2 delas constam QUITADAS/)).toBeTruthy();
    expect(within(dialog).getByText(/1 guia é DESVINCULADA/)).toBeTruthy();
  });

  it("sem motivo o botão NÃO age, e diz o motivo de estar desabilitado", async () => {
    const hook = await abrirExclusao();

    const dialog = screen.getByRole("dialog", { name: /Excluir parcelamento/i });
    const botao = within(dialog).getByRole("button", { name: /Excluir parcelamento/i });
    expect(botao.disabled).toBe(true);
    expect(botao.title).toMatch(/Escreva o motivo/);
    await act(async () => { fireEvent.click(botao); });
    expect(hook.excluir).not.toHaveBeenCalled();
  });

  it("com motivo, confirma mandando o TOTAL CONFERIDO que está na tela", async () => {
    const hook = await abrirExclusao();

    const dialog = screen.getByRole("dialog", { name: /Excluir parcelamento/i });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "parcelamento lançado errado" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Excluir parcelamento/i }));
    });

    // ⚠ `totalConferido` é a guarda que impede excluir algo diferente do que foi confirmado.
    expect(hook.excluir).toHaveBeenCalledWith("parc-rescindido", {
      motivo: "parcelamento lançado errado",
      totalConferido: 12000,
    });
  });

  it("recusa do servidor fica NA TELA, com o motivo, e o modal NÃO fecha", async () => {
    const erro = Object.assign(new Error("Reabra 08/2026 para excluir."), { code: "MES_CORRENTE_FECHADO" });
    const hook = montar({ hook: { excluir: jest.fn(async () => { throw erro; }) } });
    await act(async () => {});
    const secao = screen.getByText(/Contratos rescindidos/i).closest("section");
    await act(async () => {
      fireEvent.click(within(secao).getByRole("button", { name: /Excluir contrato/i }));
    });
    const dialog = screen.getByRole("dialog", { name: /Excluir parcelamento/i });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "contrato errado" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Excluir parcelamento/i }));
    });

    expect(hook.excluir).toHaveBeenCalled();
    // Perder o que foi digitado por causa de uma recusa é o oposto de tratar bem quem clicou.
    expect(screen.getByRole("dialog", { name: /Excluir parcelamento/i })).toBeTruthy();
    expect(screen.getByText(/Reabra 08\/2026 para excluir/)).toBeTruthy();
  });
});

describe("desfazer a rescisão", () => {
  it("mostra o que volta e exige motivo antes de agir", async () => {
    const hook = montar({});
    await act(async () => {});
    const secao = screen.getByText(/Contratos rescindidos/i).closest("section");
    await act(async () => {
      fireEvent.click(within(secao).getByRole("button", { name: /Desfazer rescisão/i }));
    });

    const dialog = screen.getByRole("dialog", { name: /Desfazer a rescisão/i });
    expect(within(dialog).getByText(/12 prestações vencidas voltam/)).toBeTruthy();
    // ⚠ O limite do que o botão promete: isto não fala com a Receita.
    expect(within(dialog).getByText(/perante a Receita é ato dela/)).toBeTruthy();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "rescindido por engano" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Desfazer a rescisão/i }));
    });
    expect(hook.desfazerRescisao).toHaveBeenCalledWith("parc-rescindido", { motivo: "rescindido por engano" });
  });
});
