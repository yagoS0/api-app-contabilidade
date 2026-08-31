// ⚠⚠ A DATA DO PAGAMENTO É DIGITADA, NUNCA DEDUZIDA — a ligação (30/08/2026)
//
// > Dono: *"ao clicar em confirmar pagamento, o pagamento foi posto no dia 30 de agosto mesmo não
// > sendo verdade."*
//
// `Guide.paymentConfirmedAt` é **o dia em que o dinheiro saiu**, e é dele que o fluxo tira o mês e o
// dia da linha. O servidor gravava o instante do CLIQUE. Medido antes do conserto: das 20 guias
// pagas com comprovante do SERPRO guardado, **20** divergiam da data real de arrecadação.
//
// ⚠⚠ ESTE TESTE É DE LIGAÇÃO porque o defeito era de ligação: a regra da data existe e tem suíte
// própria na api; o que faltava era a TELA perguntar. Um teste de unidade da regra continuaria
// verde com o botão gravando o relógio.
//
// ⚠ NENHUM TESTE TOCA A REDE.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { GuiasPage } from "../GuiasPage";

const EMPRESA = { companyId: "pc-001", razao: "ACME SERVICOS LTDA", cnpj: "11222333000181", myRole: "OWNER" };

const GUIA_EM_ABERTO = {
  liberadaCliente: true,
  guideId: "g1",
  tipo: "SIMPLES",
  competencia: "2026-06",
  valor: 3422,
  vencimento: "2026-07-20T00:00:00.000Z",
  paymentStatus: "OPEN",
  paymentConfirmedAt: null,
  // ⚠ É o servidor que decide se o botão pode aparecer; a tela só o lê.
  canConfirmPayment: true,
  linhaDigitavelSituacao: "NAO_TENTADA",
};

let originais;
beforeEach(() => {
  originais = { getGuides: api.getGuides, confirmar: api.confirmarPagamentoDaGuia, fetch: global.fetch };
  global.fetch = jest.fn(() => { throw new Error("⚠ nenhum teste desta suíte pode tocar a rede"); });
});
afterEach(() => {
  api.getGuides = originais.getGuides;
  api.confirmarPagamentoDaGuia = originais.confirmar;
  global.fetch = originais.fetch;
});

async function montar() {
  api.getGuides = jest.fn(async () => ({ data: [GUIA_EM_ABERTO], page: 1, limit: 25, total: 1 }));
  api.confirmarPagamentoDaGuia = jest.fn(async () => ({ ok: true, aviso: "Registramos que você pagou." }));
  render(<GuiasPage empresa={EMPRESA} competencia="2026-06" aoTrocarCompetencia={() => {}} />);
  await waitFor(() => expect(api.getGuides).toHaveBeenCalled());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Já paguei" })); });
}

describe("⚠⚠ confirmar pagamento pede o DIA em que pagou", () => {
  it("a caixa abre com o campo de data VAZIO", async () => {
    // ⚠⚠ Um padrão de "hoje" seria aceito com um clique — e a tela voltaria a gravar o dia do
    // clique, agora com a aparência de ter sido conferido. É a mesma regra que o lote carrega para
    // o município do tomador.
    await montar();
    const campo = screen.getByLabelText(/Em que dia você pagou/i);
    expect(campo).toHaveValue("");
    expect(campo.getAttribute("type")).toBe("date");
  });

  it("⚠⚠ sem data o botão NÃO envia — e diz o que falta", async () => {
    await montar();
    const botao = screen.getByRole("button", { name: /Já paguei esta guia/i });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/dia em que você pagou/i);
    await act(async () => { fireEvent.click(botao); });
    expect(api.confirmarPagamentoDaGuia).not.toHaveBeenCalled();
  });

  it("⚠⚠ a data digitada VIAJA — e é ela, não o relógio", async () => {
    await montar();
    fireEvent.change(screen.getByLabelText(/Em que dia você pagou/i), { target: { value: "2026-07-14" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Já paguei esta guia/i }));
    });
    expect(api.confirmarPagamentoDaGuia).toHaveBeenCalledWith("pc-001", "g1", { pagoEm: "2026-07-14" });
  });

  it("⚠⚠ o `max` é o dia LOCAL, não o UTC — o teste antigo codificava o próprio defeito", async () => {
    // O `max` é conforto; a recusa nomeada continua existindo na api, porque regra que só mora na
    // tela não protege dado nenhum.
    //
    // ⚠⚠ ESTE CASO NASCEU ERRADO E FOI CONSERTADO NO MESMO DIA. Ele comparava contra
    // `new Date().toISOString().slice(0, 10)` — a MESMA expressão que a tela usava —, então passava
    // com as duas pontas erradas. Achado no NAVEGADOR: às 21h de Brasília (UTC−3) o `max` saiu
    // `2026-08-31` num dia **30**, e o campo passou a aceitar amanhã.
    // ⚠ Comparar teste e código pela mesma expressão não é teste: é um espelho.
    await montar();
    const agora = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const hojeLocal = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
    expect(screen.getByLabelText(/Em que dia você pagou/i).getAttribute("max")).toBe(hojeLocal);
  });

  it("⚠⚠ `hojeNoCampoDeData` não desloca em NENHUMA hora do dia — inclusive às 23h", async () => {
    // A prova direta da regra, sem depender de que horas a suíte roda.
    const { hojeNoCampoDeData } = require("../../../lib/format");
    // 30/08/2026 às 23h no fuso LOCAL do runner. Em UTC−3 isso é 31/08 em UTC.
    const noiteDe30 = new Date(2026, 7, 30, 23, 30);
    expect(hojeNoCampoDeData(noiteDe30)).toBe("2026-08-30");
    // E na primeira hora do dia, o outro lado da armadilha.
    expect(hojeNoCampoDeData(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});
