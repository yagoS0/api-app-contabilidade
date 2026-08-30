// A GAVETA DO DIA — a LIGAÇÃO (30/08/2026).
//
// > Dono: *"saída não deve ser um botão, ele deve clicar no campo do dia, abre um menu lateral e aí
// > ele digita a saída. Todos os blocos de saída devem e podem ser clicados, isso abre um menu
// > lateral que mostra as saídas naquele dia, com suas descrições."* · *"o de impostos também, devo
// > poder clicar para ver os impostos no menu lateral."*
//
// ⚠⚠ POR QUE UM TESTE DE LIGAÇÃO, e não só o da regra: a regra pura já está travada em
// `lib/__tests__/detalheDoDia.test.js`. O que só quebra AQUI é a fiação — a gaveta de impostos
// oferecendo o formulário de saída, o valor chegando à API como STRING mascarada, o zero passando
// porque o `required` do HTML o considera preenchido, e o Esc que não fecha. Este projeto já mediu
// o custo disso: uma vez a regra tinha 17 testes, a ligação tinha nenhum, e o experimento voltou
// **zero vermelhos** com o defeito de pé.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { GavetaDoDia } from "../GavetaDoDia";
import { CLASSES_DA_PROCEDENCIA } from "../lib/leituraDoFluxo";

const COMPETENCIA = "2026-08";

const guia = {
  fonte: "GUIA", direcao: "SAIDA", procedencia: "COMPROMISSO", competencia: COMPETENCIA,
  dia: 20, valor: 1234.5, rotulo: "DAS 07/2026",
  base: { frase: "Esta guia já foi gerada pelo seu contador." },
  referencia: { tipo: "guia", id: "g-1" },
};

const saidaDoCliente = {
  fonte: "SAIDA_DO_CLIENTE", direcao: "SAIDA", procedencia: "PREVISAO", competencia: COMPETENCIA,
  dia: 20, valor: 3000, rotulo: "Reforma da sala",
  base: { doCliente: true, estadoDaSaida: "PENDENTE" },
  referencia: { tipo: "saidaAvulsa", id: "sa-1" },
};

const folhaNoMes = {
  fonte: "FOLHA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: COMPETENCIA,
  dia: null, valor: 8000, rotulo: "Folha de pagamento",
  base: { frase: "A folha é lançada por competência, não por dia." },
};

const entradaDoDia1 = {
  fonte: "NOTA_EMITIDA", direcao: "ENTRADA", procedencia: "PREVISAO", competencia: COMPETENCIA,
  dia: 1, valor: 50000, rotulo: "Recebimento das notas de julho",
};

const LINHAS = [guia, saidaDoCliente, folhaNoMes, entradaDoDia1];

function abrir(props = {}) {
  const aoFechar = jest.fn();
  const aoMudar = jest.fn();
  const utils = render(
    <GavetaDoDia
      aberta
      competencia={COMPETENCIA}
      dia={20}
      balde={null}
      linhasDoMes={LINHAS}
      companyId="pc-001"
      aoFechar={aoFechar}
      aoMudar={aoMudar}
      {...props}
    />,
  );
  return { aoFechar, aoMudar, ...utils };
}

const digitar = (rotulo, valor) => {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
};

const clicar = async (nome) => {
  await act(async () => { screen.getByRole("button", { name: nome }).click(); });
};

afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as TRÊS entradas abrem a MESMA gaveta", () => {
  it("pelo DIA: mostra as linhas daquele dia — e nenhuma de outro dia nem do 'no mês'", () => {
    abrir({ dia: 20, balde: null });
    expect(screen.getByText("DAS 07/2026")).toBeInTheDocument();
    expect(screen.getByText("Reforma da sala")).toBeInTheDocument();
    expect(screen.queryByText("Folha de pagamento")).not.toBeInTheDocument();
    expect(screen.queryByText("Recebimento das notas de julho")).not.toBeInTheDocument();
  });

  it("por IMPOSTOS: mostra só o imposto — a saída do cliente fica de fora", () => {
    abrir({ dia: 20, balde: "impostos" });
    expect(screen.getByText("DAS 07/2026")).toBeInTheDocument();
    expect(screen.queryByText("Reforma da sala")).not.toBeInTheDocument();
  });

  it("por SAÍDA: mostra a saída e o FORMULÁRIO de acrescentar", () => {
    abrir({ dia: 20, balde: "saida" });
    expect(screen.getByText("Reforma da sala")).toBeInTheDocument();
    expect(screen.queryByText("DAS 07/2026")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acrescentar" })).toBeInTheDocument();
  });

  it("⚠⚠ a gaveta de IMPOSTOS não oferece acrescentar — a linha cairia em Saída e sumiria da célula", () => {
    abrir({ dia: 20, balde: "impostos" });
    expect(screen.queryByRole("button", { name: "Acrescentar" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Valor")).not.toBeInTheDocument();
  });

  it("⚠⚠ `dia: null` é a gaveta do 'no mês' — as projeções sem dia, e o título diz isso", () => {
    abrir({ dia: null, balde: null });
    expect(screen.getByText("Folha de pagamento")).toBeInTheDocument();
    expect(screen.queryByText("DAS 07/2026")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/no mês/i);
  });

  it("⚠ o título nomeia o recorte E o mês — o clique tem de se reconhecer na caixa que abriu", () => {
    abrir({ dia: 20, balde: "impostos" });
    const t = screen.getByRole("heading", { level: 2 }).textContent;
    expect(t).toMatch(/Impostos/);
    expect(t).toMatch(/dia 20/);
    expect(t).toMatch(/agosto de 2026/);
  });

  it("⚠ vazio DIZ que está vazio — gaveta vazia não pode parecer carregamento", () => {
    abrir({ dia: 28, balde: "impostos" });
    expect(screen.getByText(/Nada em Impostos neste dia/i)).toBeInTheDocument();
  });

  it("⚠⚠ FECHADA, ela não existe no DOM — escondê-la por CSS deixaria o foco preso numa caixa invisível", () => {
    const { container } = abrir({ aberta: false });
    expect(container).toBeEmptyDOMElement();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a linha diz de onde o número veio, e o previsto é dito por ESCRITO", () => {
  it("a FRASE da linha aparece na tela", () => {
    abrir({ dia: 20, balde: "impostos" });
    expect(screen.getByText("Esta guia já foi gerada pelo seu contador.")).toBeInTheDocument();
  });

  it("⚠ linha sem frase não ganha parágrafo nenhum — aviso em toda linha vira paisagem", () => {
    abrir({ dia: 1, balde: "entrada" });
    expect(screen.getByText("Recebimento das notas de julho")).toBeInTheDocument();
    expect(document.querySelectorAll(".gaveta-frase")).toHaveLength(0);
  });

  it("⚠⚠ PREVISÃO nunca é verde, e a palavra vai no TEXTO", () => {
    abrir({ dia: 20, balde: "saida" });
    const marca = document.querySelector('[data-procedencia="PREVISAO"] .gaveta-marca');
    // ⚠ A palavra existe mesmo em preto e branco, e o leitor de tela a lê.
    expect(marca.textContent).toBe("Previsto");
    // ⚠ A classe só pode ser uma das duas que a folha de estilo pinta — `ok`/verde não está entre
    // elas, e verde nesta casa quer dizer PAGO.
    expect(CLASSES_DA_PROCEDENCIA).toContain(marca.getAttribute("data-classe"));
    expect(marca.getAttribute("data-classe")).not.toBe("ok");
  });

  it("⚠ o COMPROMISSO não é chamado de previsão — o valor e a data são conhecidos", () => {
    abrir({ dia: 20, balde: "impostos" });
    expect(document.querySelector('[data-procedencia="COMPROMISSO"] .gaveta-marca').textContent)
      .toBe("A pagar");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ acrescentar a saída dali mesmo", () => {
  it("⚠⚠ abrindo pelo DIA, a data já vem com aquele dia", () => {
    abrir({ dia: 20, balde: null });
    expect(screen.getByLabelText("Data em que você pretende pagar").value).toBe("2026-08-20");
  });

  it("⚠ na gaveta do 'no mês' a data abre VAZIA — inventar o dia 1 é o que a linha 'no mês' impede", () => {
    abrir({ dia: null, balde: null });
    expect(screen.getByLabelText("Data em que você pretende pagar").value).toBe("");
  });

  it("⚠⚠ o valor chega à API como NÚMERO, nunca como a string mascarada", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    const { aoMudar } = abrir({ dia: 20, balde: "saida" });

    digitar("O que é", "Pintura da fachada");
    digitar("Valor", "150000");
    // ⚠ A máscara é a mesma da emissão de nota: fluxo de dígitos em centavos.
    expect(screen.getByLabelText("Valor").value).toBe("1.500,00");
    await clicar("Acrescentar");

    expect(criar).toHaveBeenCalledWith("pc-001", {
      tipo: "AVULSA", descricao: "Pintura da fachada", valor: 1500, data: "2026-08-20",
    });
    expect(typeof criar.mock.calls[0][1].valor).toBe("number");
    // ⚠ Quem recarrega é quem TEM as linhas — a gaveta não busca nada por conta própria.
    expect(aoMudar).toHaveBeenCalled();
  });

  it("⚠⚠ ZERO é recusado, COM O MOTIVO — e nada é enviado", async () => {
    // `required` do HTML deixaria passar: "0,00" é um campo preenchido para o navegador.
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir({ dia: 20, balde: "saida" });

    digitar("O que é", "Coisa de zero real");
    digitar("Valor", "000");
    expect(screen.getByLabelText("Valor").value).toBe("0,00");
    await clicar("Acrescentar");

    expect(criar).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/maior que zero/i);
  });

  it("⚠ sem descrição, a recusa DIZ o que falta — e também não envia", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir({ dia: 20, balde: "saida" });
    digitar("Valor", "150000");
    await clicar("Acrescentar");
    expect(criar).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Escreva o que é esta saída/i);
  });

  it("⚠ a recusa do SERVIDOR aparece na tela — a gaveta não inventa um desfecho", async () => {
    jest.spyOn(api, "criarSaidaDoFluxo").mockRejectedValue({ code: "valor_invalido" });
    const { aoMudar } = abrir({ dia: 20, balde: "saida" });
    digitar("O que é", "Reforma");
    digitar("Valor", "150000");
    await clicar("Acrescentar");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("⚠⚠ a gaveta manda AVULSA com data — a recorrente guarda ciclo e não sai daqui", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir({ dia: 20, balde: "saida" });
    digitar("O que é", "Reforma");
    digitar("Valor", "150000");
    await clicar("Acrescentar");
    expect(criar.mock.calls[0][1]).not.toHaveProperty("periodicidade");
    expect(criar.mock.calls[0][1].tipo).toBe("AVULSA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ o diálogo — e nada disso é reimplementado aqui", () => {
  it("⚠ Esc FECHA", () => {
    const { aoFechar } = abrir();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(aoFechar).toHaveBeenCalled();
  });

  it("⚠ o botão de fechar fecha, e ele tem NOME acessível (o ✕ sozinho não é nome)", async () => {
    const { aoFechar } = abrir();
    await clicar("Fechar");
    expect(aoFechar).toHaveBeenCalled();
  });

  it("⚠ ela se declara diálogo modal, com título ligado — `aria-modal` promete a página inerte", () => {
    abrir();
    const caixa = screen.getByRole("dialog");
    expect(caixa).toHaveAttribute("aria-modal", "true");
    expect(caixa.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { level: 2 }).id);
  });

  it("⚠ o foco ENTRA na caixa ao abrir — senão o teclado continua na página de trás", () => {
    abrir();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });
});
