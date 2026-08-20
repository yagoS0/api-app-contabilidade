// F2.6 — "NÃO CONSIGO DAR BAIXA NA PARCELA DO PARCELAMENTO": o vão entre as duas telas.
//
// ⚠ O CASO É REAL, medido em produção (20/08/2026): PARCSN nº 2, competência 2026-07, R$ 332,65,
// guia `PAID` vinda de UPLOAD, `TributoParcela` = ZERO. A fila respondia
//
//     "Nada foi lançado: a parcela não tem composição por tributo, então não dá para separar
//      principal, juros e multa."
//
// …e parava aí. A outra tela (`BaixaManualParcelaModal`) declara os valores, mas é a da prestação
// SEM GUIA — o servidor recusa toda prestação com guia lá (`parcela_tem_guia`), de propósito.
// Não havia caminho nenhum.
//
// ⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO. Estes testes exercem a LIGAÇÃO
// inteira, pela tela: clicar em "Dar baixa" → receber a recusa → o botão da saída APARECER →
// preencher → o que efetivamente sobe na chamada. Testar o modal isolado provaria que ele
// funciona, não que ele é alcançável.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ParcelamentoTab } from "../renderParcelamentoTab.jsx";

const mockListPendentes = jest.fn();
const mockLancarBaixa = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    listParcelasPendentesBaixa: (...a) => mockListPendentes(...a),
    lancarBaixaParcela: (...a) => mockLancarBaixa(...a),
    buscarPagamentoGuia: jest.fn(),
  }),
}));

// A linha do dono, com os números dele.
const LINHA = {
  parcelaId: "p-alessandro-2",
  guideId: "g-upload-2",
  numeroParcela: 2,
  competencia: "2026-07",
  valor: 332.65,
  vencimento: null,
  parcelamentoId: "parc-sn",
  confirmadoEm: "2026-08-18T13:41:33.000Z",
  comprovante: null,
};

const contrato = () => ({
  id: "parc-sn", label: "PARCSN 2026", tipo: "PARCSN", numeroParcelamento: "2",
  status: "ATIVO", numParcelas: 60, parcelasTotal: 60, parcelasPagas: 1,
  principalPerParcela: 332.65, totalValue: 19959, formaPagamento: "GUIA_MENSAL",
  guides: [], parcelas: [], parcelasContratadas: [],
});

function montar() {
  mockListPendentes.mockResolvedValue({ ok: true, parcelas: [LINHA] });
  return render(
    <ParcelamentoTab
      companyId="c1"
      parcelamentos={{
        parcelamentos: [contrato()], loading: false, error: null,
        load: jest.fn(), listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
      }}
    />,
  );
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

beforeEach(() => {
  mockListPendentes.mockReset();
  mockLancarBaixa.mockReset();
  jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { jest.restoreAllMocks(); });

// A fila fica ACIMA dos cards; o "Dar baixa" dela é o PRIMEIRO do DOM (o do card é o último).
const darBaixaDaFila = () => screen.getAllByRole("button", { name: "Dar baixa" })[0];

async function recusarPorSemComposicao() {
  mockLancarBaixa.mockResolvedValueOnce({ ok: false, skipped: true, motivo: "sem_composicao" });
  await act(async () => { montar(); });
  await act(async () => { fireEvent.click(darBaixaDaFila()); });
}

async function abrirModal() {
  await recusarPorSemComposicao();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Informar a composição" })); });
}

function preencher({ principal = "300,15", juros = "22,50", multa = "10,00" } = {}) {
  fireEvent.change(screen.getByLabelText("Principal"), { target: { value: principal } });
  fireEvent.change(screen.getByLabelText("Juros"), { target: { value: juros } });
  fireEvent.change(screen.getByLabelText("Multa"), { target: { value: multa } });
}

describe("a recusa deixou de ser um beco", () => {
  it("o motivo agora aponta a SAÍDA, em vez de só descrever o impedimento", async () => {
    await recusarPorSemComposicao();
    expect(screen.getByText(/não tem composição por tributo/i)).toBeTruthy();
    expect(screen.getByText(/informe a composição você mesmo/i)).toBeTruthy();
  });

  // ⚠ A trava mais importante desta fase: o botão EXISTE e está ligado.
  it("a linha recusada ganha o botão que resolve o problema", async () => {
    await recusarPorSemComposicao();
    expect(screen.getByRole("button", { name: "Informar a composição" })).toBeTruthy();
  });

  // ⚠ Antes da recusa a fila NÃO sabe se a guia tem composição (a rota não devolve isso), e
  // oferecer a declaração em toda linha convidaria a declarar por cima de um documento que existe.
  it("linha que ainda não foi recusada NÃO oferece a declaração", async () => {
    await act(async () => { montar(); });
    expect(screen.queryByRole("button", { name: "Informar a composição" })).toBeNull();
  });

  it("outra recusa (provisão ausente) não abre a saída — ela não se resolve nesta tela", async () => {
    mockLancarBaixa.mockResolvedValueOnce({ ok: false, skipped: true, motivo: "provisao_inexistente" });
    await act(async () => { montar(); });
    await act(async () => { fireEvent.click(darBaixaDaFila()); });
    expect(screen.queryByRole("button", { name: "Informar a composição" })).toBeNull();
  });
});

describe("o modal diz o que é prova e o que é declaração", () => {
  it("separa o pagamento (comprovado) da composição (declarada)", async () => {
    await abrirModal();
    expect(screen.getByText(/O pagamento está comprovado; a COMPOSIÇÃO é sua declaração/i)).toBeTruthy();
    expect(screen.getByText(/composição declarada/i)).toBeTruthy();
  });

  // ⚠ Aqui digitar o principal NÃO reescreve o contrato — é a diferença para a tela da prestação
  // sem guia, onde o mesmo campo é `valorPrevisto` e persiste.
  it("avisa que o principal informado vale só para este lançamento", async () => {
    await abrirModal();
    expect(screen.getByText(/não altera o contrato/i)).toBeTruthy();
  });

  // ⚠ TRAVA 5 — mês fechado bloqueia, e a tela diz o que fazer ANTES do clique.
  it("avisa sobre mês fechado e como sair dele", async () => {
    await abrirModal();
    expect(screen.getByText(/Mês fechado recusa/i)).toBeTruthy();
    expect(screen.getByText(/reabra a competência/i)).toBeTruthy();
  });

  it("mostra o que será lançado, linha a linha, antes do clique", async () => {
    await abrirModal();
    preencher();
    expect(screen.getByText("Parcelamento a pagar")).toBeTruthy();
    // ⚠ `getAllByText`: "Juros"/"Multa" também são os RÓTULOS dos campos, logo acima. A prévia é a
    // segunda ocorrência — e é a existência dela, não a unicidade do texto, que está sob teste.
    expect(screen.getAllByText("Juros").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Multa").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Caixa/banco")).toBeTruthy();
    expect(screen.getAllByText("amortiza o passivo").length).toBeGreaterThan(0);
  });
});

describe("nada é derivado por subtração", () => {
  // ⚠ A tentação exata: a guia diz 332,65, o contador digita só o principal. A tela NÃO completa
  // a diferença em juros — ela avisa que a soma não bate e deixa a decisão com quem tem o DAS.
  it("principal sozinho não vira 'juros = guia − principal': a tela AVISA a diferença", async () => {
    await abrirModal();
    preencher({ principal: "300,15", juros: "", multa: "" });
    expect(screen.getByText(/A soma não bate com o valor da guia/i)).toBeTruthy();
    expect(screen.getByText(/Nada é deduzido por subtração aqui/i)).toBeTruthy();
    // E os campos continuam como o contador os deixou — nenhum foi preenchido pela tela.
    expect(screen.getByLabelText("Juros").value).toBe("");
    expect(screen.getByLabelText("Multa").value).toBe("");
  });

  it("a divergência AVISA e não bloqueia — o valor pago pode legitimamente diferir da guia", async () => {
    await abrirModal();
    preencher({ principal: "300,15", juros: "", multa: "" });
    expect(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }).disabled).toBe(false);
  });

  it("com a soma fechando, o aviso some", async () => {
    await abrirModal();
    preencher();
    expect(screen.queryByText(/A soma não bate com o valor da guia/i)).toBeNull();
  });

  it("principal em branco BLOQUEIA, com o motivo — ele não se inventa", async () => {
    await abrirModal();
    preencher({ principal: "", juros: "", multa: "" });
    const botao = screen.getByRole("button", { name: /Informar a composição e dar baixa/i });
    expect(botao.disabled).toBe(true);
    // ⚠ A frase é a DESTA tela ("lendo o DAS"), não a da prestação sem guia ("valor contratado") —
    // reusar aquela mandaria o contador corrigir um contrato que não é o problema aqui.
    expect(screen.getAllByText(/Informe o principal da parcela, lendo o DAS/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/valor contratado desta prestação/i)).toBeNull();
  });
});

describe("o que sobe na chamada", () => {
  it("vai pela MESMA rota da baixa, com a composição e o total conferido", async () => {
    await abrirModal();
    preencher();
    mockLancarBaixa.mockResolvedValueOnce({ ok: true, resultado: { pagamentoId: "e1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });

    const [companyId, guideId, body] = mockLancarBaixa.mock.calls.at(-1);
    expect(companyId).toBe("c1");
    expect(guideId).toBe("g-upload-2");
    expect(body.composicaoDeclarada).toEqual({
      principal: 300.15, juros: 22.5, multa: 10, totalConferido: 332.65,
    });
    expect(body.dataPagamento).toBeTruthy();
  });

  // ⚠ O total NÃO se digita e NÃO viaja de outro lugar: é a soma dos três, feita para frente.
  it("`totalConferido` é a soma dos três campos, nunca o valor da guia", async () => {
    await abrirModal();
    preencher({ principal: "100,00", juros: "0", multa: "0" });
    mockLancarBaixa.mockResolvedValueOnce({ ok: true, resultado: { pagamentoId: "e1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    const body = mockLancarBaixa.mock.calls.at(-1)[2];
    expect(body.composicaoDeclarada.totalConferido).toBe(100);
  });

  // ⚠ A confirmação REPETE OS DADOS antes de gravar lançamento contábil.
  it("confirma repetindo os valores, o total e a natureza da declaração", async () => {
    await abrirModal();
    preencher();
    mockLancarBaixa.mockResolvedValueOnce({ ok: true, resultado: { pagamentoId: "e1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    const texto = window.confirm.mock.calls.at(-1)[0];
    expect(texto).toMatch(/Principal \(você informou\)/);
    expect(texto).toMatch(/composição declarada/);
    expect(texto).toMatch(/GRAVA lançamentos contábeis/);
  });

  it("cancelar a confirmação não chama o servidor", async () => {
    await abrirModal();
    preencher();
    window.confirm.mockReturnValue(false);
    const antes = mockLancarBaixa.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    expect(mockLancarBaixa.mock.calls.length).toBe(antes);
  });

  // ⚠ A baixa NORMAL não pode ter mudado: o segundo argumento continua ausente.
  it("o 'Dar baixa' de sempre continua chamando SEM body", async () => {
    await recusarPorSemComposicao();
    const [, , body] = mockLancarBaixa.mock.calls[0];
    expect(body).toBeFalsy();
  });
});

describe("a recusa do servidor fica no modal, com o motivo", () => {
  it("mês fechado: nada foi lançado, e o modal diz como sair", async () => {
    await abrirModal();
    preencher();
    const err = new Error("Mês 2026-08 fechado — reabra antes de baixar a parcela.");
    err.code = "MES_FECHADO";
    mockLancarBaixa.mockRejectedValueOnce(err);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    expect(screen.getByText("Nada foi lançado")).toBeTruthy();
    expect(screen.getByText(/está FECHADA/i)).toBeTruthy();
  });

  it("total divergente: o modal fica aberto e o que foi digitado permanece", async () => {
    await abrirModal();
    preencher();
    const err = new Error("O total que o servidor calcula não bate.");
    err.code = "CONFERENCIA_DIVERGENTE";
    mockLancarBaixa.mockRejectedValueOnce(err);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    expect(screen.getByText(/não deduz nenhum deles por subtração/i)).toBeTruthy();
    expect(screen.getByLabelText("Principal").value).toBe("300,15");
  });

  // ⚠ O documento venceu a declaração enquanto a tela estava aberta: a saída se FECHA, senão
  // ofereceria uma declaração que o servidor vai recusar para sempre.
  it("`composicao_ja_existe` fecha o modal e retira a oferta de declarar", async () => {
    await abrirModal();
    preencher();
    mockLancarBaixa.mockResolvedValueOnce({ ok: false, skipped: true, motivo: "composicao_ja_existe" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    expect(screen.queryByRole("button", { name: "Informar a composição" })).toBeNull();
    expect(screen.getByText(/O documento vence a declaração|documento vence/i)).toBeTruthy();
  });
});

describe("o desfecho SOBREVIVE ao recarregamento — a linha sai da fila", () => {
  // ⚠ A baixa TIRA a prestação da fila, e o aviso da linha vai junto com ela. Sem um desfecho de
  // SEÇÃO, o contador clicaria e veria a fila vazia — indistinguível de "não aconteceu nada", que
  // é a queixa que esta aba já pagou uma vez.
  it("baixa por declaração é anunciada como tal, e continua visível com a fila vazia", async () => {
    await abrirModal();
    preencher();
    mockLancarBaixa.mockResolvedValueOnce({ ok: true, resultado: { pagamentoId: "e1" } });
    mockListPendentes.mockResolvedValue({ ok: true, parcelas: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Informar a composição e dar baixa/i }));
    });
    expect(screen.getByText(/Parcela 2 baixada com a composição que você informou/i)).toBeTruthy();
    // E o modal fechou — a baixa saiu.
    expect(screen.queryByRole("dialog", { name: /Informar a composição da parcela/i })).toBeNull();
  });
});
