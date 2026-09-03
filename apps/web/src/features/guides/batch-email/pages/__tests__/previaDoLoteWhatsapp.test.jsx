// O LOTE POR WHATSAPP NA PÁGINA DE ENVIO EM LOTE — a prévia vem ANTES, e nada sai sem conferência.
//
// A corrente inteira, de baixo para cima:
//   `BatchEmailPage`  chama  `whatsapp.prever({competencia, portalClientIds})` no clique
//   `useLoteWhatsapp` chama  `api.preverLoteWhatsapp(...)` — e NÃO chama `executarLoteWhatsapp`
//   o botão "Confirmar"  chama  `whatsapp.executar()` → `api.executarLoteWhatsapp({ conferencia })`
//
// ⚠ As invariantes:
//   1. o primeiro clique NÃO envia — só monta a prévia;
//   2. a `conferencia` enviada é EXATAMENTE o resumo da prévia (não uma recontagem da tela);
//   3. quem cai para e-mail aparece POR MOTIVO, com rótulo — nada some;
//   4. com "Todas pendentes" o botão fica DESABILITADO com o motivo, nunca some;
//   5. canal indisponível: a frase aparece uma vez, o botão desabilita com o mesmo motivo.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BatchEmailPage } from "../renderBatchEmailPage.jsx";
import { useLoteWhatsapp } from "../../hooks/useLoteWhatsapp";

function linha(over = {}) {
  return {
    portalClientId: "c1", razao: "ACME LTDA", cnpj: "11.111.111/0001-11", regimeTributario: "SIMPLES", competencia: "2026-07",
    tiposGuias: { DAS: { guideId: "g1", valor: 500 }, INSS: null, IRPJ: null, CSLL: null, PIS_COFINS: null, ISS: null, FGTS: null, PARC_DAS: null },
    pendingGuideIds: ["g1"],
    ...over,
  };
}

const REPORT = {
  competencia: "2026-07",
  competenciasPresentes: ["2026-07"],
  simples: [linha(), linha({ portalClientId: "c2", razao: "BETA LTDA", tiposGuias: { DAS: { guideId: "g2", valor: 300 } } })],
  presumidos: [],
  outros: [],
};

const PREVIA = {
  ok: true, competencia: "2026-07", canal: { disponivel: true },
  resumo: { total: 2, porWhatsapp: 1, porEmail: 1, jaEnviadas: 0 },
  linhas: [
    { guideId: "g1", portalClientId: "c1", empresa: "ACME LTDA", tipo: "SIMPLES", tipoLabel: "DAS", canalSugerido: "WHATSAPP", motivo: null, contatoNome: "Maria" },
    { guideId: "g2", portalClientId: "c2", empresa: "BETA LTDA", tipo: "SIMPLES", tipoLabel: "DAS", canalSugerido: "EMAIL", motivo: "SEM_OPT_IN" },
  ],
};

function apiFalso(over = {}) {
  return {
    getCanalWhatsapp: jest.fn(async () => ({ ok: true, canal: { disponivel: true } })),
    preverLoteWhatsapp: jest.fn(async () => PREVIA),
    executarLoteWhatsapp: jest.fn(async () => ({
      ok: true, competencia: "2026-07", resumo: PREVIA.resumo,
      whatsapp: { total: 1, enviadas: 1, jaEnviadas: 0, falhas: [], resultados: [] },
      email: { total: 1, guideIds: ["g2"], executado: true, enviadas: 1, erros: 0 },
    })),
    ...over,
  };
}

function Ponte({ api, competenciaInicial }) {
  const whatsapp = useLoteWhatsapp({ api, feedback: { notifyError: jest.fn() } });
  return (
    <BatchEmailPage report={REPORT} loading={false} sending={false} onBack={() => {}} onLoad={jest.fn()} onSend={jest.fn()} whatsapp={whatsapp} />
  );
}

async function montar(api = apiFalso()) {
  const utils = render(<Ponte api={api} />);
  await waitFor(() => expect(api.getCanalWhatsapp).toHaveBeenCalled());
  // A página nasce no mês anterior ao de hoje; a matriz de teste é de 2026-07. A competência é
  // escolhida explicitamente — o teste não pode depender do relógio.
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-07" } });
  return { ...utils, api };
}

function selecionarTodas() {
  // A caixa do cabeçalho da seção Simples — pelo `title`, não pela posição: a primeira caixa da
  // página é o filtro "Só empresas com pendências".
  fireEvent.click(screen.getAllByTitle("Selecionar todas com pendência")[0]);
}

describe("o botão", () => {
  it("sem seleção fica desabilitado com o motivo; com seleção e competência única, habilita", async () => {
    await montar();
    const botao = screen.getByRole("button", { name: /Enviar por WhatsApp \(0\)/ });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/Selecione ao menos uma empresa/);
    selecionarTodas();
    expect(screen.getByRole("button", { name: /Enviar por WhatsApp \(2\)/ })).toBeEnabled();
  });

  it("⚠ 'Todas pendentes' desabilita com o motivo — o botão NÃO some", async () => {
    await montar();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    const botao = screen.getByRole("button", { name: /Enviar por WhatsApp/ });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/UMA competência/);
  });

  it("canal indisponível: a frase aparece e o botão desabilita com a MESMA mensagem", async () => {
    const api = apiFalso({ getCanalWhatsapp: jest.fn(async () => ({ ok: true, canal: { disponivel: false, motivo: "TEMPLATE_NAO_APROVADO", mensagem: "O template ainda não está aprovado na Meta." } })) });
    await montar(api);
    await waitFor(() => expect(screen.getByTestId("canal-whatsapp-indisponivel")).toHaveTextContent(/ainda não está aprovado/));
    selecionarTodas();
    const botao = screen.getByRole("button", { name: /Enviar por WhatsApp/ });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/ainda não está aprovado/);
  });
});

describe("a prévia vem antes, e a confirmação repete os números", () => {
  it("⚠ o primeiro clique só monta a prévia — `executarLoteWhatsapp` NÃO é chamado", async () => {
    const { api } = await montar();
    selecionarTodas();
    fireEvent.click(screen.getByRole("button", { name: /Enviar por WhatsApp \(2\)/ }));
    await waitFor(() => expect(api.preverLoteWhatsapp).toHaveBeenCalledWith({ competencia: "2026-07", portalClientIds: ["c1", "c2"] }));
    expect(api.executarLoteWhatsapp).not.toHaveBeenCalled();
    const previa = await screen.findByTestId("previa-whatsapp");
    expect(previa).toHaveTextContent(/1.*por WhatsApp/);
    expect(within(previa).getByTestId("previa-zap-g1")).toHaveTextContent(/ACME LTDA — DAS → Maria/);
    // Quem cai para e-mail aparece POR MOTIVO, com rótulo — nada some.
    expect(within(previa).getByTestId("previa-email-SEM_OPT_IN")).toHaveTextContent(/contato sem opt-in \(1\)/);
    expect(within(previa).getByTestId("previa-email-SEM_OPT_IN")).toHaveTextContent(/BETA LTDA/);
  });

  it("⚠ confirmar manda a `conferencia` EXATAMENTE como a prévia devolveu, e mostra o resultado", async () => {
    const { api } = await montar();
    selecionarTodas();
    fireEvent.click(screen.getByRole("button", { name: /Enviar por WhatsApp \(2\)/ }));
    const previa = await screen.findByTestId("previa-whatsapp");
    fireEvent.click(within(previa).getByRole("button", { name: /Confirmar: 1 por WhatsApp · 1 por e-mail/ }));
    await waitFor(() => expect(api.executarLoteWhatsapp).toHaveBeenCalledTimes(1));
    expect(api.executarLoteWhatsapp.mock.calls[0][0]).toEqual({
      competencia: "2026-07", portalClientIds: ["c1", "c2"],
      conferencia: { total: 2, porWhatsapp: 1, porEmail: 1 },
      enviarPorEmail: true,
    });
    const resultado = await screen.findByTestId("resultado-whatsapp");
    expect(resultado).toHaveTextContent(/1.*de 1 enviada/);
    expect(screen.queryByTestId("previa-whatsapp")).toBeNull();
  });

  it("cancelar descarta a prévia sem chamar nada", async () => {
    const { api } = await montar();
    selecionarTodas();
    fireEvent.click(screen.getByRole("button", { name: /Enviar por WhatsApp \(2\)/ }));
    const previa = await screen.findByTestId("previa-whatsapp");
    fireEvent.click(within(previa).getByRole("button", { name: /Cancelar/ }));
    await waitFor(() => expect(screen.queryByTestId("previa-whatsapp")).toBeNull());
    expect(api.executarLoteWhatsapp).not.toHaveBeenCalled();
  });

  it("⚠ 409 CONFERENCIA_DIVERGENTE descarta a prévia e diz para conferir de novo", async () => {
    const api = apiFalso({ executarLoteWhatsapp: jest.fn(async () => { const e = new Error("Os números conferidos não batem com a prévia atual."); e.status = 409; e.code = "CONFERENCIA_DIVERGENTE"; throw e; }) });
    await montar(api);
    selecionarTodas();
    fireEvent.click(screen.getByRole("button", { name: /Enviar por WhatsApp \(2\)/ }));
    const previa = await screen.findByTestId("previa-whatsapp");
    fireEvent.click(within(previa).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(screen.queryByTestId("previa-whatsapp")).toBeNull());
    expect(screen.getByText(/não batem com a prévia atual/)).toBeInTheDocument();
  });
});

describe("a célula lê o canal", () => {
  it("guia enviada por WhatsApp aparece como enviada (com o canal) e a linha deixa de ser selecionável", async () => {
    const report = {
      ...REPORT,
      simples: [linha({ tiposGuias: { DAS: { guideId: "g1", valor: 500, enviada: true, canalEnvio: "WHATSAPP", envioStatus: "lido", emailStatus: "PENDING" } } })],
    };
    render(<BatchEmailPage report={report} loading={false} sending={false} onBack={() => {}} onLoad={jest.fn()} onSend={jest.fn()} />);
    // Com "só pendentes" ligado a linha nem aparece — ela não tem nada enviável.
    expect(screen.queryByText(/ACME LTDA/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Só empresas com pendências/));
    expect(screen.getByText(/✓ enviado \(WhatsApp\)/)).toBeInTheDocument();
  });

  it("WhatsApp falhou sem e-mail em ERROR: célula própria com o motivo traduzido no título", async () => {
    const report = {
      ...REPORT,
      simples: [linha({ tiposGuias: { DAS: { guideId: "g1", valor: 500, enviada: false, falhou: true, canalEnvio: "WHATSAPP", envioStatus: "falhou", envioErro: "contato sem opt-in", emailStatus: "PENDING" } } })],
    };
    render(<BatchEmailPage report={report} loading={false} sending={false} onBack={() => {}} onLoad={jest.fn()} onSend={jest.fn()} />);
    const celula = screen.getByText(/✖ falhou \(WhatsApp\)/);
    expect(celula.getAttribute("title")).toMatch(/contato sem opt-in/);
    expect(celula.getAttribute("title")).toMatch(/nada tentará de novo sozinho/);
  });
});
