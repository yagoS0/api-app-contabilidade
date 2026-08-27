// O PAINEL DE RECORRÊNCIAS — a regra chegando à tela.
//
// ⚠ A REGRA tem teste próprio (`../../lib/__tests__/recorrenciaTela.test.js`). O que se prende aqui
// é o que só se vê montando: que o painel SOME quando não há decisão esperando, que o valor nunca
// aparece sem a faixa, que a declaração é CONFRONTADA, e que o corpo do POST leva a evidência.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockGet = jest.fn();
const mockMarcar = jest.fn();

// ⚠ O `jest.mock` é HOISTED e o componente chama `createApiClient()` no CORPO do módulo — antes de
// os `const` acima existirem. Por isso a fábrica DELEGA na chamada, que acontece depois.
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getRecorrencias: (...a) => mockGet(...a),
    postMarcarRecorrencia: (...a) => mockMarcar(...a),
  }),
}));

const { PainelDeRecorrencias } = require("../PainelDeRecorrencias");

const serie = (extra = {}) => ({
  id: null,
  lado: "DESPESA",
  chave: "98765432000155",
  contraparteDoc: "98765432000155",
  rotulo: "ANTHROPIC PBC",
  periodicidade: "MENSAL",
  estado: null,
  origem: null,
  valorDeclarado: null,
  leitura: "sugere_entrada",
  valorProjetado: 130,
  base: { n: 3, min: 120, max: 140, cv: 0.08 },
  entraNoFluxo: false,
  declaradoEm: null,
  ...extra,
});

const resposta = (extra = {}) => ({
  ok: true, cicloAtual: "2026-08", indisponivel: false, series: [serie()], foraDoAlcance: [], ...extra,
});

function montar(props = {}) {
  return render(<PainelDeRecorrencias companyId="emp-1" podeEscrever={props.podeEscrever ?? true} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(resposta());
  mockMarcar.mockResolvedValue({ ok: true });
});

describe("⚠⚠ o painel some sozinho quando não há nada a decidir", () => {
  it("sem série pedindo resposta, ele NÃO renderiza", async () => {
    mockGet.mockResolvedValue(resposta({ series: [serie({ leitura: "poucas_observacoes" })] }));
    const { container } = montar();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toMatch(/Recorrências/));
  });

  it("⚠ mas ele APARECE quando algo pede decisão", async () => {
    montar();
    expect(await screen.findByText("Recorrências")).toBeInTheDocument();
  });

  it("⚠ e aparece também quando há algo FORA do alcance — a limitação não some junto", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [serie({ leitura: "poucas_observacoes" })],
      foraDoAlcance: [{ motivo: "chave_de_descricao_carrega_data", frase: "…memo do banco…", quantos: 9 }],
    }));
    montar();
    expect(await screen.findByText("Recorrências")).toBeInTheDocument();
    expect(screen.getByText(/9/)).toBeInTheDocument();
  });
});

describe("⚠⚠ o que o painel diz antes de qualquer número", () => {
  it("ele SUGERE — e diz que não marca nada sozinho", async () => {
    montar();
    await screen.findByText("Recorrências");
    expect(screen.getByText(/não marca nada\s*sozinho/i)).toBeInTheDocument();
  });

  it("⚠⚠ e a palavra PREVISTO está no TEXTO, não só na cor", async () => {
    // Impressão e daltonismo: cor não pode ser a única marca de que a linha é projeção.
    montar();
    await screen.findByText("Recorrências");
    expect(screen.getAllByText(/previsto/i).length).toBeGreaterThan(0);
  });
});

describe("⚠⚠ o valor nunca aparece sem a faixa", () => {
  it("o ponto vem com o intervalo observado", async () => {
    montar();
    const linha = (await screen.findByText("ANTHROPIC PBC")).closest("div").parentElement;
    expect(within(linha).getByText(/≈/)).toBeInTheDocument();
    expect(within(linha).getByText(/entre/)).toBeInTheDocument();
  });

  it("⚠⚠ sem valor projetado, a tela diz ISSO — nunca 'R$ 0,00'", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [serie({ estado: "ATIVA", leitura: "sem_observacao", valorProjetado: null, base: { n: 0 } })],
    }));
    montar();
    expect(await screen.findByText(/sem valor projetado/i)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
  });

  it("⚠ a evidência (`n`) sai no TEXTO", async () => {
    montar();
    expect(await screen.findByText(/3 observações/)).toBeInTheDocument();
  });
});

describe("⚠⚠ DECLARADA e DETECTADA não se parecem", () => {
  const declarada = (extra = {}) => serie({
    id: "s-3", origem: "DECLARADA", estado: "PENDENTE", valorDeclarado: "1200.00",
    rotulo: "Anuidade do Conselho", periodicidade: "ANUAL",
    declaradoEm: "2026-08-10T12:00:00.000Z", ...extra,
  });

  it("a declarada mostra QUEM afirmou e QUANDO, e não a evidência", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [declarada({ leitura: "poucas_observacoes", valorProjetado: null, base: { n: 0 } })],
    }));
    montar();
    expect(await screen.findByText(/Declarada em 10\/08\/2026/)).toBeInTheDocument();
  });

  it("⚠⚠ declaração SEM observação é CONFRONTADA — senão o fluxo projeta dinheiro que não sai", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [declarada({ leitura: "poucas_observacoes", valorProjetado: null, base: { n: 0 } })],
    }));
    montar();
    const alerta = await screen.findByText(/não localizamos nenhuma observação/i);
    expect(alerta).toBeInTheDocument();
    expect(alerta.textContent).toMatch(/1\.200,00/);
  });

  it("⚠⚠ divergindo, os DOIS números aparecem e a tela diz quem vence", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [declarada({ valorDeclarado: "1000.00", valorProjetado: 1180, base: { n: 3, min: 900, max: 1400 } })],
    }));
    montar();
    const alerta = await screen.findByText(/observado vence/i);
    expect(alerta.textContent).toMatch(/1\.000,00/);
    expect(alerta.textContent).toMatch(/1\.180,00/);
  });
});

describe("⚠⚠ o corpo do POST", () => {
  it("leva a EVIDÊNCIA que o contador viu, e o estado do MAPA", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Usar no fluxo/i }));
    // ⚠ A confirmação REPETE os dados — "tem certeza?" não é confirmação.
    const modal = await screen.findByRole("dialog");
    fireEvent.click(within(modal).getByRole("button", { name: /^Usar no fluxo$/i }));

    await waitFor(() => expect(mockMarcar).toHaveBeenCalled());
    expect(mockMarcar).toHaveBeenCalledWith("emp-1", expect.objectContaining({
      lado: "DESPESA",
      chave: "98765432000155",
      estado: "ATIVA",
      baseDaObservacao: { n: 3, min: 120, max: 140, cv: 0.08 },
    }));
  });

  it("⚠⚠ recusar grava RECUSADA, nunca PENDENTE — a tela do contador É a palavra dele", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Não é recorrente/i }));
    const modal = await screen.findByRole("dialog");
    fireEvent.click(within(modal).getByRole("button", { name: /^Não é recorrente$/i }));
    await waitFor(() => expect(mockMarcar).toHaveBeenCalled());
    expect(mockMarcar.mock.calls[0][1].estado).toBe("RECUSADA");
  });

  it("⚠ a recusa do SERVIDOR aparece DENTRO do modal — atrás do overlay ela seria invisível", async () => {
    mockMarcar.mockRejectedValue(new Error("A tabela de recorrências ainda não existe neste banco."));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Usar no fluxo/i }));
    const modal = await screen.findByRole("dialog");
    fireEvent.click(within(modal).getByRole("button", { name: /^Usar no fluxo$/i }));
    await waitFor(() => expect(within(modal).getByText(/ainda não existe/i)).toBeInTheDocument());
  });

  it("⚠ a lista recarrega depois de gravar", async () => {
    montar();
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Usar no fluxo/i }));
    const modal = await screen.findByRole("dialog");
    fireEvent.click(within(modal).getByRole("button", { name: /^Usar no fluxo$/i }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});

describe("⚠ o pré-voo chega à tela", () => {
  it("⚠⚠ sem a tabela, o botão fica DESABILITADO com o motivo — e a leitura continua valendo", async () => {
    mockGet.mockResolvedValue(resposta({ indisponivel: true }));
    montar();
    const botao = await screen.findByRole("button", { name: /Usar no fluxo/i });
    expect(botao).toBeDisabled();
    expect(screen.getAllByText(/migration não foi aplicada/i).length).toBeGreaterThan(0);
    // ⚠ E a série continua na tela: o detector é puro e não depende da tabela.
    expect(screen.getByText("ANTHROPIC PBC")).toBeInTheDocument();
  });

  it("⚠ quem não pode escrever vê o botão, desabilitado, com o motivo", async () => {
    montar({ podeEscrever: false });
    const botao = await screen.findByRole("button", { name: /Usar no fluxo/i });
    expect(botao).toBeDisabled();
    expect(screen.getByText(/não pode marcar recorrências/i)).toBeInTheDocument();
  });

  it("⚠⚠ série sem valor nenhum não pode ser confirmada — poria uma linha MUDA no fluxo", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [serie({ estado: "ATIVA", leitura: "sem_observacao", valorProjetado: null, valorDeclarado: null, base: { n: 0 } })],
    }));
    montar();
    // ⚠ ATIVA só oferece "Tirar do fluxo", e essa não precisa de valor.
    const botao = await screen.findByRole("button", { name: /Tirar do fluxo/i });
    expect(botao).toBeEnabled();
  });
});

describe("⚠⚠ 'ver todas' é opt-in", () => {
  it("por padrão, só as que pedem decisão", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [serie(), serie({ rotulo: "SEM PADRAO", chave: "x", leitura: "poucas_observacoes" })],
    }));
    montar();
    await screen.findByText("ANTHROPIC PBC");
    // ⚠⚠ 94 linhas mudas afogariam as 3 que pedem — o mesmo defeito que a fila resolve agrupando.
    expect(screen.queryByText("SEM PADRAO")).not.toBeInTheDocument();
  });

  it("⚠ e o botão traz o resto", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [serie(), serie({ rotulo: "SEM PADRAO", chave: "x", leitura: "poucas_observacoes" })],
    }));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Ver todas/i }));
    expect(await screen.findByText("SEM PADRAO")).toBeInTheDocument();
  });

  it("⚠ o cabeçalho conta as duas coisas — quantas pedem e quantas existem", async () => {
    mockGet.mockResolvedValue(resposta({
      series: [serie(), serie({ rotulo: "SEM PADRAO", chave: "x", leitura: "poucas_observacoes" })],
    }));
    montar();
    expect(await screen.findByText(/1 esperando decisão · 2 série\(s\)/)).toBeInTheDocument();
  });
});

describe("⚠ o erro aparece", () => {
  it("'não veio nada' e 'deu erro' não podem ficar iguais", async () => {
    mockGet.mockRejectedValue(new Error("rede fora"));
    montar();
    expect(await screen.findByText(/rede fora/)).toBeInTheDocument();
  });
});
