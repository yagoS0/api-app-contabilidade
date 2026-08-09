// A LIGAÇÃO entre a regra de tela (`lib/parcelaBusca.js`, com teste próprio) e a linha da parcela.
//
// ⚠ Esta tela vai ser exercida contra o SERPRO real, com dinheiro do outro lado. O que este arquivo
// cobre é justamente o que a regra sozinha não garante: que o motivo do bloqueio CHEGA ao `title`
// do botão, que "não localizado" aparece com aparência diferente de falha, e que cada recusa paga
// vira texto na tela em vez de sumir num `catch`.
//
// Não repete a aritmética da regra — isso é do teste da lib.

import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ParcelasDoAcordo } from "../ParcelasDoAcordo.jsx";

const guia = (over = {}) => ({
  id: "g1", numeroParcela: 1, valor: 1200, paymentStatus: "OPEN", baixada: false,
  competencia: "2026-06", vencimento: "2026-06-20T00:00:00.000Z",
  numeroDocumento: "07202600001001", comprovante: null,
  serproLastCheckedAt: null, serproLastCheckResult: null,
  ...over,
});

function acordo(guides) {
  return {
    id: "parc1", label: "PARCSN 2026", numParcelas: 12,
    guides,
    parcelasContratadas: guides.map((g) => ({
      id: `p${g.numeroParcela}`, numeroParcela: g.numeroParcela,
      vencimento: g.vencimento, guia: { id: g.id },
    })),
  };
}

function montar({ guides = [guia()], onBuscar = jest.fn(), onBuscou = jest.fn() } = {}) {
  render(<ParcelasDoAcordo parcelamento={acordo(guides)} onBuscar={onBuscar} onBuscou={onBuscou} />);
  fireEvent.click(screen.getByRole("button", { name: /Parcelas \(/ }));
  return { onBuscar, onBuscou };
}

const botoesBusca = () => screen.getAllByRole("button", { name: /Buscar pagamento/ });

describe("o botão vive na LINHA da parcela", () => {
  it("uma linha por prestação, cada uma com seu botão", () => {
    montar({ guides: [guia({ id: "g1", numeroParcela: 1 }), guia({ id: "g2", numeroParcela: 2 })] });
    expect(botoesBusca()).toHaveLength(2);
  });

  it("o bloco começa RECOLHIDO — a lista de parcelas não invade o card", () => {
    render(<ParcelasDoAcordo parcelamento={acordo([guia()])} onBuscar={jest.fn()} onBuscou={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /Buscar pagamento/ })).toBeNull();
  });
});

// ⚠ INCIDENTE DE PRODUÇÃO (e1ec3a8e). Um contrato de 60 prestações SEM GUIA abria com as 60 linhas
// dizendo "Buscando…" sem ninguém ter clicado: `buscando` nasce `null`, a prestação sem guia tem
// `guideId: null`, e `buscando === linha.guideId` era `null === null` = **true**. A tela afirmava
// que 60 consultas PAGAS estavam em voo, num botão que nem chamada faz.
describe("nada está 'Buscando…' antes de alguém clicar", () => {
  function semGuia(quantas, formaPagamento = null) {
    render(
      <ParcelasDoAcordo
        parcelamento={{
          id: "parc1", label: "OUTRO 3", numParcelas: quantas, formaPagamento, guides: [],
          parcelasContratadas: Array.from({ length: quantas }, (_, i) => ({
            id: `p${i + 1}`, numeroParcela: i + 1, vencimento: null, guia: null,
          })),
        }}
        onBuscar={jest.fn()}
        onBuscou={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Parcelas \(/ }));
  }

  it("60 prestações sem guia: nenhuma diz 'Buscando…'", () => {
    semGuia(60);
    expect(screen.queryByRole("button", { name: /Buscando/ })).toBeNull();
    expect(botoesBusca()).toHaveLength(60);
  });

  it("e todas nascem desabilitadas, com o motivo à vista", () => {
    semGuia(60);
    for (const btn of botoesBusca()) expect(btn).toBeDisabled();
    expect(screen.getByText(/não tem guia capturada/i)).toBeTruthy();
  });

  // ⚠ O motivo aparece UMA vez para o grupo — não 60 — e a contagem diz a quantas vale.
  it("o parágrafo do motivo não se repete 60 vezes", () => {
    semGuia(60);
    expect(screen.getAllByText(/não tem guia capturada/i)).toHaveLength(1);
    expect(screen.getByText(/Todas as 60 prestações/)).toBeTruthy();
  });

  // A correção de premissa do dono: em débito automático a guia NÃO vai chegar, e a tela não pode
  // mandar esperá-la.
  it("débito automático não manda esperar captura nem upload", () => {
    semGuia(3, "DEBITO_AUTOMATICO");
    expect(screen.getByText(/não vai existir/i)).toBeTruthy();
    expect(screen.queryByText(/captura do SERPRO ou por upload/i)).toBeNull();
  });
});

describe("desabilitado NUNCA sem explicação", () => {
  it("sem numeroDocumento: desabilitado, com o motivo no title E visível na linha", () => {
    montar({ guides: [guia({ numeroDocumento: null })] });
    const btn = botoesBusca()[0];
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/número de documento/i);
    // O `title` não existe em toque — o motivo também fica escrito.
    expect(screen.getByText(/não tem número de documento/i)).toBeTruthy();
  });

  it("parcela já paga: desabilitada apontando o próximo passo (lançar a baixa)", () => {
    montar({ guides: [guia({ paymentStatus: "PAID" })] });
    expect(botoesBusca()[0]).toBeDisabled();
    expect(screen.getByText(/Falta só lançar a baixa/i)).toBeTruthy();
  });

  it("com documento e em aberto: habilitado, e o title avisa que a chamada é PAGA", () => {
    montar();
    const btn = botoesBusca()[0];
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/PAGA/);
  });
});

describe("o clique não é gratuito nem silencioso", () => {
  afterEach(() => { window.confirm.mockRestore?.(); });

  it("confirma repetindo documento e valor ANTES de gastar a chamada", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const { onBuscar } = montar({ onBuscar: jest.fn(async () => ({ ok: true, encontrado: false, motivo: "x" })) });
    await act(async () => { fireEvent.click(botoesBusca()[0]); });
    const texto = window.confirm.mock.calls[0][0];
    expect(texto).toContain("07202600001001");
    expect(texto).toContain("1.200,00");
    expect(texto).toMatch(/PAGA/);
    expect(onBuscar).toHaveBeenCalledWith("g1");
  });

  it("recusar a confirmação NÃO chama a API", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(false);
    const { onBuscar } = montar();
    await act(async () => { fireEvent.click(botoesBusca()[0]); });
    expect(onBuscar).not.toHaveBeenCalled();
  });
});

// ⚠ O estado de "em voo" é POR LINHA. Clicar numa parcela não pode fazer as outras 59 afirmarem
// que também estão consultando o SERPRO — cada consulta é paga, e a tela é o único lugar onde o
// contador vê quantas saíram.
describe("clicar numa linha não muda o rótulo das outras", () => {
  afterEach(() => { window.confirm.mockRestore?.(); });

  it("só a linha clicada diz 'Buscando…'", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    let liberar;
    const onBuscar = jest.fn(() => new Promise((resolve) => { liberar = () => resolve({ ok: true, encontrado: false }); }));
    montar({
      guides: [guia({ id: "g1", numeroParcela: 1 }), guia({ id: "g2", numeroParcela: 2 }), guia({ id: "g3", numeroParcela: 3 })],
      onBuscar,
    });

    await act(async () => { fireEvent.click(botoesBusca()[0]); });

    expect(screen.getAllByRole("button", { name: /Buscando/ })).toHaveLength(1);
    expect(botoesBusca()).toHaveLength(2);      // as outras duas mantêm o rótulo

    await act(async () => { liberar(); });
    expect(screen.queryByRole("button", { name: /Buscando/ })).toBeNull();
  });
});

describe("cada desfecho chega à tela", () => {
  beforeEach(() => { jest.spyOn(window, "confirm").mockReturnValue(true); });
  afterEach(() => { window.confirm.mockRestore?.(); });

  async function clicar(resposta) {
    const onBuscou = jest.fn();
    const onBuscar = jest.fn(async () => {
      if (resposta instanceof Error) throw resposta;
      return resposta;
    });
    montar({ onBuscar, onBuscou });
    await act(async () => { fireEvent.click(botoesBusca()[0]); });
    return { onBuscou, status: screen.getByRole("status") };
  }

  it("pagamento localizado: aparece e RECARREGA o que mudou", async () => {
    const { onBuscou, status } = await clicar({
      ok: true, encontrado: true,
      comprovante: { dataArrecadacao: "13/07/2026", total: 193.03 },
    });
    expect(within(status).getByText(/Pagamento localizado/)).toBeTruthy();
    expect(status.textContent).toContain("13/07/2026");
    expect(onBuscou).toHaveBeenCalled();
  });

  // ⚠ A distinção que o dono pediu: "não localizado" não é falha.
  it("não localizado: texto próprio, sem recarregar, e VISUALMENTE distinto de erro", async () => {
    const naoLoc = await clicar({ ok: true, encontrado: false, motivo: "Pagamento ainda não localizado no SERPRO." });
    expect(naoLoc.status.textContent).toContain("ainda não localizado");
    expect(naoLoc.onBuscou).not.toHaveBeenCalled();
    const corNaoLocalizado = naoLoc.status.style.borderColor || naoLoc.status.getAttribute("style");

    document.body.innerHTML = "";
    const erro = Object.assign(new Error("socket hang up"), { code: "PAGTOWEB_FALHOU" });
    const falha = await clicar(erro);
    const corFalha = falha.status.style.borderColor || falha.status.getAttribute("style");
    expect(corFalha).not.toBe(corNaoLocalizado);
  });

  it.each([
    ["SERPRO_CHAMADA_REPETIDA", "Aguarde 247s", /repetida/i],
    ["SERPRO_TETO_DIARIO", "teto 60", /teto diário/i],
    ["SERPRO_TETO_MENSAL_ESCRITORIO", "teto 1240", /teto mensal/i],
  ])("recusa %s chega à tela com título próprio e a mensagem do servidor", async (code, mensagem, titulo) => {
    const { status, onBuscou } = await clicar(Object.assign(new Error(mensagem), { code }));
    expect(status.textContent).toMatch(titulo);
    expect(status.textContent).toContain(mensagem);
    expect(onBuscou).not.toHaveBeenCalled();
  });

  // A integração desligada é o caso em que a "mensagem do servidor" é o próprio código — a tela
  // mostra a explicação, e ela nomeia a flag que o dono precisa ligar no ambiente.
  it("integração PAGTOWEB desligada explica em vez de repetir o código", async () => {
    const { status } = await clicar(
      Object.assign(new Error("serpro_pagtoweb_disabled"), { code: "SERPRO_PAGTOWEB_DISABLED" }),
    );
    expect(status.textContent).toMatch(/desligada/i);
    expect(status.textContent).toContain("INTEGRACAO_SERPRO_PAGTOWEB");
  });

  it("erro sem código ainda diz alguma coisa", async () => {
    const { status } = await clicar(new Error(""));
    expect(status.textContent).toMatch(/não disse por quê/i);
  });
});
