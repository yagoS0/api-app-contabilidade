import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LotePlanilhaPage } from "../LotePlanilhaPage";

// Transporte HTTP substituído; parsing, ApiError e métodos de realApi são reais.
jest.mock("../../../api", () => ({ api: require("../../../api/real/realApi").createRealApi() }));
jest.mock("../../../api/sessionStore", () => ({
  lerSessao: () => ({ accessToken: "token-isolado" }),
  definirTokens: jest.fn(), limparSessao: jest.fn(),
}));

const empresa = { companyId: "portal-a", razao: "Empresa A", legacyCompany: {} };
const motivo = "Confira a numeração reservada com o contador antes de reenviar.";
const responder = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) });
const pendente = () => { let resolver; const promessa = new Promise(r => { resolver = r; }); return { promessa, resolver }; };
const antigo = (id = "lote-a", status = "concluido") => ({
  id, status, criadoEm: "2026-10-01T13:50:00.000Z",
  linhas: Array.from({ length: 11 }, (_, i) => ({ numeroLinha: i + 2, desfecho: "recusada_receita",
    tomadorNome: `Tomador ${i}`, valorServicos: 100, codigo: "E1235", mensagem: "Recusa histórica",
    tentadaEm: "2026-10-01T13:50:00.000Z", rpsSerie: "1", rpsNumero: String(i + 1) })),
});
const recusa = (lote = antigo()) => ({
  error: "nada_a_retentar", lote,
  retentativa: { quantas: 0, retentaveis: [], bloqueadas: lote.linhas.map(l => ({
    numeroLinha: l.numeroLinha, desfecho: l.desfecho, motivo,
  })) },
});
const leitura = { linhas: [{ numero: 2, estado: "pronta", dados: { servico: { valorServicos: 100 }, tomador: { nome: "Tomador" } } }] };
let loteInicial, planoInicial, respostaRetry, respostaPolling, poll;
const fetchOriginal = global.fetch;

beforeEach(() => {
  loteInicial = antigo(); planoInicial = undefined; respostaRetry = responder(422, recusa()); poll = null;
  respostaPolling = responder(200, { lote: antigo() });
  jest.spyOn(global, "setInterval").mockImplementation(fn => { poll = fn; return 123; });
  jest.spyOn(global, "clearInterval").mockImplementation(() => {});
  global.fetch = jest.fn(async (url, init) => {
    // Nenhum fetch sai do processo, e qualquer endpoint inesperado falha o teste.
    if (url.endsWith("/leitura") && init.method === "POST") return responder(200, leitura);
    if (url.endsWith("/emissao") && init.method === "POST") return responder(200, { reconhecido: true, lote: loteInicial, retentativa: planoInicial });
    if (url.endsWith("/retentar") && init.method === "POST") return respostaRetry;
    if (/\/emissao\/lote-[ab]$/.test(url) && init.method === "GET") return respostaPolling;
    throw new Error(`Endpoint inesperado: ${url}`);
  });
});
afterEach(() => { global.fetch = fetchOriginal; jest.restoreAllMocks(); });

function montar() {
  return render(<StrictMode><LotePlanilhaPage empresa={empresa} /></StrictMode>);
}
async function subir({ bloqueado = false } = {}) {
  fireEvent.change(screen.getByLabelText(/Planilha \(.xlsx\)/), { target: { files: [new File(["fixture"], "atual.xlsx")] } });
  fireEvent.click(await screen.findByRole("button", { name: "Emitir 1 nota" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar e emitir" }));
  if (bloqueado) await screen.findByText("Tomador 0");
  else await screen.findByRole("button", { name: "Tentar emitir 11 notas de novo" });
}
const retentar = () => fireEvent.click(screen.getByRole("button", { name: "Tentar emitir 11 notas de novo" }));
const chamadasRetry = () => global.fetch.mock.calls.filter(([url]) => url.endsWith("/retentar"));

test("422 real substitui snapshot, preserva histórico e mostra motivos sem continuar oferecendo 11 notas", async () => {
  const atual = antigo(); atual.linhas[0].tomadorNome = "Tomador atualizado";
  respostaRetry = responder(422, recusa(atual));
  montar(); await subir(); retentar();
  await screen.findByText("Tomador atualizado");
  expect(screen.queryByRole("button", { name: /Tentar emitir/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(`Recusa histórica · ${motivo}`)).toHaveLength(11);
  expect(document.querySelector('[data-emissao-conta="emitidas"]')).toHaveTextContent("0");
  expect(document.querySelector('[data-emissao-conta="recusadas"]')).toHaveTextContent("11");
  expect(document.querySelector('[data-emissao="reconhecido"]')).toHaveTextContent("nada foi emitido agora");
  expect(document.querySelector('[data-emissao="quando-lote"]')).toHaveTextContent("2026");
  expect(chamadasRetry()).toHaveLength(1);
  expect(chamadasRetry()[0][0]).toMatch(/\/companies\/portal-a\/nfse\/lote\/emissao\/lote-a\/retentar$/);
  expect(chamadasRetry()[0][1].headers.Authorization).toBe("Bearer token-isolado");
});

test.each([
  [403, { error: "forbidden" }],
  [500, recusa()],
])("recusa %s sem snapshot válido preserva evidência anterior", async (status, corpo) => {
  respostaRetry = responder(status, corpo);
  montar(); await subir(); retentar();
  await waitFor(() => expect(screen.getByRole("button", { name: /Tentar emitir 11/ })).toBeEnabled());
  expect(screen.getByText("Tomador 0")).toBeInTheDocument();
  expect(screen.queryByText(motivo)).not.toBeInTheDocument();
  expect(chamadasRetry()).toHaveLength(1);
});

test.each([
  { error: "nada_a_retentar" },
  recusa(antigo("outro-lote")),
  { ...recusa(), lote: { id: "lote-a" } },
])("422 sem detalhes válidos preserva histórico, mas suspende oferta contraditória", async corpo => {
  respostaRetry = responder(422, corpo);
  montar(); await subir(); retentar();
  await screen.findByText(/os detalhes atualizados não foram recebidos/);
  expect(screen.queryByRole("button", { name: /Tentar emitir/ })).not.toBeInTheDocument();
  expect(screen.getByText("Tomador 0")).toBeInTheDocument();
  expect(screen.queryByText(motivo)).not.toBeInTheDocument();
  expect(document.querySelector('[data-emissao-conta="recusadas"]')).toHaveTextContent("11");
  expect(chamadasRetry()).toHaveLength(1);
});

test("reimportação reconhecida aplica plano bloqueado sem chamar retentativa", async () => {
  planoInicial = recusa().retentativa;
  montar(); await subir({ bloqueado: true });
  expect(screen.queryByRole("button", { name: /Tentar emitir/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(`Recusa histórica · ${motivo}`)).toHaveLength(11);
  expect(document.querySelector('[data-emissao="reconhecido"]')).toHaveTextContent("nada foi emitido agora");
  expect(chamadasRetry()).toHaveLength(0);
});

test("polling iniciado depois do 422 atualiza relatório sem revogar restrição", async () => {
  loteInicial = antigo("lote-a", "emitindo");
  respostaRetry = responder(422, recusa(loteInicial));
  montar(); await subir(); retentar();
  await waitFor(() => expect(document.querySelector('[data-emissao="retentar-botao"]')).toBeNull());
  const atualizado = antigo("lote-a", "emitindo");
  atualizado.linhas[0].tomadorNome = "Nome recebido no polling";
  respostaPolling = responder(200, { lote: atualizado });
  await act(async () => { await poll(); });
  expect(screen.getByText("Nome recebido no polling")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Tentar emitir/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(`Recusa histórica · ${motivo}`)).toHaveLength(11);
  expect(chamadasRetry()).toHaveLength(1);
});

test("falha de rede não apaga relatório nem fabrica conclusão", async () => {
  montar(); await subir();
  global.fetch.mockRejectedValueOnce(new Error("offline"));
  retentar();
  await waitFor(() => expect(screen.getByRole("button", { name: /Tentar emitir 11/ })).toBeEnabled());
  expect(document.querySelector('[data-emissao-conta="recusadas"]')).toHaveTextContent("11");
  expect(document.querySelector('[data-emissao="reconhecido"]')).toBeInTheDocument();
});

test("duplo clique faz um POST e sucesso mantém o fluxo existente", async () => {
  const aguardar = pendente(); respostaRetry = aguardar.promessa;
  montar(); await subir();
  const botao = screen.getByRole("button", { name: /Tentar emitir 11/ });
  act(() => { fireEvent.click(botao); fireEvent.click(botao); });
  expect(chamadasRetry()).toHaveLength(1);
  const novo = antigo(); novo.linhas = novo.linhas.map(l => ({ ...l, desfecho: "emitida" }));
  await act(async () => aguardar.resolver(responder(202, { lote: novo })));
  expect(document.querySelector('[data-emissao-conta="emitidas"]')).toHaveTextContent("11");
  expect(document.querySelector('[data-emissao="reconhecido"]')).toBeNull();
});

test.each([422, 202])("resposta tardia %s não atravessa troca de empresa e retorno", async status => {
  const aguardar = pendente(); respostaRetry = aguardar.promessa;
  const tela = montar(); await subir(); retentar();
  tela.rerender(<StrictMode><LotePlanilhaPage empresa={{ ...empresa, companyId: "portal-b" }} /></StrictMode>);
  tela.rerender(<StrictMode><LotePlanilhaPage empresa={empresa} /></StrictMode>);
  await act(async () => aguardar.resolver(responder(status, status === 422 ? recusa() : { lote: antigo() })));
  expect(document.querySelector('[data-emissao="relatorio"]')).toBeNull();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("troca de planilha e operação nova descartam catch e finally antigos", async () => {
  const velha = pendente(); respostaRetry = velha.promessa;
  montar(); await subir(); retentar();
  loteInicial = antigo("lote-b"); await subir();
  const nova = pendente(); respostaRetry = nova.promessa; retentar();
  await act(async () => velha.resolver(responder(422, recusa())));
  expect(document.querySelector('[data-emissao="retentar-botao"]')).toBeDisabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => nova.resolver(responder(422, recusa(antigo("lote-b")))));
  expect(document.querySelector('[data-emissao="retentar-botao"]')).toBeNull();
  expect(screen.getAllByText(`Recusa histórica · ${motivo}`)).toHaveLength(11);
});

test("polling iniciado antes da retentativa não restaura oferta obsoleta após 422", async () => {
  loteInicial = antigo("lote-a", "emitindo");
  const consulta = pendente(); respostaPolling = consulta.promessa;
  montar(); await subir();
  let consultaEmVoo;
  act(() => { consultaEmVoo = poll(); });
  retentar();
  await waitFor(() => expect(document.querySelector('[data-emissao="retentar-botao"]')).toBeNull());
  await act(async () => { consulta.resolver(responder(200, { lote: loteInicial })); await consultaEmVoo; });
  expect(document.querySelector('[data-emissao="retentar-botao"]')).toBeNull();
  expect(screen.getAllByText(`Recusa histórica · ${motivo}`)).toHaveLength(11);
});
