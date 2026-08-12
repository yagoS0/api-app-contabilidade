// AS DUAS FILAS SÃO DUAS, E A DIFERENÇA NÃO PODE SUMIR.
//
// A fila que já existia responde *"a guia foi paga, falta lançar"* — há um SINAL EXTERNO (o
// `paymentStatus` que veio do SERPRO), e a ação é um clique sobre valores lidos do documento.
// A fila nova responde *"esta prestação venceu e não há guia; você declara que foi debitada?"* —
// não há sinal nenhum, e a ação é um formulário onde juros e multa são DECLARADOS.
//
// Este arquivo cobre a LIGAÇÃO (a aritmética e os textos moram em `lib/baixaManualParcela.js`, com
// teste próprio): que as duas filas aparecem separadas e nomeiam a diferença, que a fila nova não
// engole falha de rede como "não há nada", que a recusa fica na tela, e que a prestação SAI da fila
// depois de declarada.

import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ParcelamentoTab } from "../renderParcelamentoTab.jsx";

const mockListPendentes = jest.fn();
const mockListSemGuia = jest.fn();
const mockBaixaManual = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    listParcelasPendentesBaixa: (...a) => mockListPendentes(...a),
    listParcelasSemGuiaPendentes: (...a) => mockListSemGuia(...a),
    lancarBaixaManualParcela: (...a) => mockBaixaManual(...a),
    lancarBaixaParcela: jest.fn(),
    buscarPagamentoGuia: jest.fn(),
  }),
}));

const contrato = {
  id: "parc-migrado-60", label: "OUTRO 2026 — migrado", tipo: "OUTRO", status: "ATIVO",
  numParcelas: 60, parcelasTotal: 60, parcelasPagas: 0, principalPerParcela: 1200,
  totalValue: 38037.74, formaPagamento: null, guides: [], parcelas: [], parcelasContratadas: [],
};

const linhaSemGuia = (over = {}) => ({
  parcelaId: "parc-migrado-60-p1", numeroParcela: 1, competencia: "2026-07",
  vencimento: "2026-07-20T12:00:00.000Z", valorPrevisto: 633.96, situacao: "VENCIDA",
  parcelamentoId: "parc-migrado-60",
  parcelamento: {
    id: "parc-migrado-60", label: "OUTRO 2026 — migrado", tipo: "OUTRO", numParcelas: 60,
    numeroParcelamento: "3", formaPagamento: "DEBITO_AUTOMATICO", temProvisaoDeAbertura: true,
  },
  podeBaixar: true, motivoBloqueio: null,
  ...over,
});

function montar({ pendentes = [], semGuia = [] } = {}) {
  mockListPendentes.mockResolvedValue({ ok: true, parcelas: pendentes });
  mockListSemGuia.mockResolvedValue({ ok: true, parcelas: semGuia });
  return render(
    <ParcelamentoTab
      companyId="c1"
      parcelamentos={{
        parcelamentos: [contrato], loading: false, error: null,
        load: jest.fn(), listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
      }}
    />,
  );
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  mockListPendentes.mockReset();
  mockListSemGuia.mockReset();
  mockBaixaManual.mockReset();
});

const painelSemGuia = () => screen.getByText(/Prestações vencidas sem guia/i).closest("section");

describe("as duas filas coexistem e a diferença é DITA", () => {
  it("a fila nova diz que aqui não há documento e que quem afirma é o contador", async () => {
    await act(async () => { montar({ semGuia: [linhaSemGuia()] }); });

    const painel = painelSemGuia();
    expect(within(painel).getByText(/não há documento nenhum/i)).toBeTruthy();
    // ⚠ A frase que impede as duas filas de virarem "mais do mesmo".
    expect(within(painel).getByText(/quem afirma que o dinheiro/i)).toBeTruthy();
  });

  // ⚠ A afirmação antiga do painel de cima virou MENTIRA no instante em que esta fila passou a
  // existir. Deixá-la mandaria o contador embora convencido de que não há saída, com a saída logo
  // abaixo na mesma tela.
  it("o painel da prova não diz mais que a baixa sem documento 'não existe no sistema'", async () => {
    await act(async () => { montar({ semGuia: [linhaSemGuia()] }); });
    expect(screen.queryByText(/ainda não existe no sistema/i)).toBeNull();
  });

  it("a linha traz prestação, contrato, competência e valor — sem segunda chamada", async () => {
    await act(async () => { montar({ semGuia: [linhaSemGuia()] }); });

    const painel = painelSemGuia();
    expect(within(painel).getByText("2026-07")).toBeTruthy();
    expect(within(painel).getByText(/R\$\s*633,96/)).toBeTruthy();
    expect(within(painel).getByText("OUTRO 2026 — migrado")).toBeTruthy();
    // Uma chamada para a fila inteira: o contrato veio junto de cada linha.
    expect(mockListSemGuia).toHaveBeenCalledTimes(1);
  });
});

describe("ausência nunca é resposta", () => {
  // ⚠ SEÇÃO VAZIA VIRA UMA LINHA (Fase 1) — e a explicação continua ALCANÇÁVEL, num `ℹ` que é um
  // `<button>` de verdade (foco por teclado, clique no toque), não num `title`. O que saiu foi o
  // card inteiro dizendo "não há nada"; o que NÃO saiu é o que "vazia" significa aqui, que nunca
  // foi "tudo pago".
  it("fila vazia DIZ que está vazia, em uma linha", async () => {
    await act(async () => { montar({ semGuia: [] }); });
    const painel = painelSemGuia();
    expect(within(painel).getByText(/Prestações vencidas sem guia/i)).toBeTruthy();
    expect(within(painel).getByText(/nenhuma\./i)).toBeTruthy();
  });

  it("o que 'vazia' significa continua na tela — a um clique, não num title", async () => {
    await act(async () => { montar({ semGuia: [] }); });
    const painel = painelSemGuia();
    expect(within(painel).queryByText(/Nenhuma prestação sem guia venceu até hoje sem baixa/i)).toBeNull();

    await act(async () => {
      fireEvent.click(within(painel).getByRole("button", { name: /O que isto quer dizer/i }));
    });
    expect(within(painel).getByText(/Nenhuma prestação sem guia venceu até hoje sem baixa/i)).toBeTruthy();
    expect(within(painel).getByText(/vão para a fila acima/i)).toBeTruthy();
  });

  // Falha e vazio são o mesmo pixel e significam o oposto — o defeito que derrubou três painéis.
  it("falha ao carregar NÃO vira 'não há nada'", async () => {
    mockListPendentes.mockResolvedValue({ ok: true, parcelas: [] });
    mockListSemGuia.mockRejectedValue(new Error("rede caiu"));
    await act(async () => {
      render(
        <ParcelamentoTab
          companyId="c1"
          parcelamentos={{
            parcelamentos: [contrato], loading: false, error: null,
            load: jest.fn(), listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
          }}
        />,
      );
    });

    expect(screen.getByText(/Não foi possível saber se há prestações sem guia/i)).toBeTruthy();
    expect(screen.getByText(/quer dizer que não há nenhuma/i)).toBeTruthy();
    expect(screen.queryByText(/Nenhuma prestação sem guia venceu/i)).toBeNull();
  });

  // ⚠ DESABILITADO SEM EXPLICAÇÃO É PROIBIDO. E a linha bloqueada CONTINUA na fila: escondê-la
  // faria o contrato parecer em ordem justamente onde ele não está.
  it("linha sem provisão de abertura: desabilitada COM o motivo, e ainda listada", async () => {
    await act(async () => {
      montar({ semGuia: [linhaSemGuia({ podeBaixar: false, motivoBloqueio: "provisao_inexistente" })] });
    });

    const painel = painelSemGuia();
    expect(within(painel).getByRole("button", { name: /Declarar baixa/ }).disabled).toBe(true);
    expect(within(painel).getByText(/provisão de abertura/i)).toBeTruthy();
    expect(within(painel).getByText("2026-07")).toBeTruthy();
  });
});

describe("o ato de consequência", () => {
  it("confirma repetindo os dados, manda o total conferido e a linha SAI da fila", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    mockBaixaManual.mockResolvedValue({ ok: true, resultado: { pagamentoId: "e1" } });
    await act(async () => { montar({ semGuia: [linhaSemGuia()] }); });

    await act(async () => {
      fireEvent.click(within(painelSemGuia()).getByRole("button", { name: /Declarar baixa/ }));
    });
    // Juros DECLARADO — não existe documento de onde lê-lo.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Juros/i), { target: { value: "12,94" } });
    });
    // A prévia mostra o que vai ser gravado ANTES do clique.
    expect(screen.getByText(/Parcelamento a pagar/)).toBeTruthy();

    // ⚠ AS DUAS FRASES SÃO OPOSTAS, E POR ISSO A ASSERÇÃO É EXATA.
    //
    // A tela diz "amortiza o passivo" (o efeito da linha do PRINCIPAL) e, quando há acréscimo,
    // "NÃO amortiza o passivo" (o aviso sobre juros/multa). Um `/amortiza o passivo/` frouxo casa
    // com as duas — foi o que quebrou aqui quando o aviso novo entrou. Pior que quebrar: se um dia
    // a linha do principal sumisse da prévia, o regex frouxo continuaria VERDE por causa da frase
    // que diz o contrário. Cada uma é afirmada por inteiro, e no seu lugar.
    expect(screen.getByText("amortiza o passivo")).toBeTruthy();
    expect(screen.getByText(/NÃO amortiza o passivo/)).toBeTruthy();

    // A fila é recarregada depois da baixa; na segunda leitura a prestação já saiu.
    mockListSemGuia.mockResolvedValue({ ok: true, parcelas: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Declarar e lançar a baixa/ }));
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0][0]).toMatch(/DECLARAÇÃO sua, não um comprovante/);
    expect(mockBaixaManual).toHaveBeenCalledWith("c1", "parc-migrado-60-p1", expect.objectContaining({
      valorJuros: 12.94, valorMulta: 0, totalConferido: 646.9,
    }));
    // A fila ficou vazia — e vazia agora é UMA LINHA, não um card (Fase 1).
    expect(within(painelSemGuia()).getByText(/nenhuma\./i)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  // ⚠ RECUSA NÃO É SUCESSO, E NÃO FECHA O MODAL: fechar apagaria o que foi digitado, e o contador
  // não saberia se lançou ou não.
  it("recusa do servidor fica na tela, com o motivo traduzido", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const err = new Error("");
    err.code = "MES_FECHADO";
    mockBaixaManual.mockRejectedValue(err);
    await act(async () => { montar({ semGuia: [linhaSemGuia()] }); });

    await act(async () => {
      fireEvent.click(within(painelSemGuia()).getByRole("button", { name: /Declarar baixa/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Declarar e lançar a baixa/ }));
    });

    expect(screen.getByText(/Nada foi lançado/)).toBeTruthy();
    expect(screen.getByText(/competência da data do pagamento está FECHADA/i)).toBeTruthy();
    // O modal continua aberto, com o que foi digitado.
    expect(screen.getByRole("dialog")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

// ⚠ A MINA QUE JÁ EXPLODIU DUAS VEZES. `lancando`/`buscando` nascem `null` e a linha sem guia tem
// `guideId: null` — `null === null` é `true`, e TODAS as linhas nasciam anunciando uma ação em voo
// que ninguém disparou (em `ParcelasDoAcordo` eram 60 consultas PAGAS "em andamento"). A fila da
// prova hoje só recebe linhas COM guia, mas isso é garantia de QUERY, não de tipo.
describe("nenhuma linha nasce dizendo que está lançando", () => {
  it("linha com guideId nulo na fila da prova não vira 'Lançando…'", async () => {
    await act(async () => {
      montar({
        pendentes: [{
          guideId: null, parcelaId: "p1", parcelamentoId: "parc-migrado-60", numeroParcela: 1,
          competencia: "2026-05", valor: 1200, comprovante: null, confirmadoEm: null,
        }],
      });
    });

    expect(screen.queryByText("Lançando…")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Dar baixa" }).length).toBeGreaterThan(0);
  });
});
