// A DIGITAÇÃO NO MODAL DE IMPORTAÇÃO OFX — a rede de segurança que faltava.
//
// Até aqui os dois modais de importação (OFX e Excel) não tinham UM teste. Isso importa agora
// porque o próximo passo é MEMOIZAR pedaços do render para a digitação parar de custar dezenas de
// milissegundos por tecla. Memoização que erra não deixa a tela lenta: deixa a tela MUDA — o campo
// aceita a tecla e não atualiza, a linha irmã não acompanha, o contador do topo congela. "Lento" é
// visível e reclamável; "não atualiza" é um lançamento contábil errado que ninguém percebe.
//
// Por isso esta suíte cobre exatamente o que a memoização mata quando erra:
//
//   1. escrita ISOLADA por linha (digitar na 3 não pode escrever na 1);
//   2. a AUTO-PROPAGAÇÃO por `descricaoOfx` repetida — e o seu freio, a irmã que já tem valor
//      próprio e NÃO pode ser sobrescrita;
//   3. a sugestão do campo D preenchendo D **e** C da mesma linha;
//   4. os contadores do topo (casadas / pendentes / prontas) acompanhando o que foi digitado;
//   5. "Pular" tirando a linha do payload do Importar.
//
// Junto vai o passo 1.5 (o `setLoading(false)` no mesmo lote de `setTransactions`+`setStep`): o que
// esta suíte trava ali é o efeito colateral perigoso da mudança — o botão "Lendo…" ficar preso.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImportOFXModal } from "../renderImportOfxModal.jsx";

const CONTAS = [
  { codigo: "111", nome: "Caixa", tipo: "ATIVO", natureza: "DEVEDORA" },
  { codigo: "311", nome: "Mercadorias", tipo: "DESPESA", natureza: "DEVEDORA" },
  { codigo: "412", nome: "Tarifas bancarias", tipo: "DESPESA", natureza: "DEVEDORA" },
];

const HISTORICO_MERCADO = {
  id: "h-mercado",
  text: "COMPRA DE MERCADORIAS",
  contaDebito: "311",
  contaCredito: "111",
  scope: "EMPRESA",
};

// ⚠ As linhas 0, 3 e 4 têm a MESMA `descricaoOfx` — é sobre elas que a auto-propagação age.
// A linha 5 chega casada pelo backend (já nasce completa), e é ela que dá conteúdo ao contador
// "casadas" e ao payload do Importar mesmo antes de qualquer digitação.
const TRANSACOES = [
  { rowIndex: 1, data: "2026-07-02", descricaoOfx: "TARIFA PACOTE", valor: 34.9, sinal: "DEBITO", match: null },
  { rowIndex: 2, data: "2026-07-05", descricaoOfx: "ENERGIA CEMIG", valor: 210.5, sinal: "DEBITO", match: null },
  { rowIndex: 3, data: "2026-07-08", descricaoOfx: "MERCADO CENTRAL", valor: 88, sinal: "DEBITO", match: null },
  { rowIndex: 4, data: "2026-07-20", descricaoOfx: "TARIFA PACOTE", valor: 34.9, sinal: "DEBITO", match: null },
  { rowIndex: 5, data: "2026-07-28", descricaoOfx: "TARIFA PACOTE", valor: 34.9, sinal: "DEBITO", match: null },
  {
    rowIndex: 6, data: "2026-07-30", descricaoOfx: "SALARIO FOLHA", valor: 5000, sinal: "DEBITO",
    match: { matchType: "exact", historicoSugerido: "PAGAMENTO DE SALARIOS", contaDebito: "412", contaCredito: "111" },
  },
];

function renderModal(props = {}) {
  const handlers = {
    onPreview: jest.fn().mockResolvedValue({ transactions: TRANSACOES }),
    onImport: jest.fn().mockResolvedValue({ ok: true, created: 2, loteImportacao: "L-1" }),
    onSearchHistoricos: jest.fn().mockResolvedValue([]),
    onGetHistoricosByCode: jest.fn().mockResolvedValue([HISTORICO_MERCADO]),
    onClose: jest.fn(),
    ...props,
  };
  render(<ImportOFXModal accounts={CONTAS} {...handlers} />);
  return handlers;
}

function escolherArquivo() {
  fireEvent.change(document.querySelector('input[type="file"]'), {
    target: { files: [new File(["OFXHEADER"], "extrato.ofx")] },
  });
}

function botao(nome) {
  return screen.getByRole("button", { name: nome });
}

// Abre a etapa de revisão — é lá que se digita, e é lá que mora tudo o que este arquivo protege.
async function abrirRevisao(props = {}) {
  const handlers = renderModal(props);
  escolherArquivo();
  await act(async () => { fireEvent.click(botao("Pré-visualizar")); });
  return handlers;
}

// ⚠ Os campos são localizados pela POSIÇÃO na linha, não por placeholder global: a linha marcada
// como "Pular" troca os três campos por `<input disabled>` sem placeholder, e uma busca global
// deslocaria todos os índices seguintes em silêncio.
function linha(i) {
  return document.querySelectorAll("tbody tr")[i];
}
function campos(i) {
  const inputs = linha(i).querySelectorAll('input[type="text"]');
  return { hist: inputs[0], d: inputs[1], c: inputs[2] };
}
function pular(i) {
  return linha(i).querySelector('input[type="checkbox"]');
}
// `getByText` casa só os nós de texto DIRETOS: o `<span>` do contador tem o número num `<strong>`
// filho, então o rótulo isolado ("pendentes") identifica o span e o `textContent` traz o número.
function contador(rotulo) {
  return screen.getByText(rotulo).textContent.trim();
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("1. cada linha escreve na SUA linha", () => {
  it("⚠ digitar no Histórico da 3ª linha não escreve em nenhuma outra", async () => {
    // O defeito clássico de memoização por índice: a subárvore reaproveitada guarda o `idx` do
    // render anterior e a tecla cai na linha errada. Aqui a 3ª linha tem `descricaoOfx` única, então
    // NADA deve se mover junto — nem por propagação.
    await abrirRevisao();

    fireEvent.change(campos(2).hist, { target: { value: "COMPRA NO MERCADO CENTRAL" } });

    expect(campos(2).hist.value).toBe("COMPRA NO MERCADO CENTRAL");
    expect(campos(0).hist.value).toBe("");
    expect(campos(1).hist.value).toBe("");
    expect(campos(3).hist.value).toBe("");
    expect(campos(4).hist.value).toBe("");
    expect(campos(5).hist.value).toBe("PAGAMENTO DE SALARIOS"); // a casada segue intacta
  });

  it("⚠ D e C da mesma linha são campos distintos — preencher um não preenche o outro", async () => {
    await abrirRevisao();

    fireEvent.change(campos(1).d, { target: { value: "412" } });

    expect(campos(1).d.value).toBe("412");
    expect(campos(1).c.value).toBe("");
    expect(campos(0).d.value).toBe("");
  });
});

describe("2. a auto-propagação por descrição repetida — e o seu freio", () => {
  it("⚠ propaga para as irmãs VAZIAS e não toca em quem tem outra descrição", async () => {
    // Linhas 0, 3 e 4 são "TARIFA PACOTE". A linha 1 é outra descrição e serve de controle: se ela
    // se mexer, a propagação virou "escreve em todo mundo".
    await abrirRevisao();

    fireEvent.change(campos(0).hist, { target: { value: "TARIFA PRIMEIRA" } });

    expect(campos(3).hist.value).toBe("TARIFA PRIMEIRA");
    expect(campos(4).hist.value).toBe("TARIFA PRIMEIRA");
    expect(campos(1).hist.value).toBe("");
  });

  it("⚠ NÃO sobrescreve a irmã que já tem valor PRÓPRIO", async () => {
    // A divergência entre irmãs é alcançável pela própria tela, e é isto que a monta aqui: linha
    // "Pulada" não recebe propagação (`r.skip` é a primeira guarda de `updateRow`). Marcar, propagar
    // por cima, desmarcar — e a irmã volta ao jogo com um valor que só ela tem.
    //
    // Sem esse freio, a tela apaga uma declaração feita à mão do contador em outra linha, e o único
    // sinal disso é um texto que muda sozinho num canto da tabela.
    await abrirRevisao();

    fireEvent.change(campos(0).hist, { target: { value: "TARIFA PRIMEIRA" } });
    fireEvent.click(pular(4));
    fireEvent.change(campos(0).hist, { target: { value: "TARIFA SEGUNDA" } });

    expect(campos(3).hist.value).toBe("TARIFA SEGUNDA"); // continuava igual à anterior → acompanha
    expect(campos(4).hist.value).toBe("TARIFA PRIMEIRA"); // pulada: não recebe

    fireEvent.click(pular(4)); // de volta ao jogo, agora com valor próprio
    fireEvent.change(campos(0).hist, { target: { value: "TARIFA TERCEIRA" } });

    expect(campos(3).hist.value).toBe("TARIFA TERCEIRA");
    expect(campos(4).hist.value).toBe("TARIFA PRIMEIRA"); // ⚠ o freio
  });

  it("a propagação vale para as CONTAS, não só para o histórico", async () => {
    await abrirRevisao();

    fireEvent.change(campos(0).d, { target: { value: "412" } });

    expect(campos(3).d.value).toBe("412");
    expect(campos(4).d.value).toBe("412");
    expect(campos(1).d.value).toBe("");
  });
});

describe("3. a sugestão do campo D preenche D e C daquela linha", () => {
  it("⚠ escolher um histórico salvo pelo código traz as DUAS contas e o texto", async () => {
    // É o caminho que faz o modal valer a pena: digitar o código, escolher o histórico memorizado e
    // ter a linha inteira pronta. Se a memoização congelar a subárvore da linha, o clique "funciona"
    // (o estado muda) e a tela não mostra nada — o pior desfecho possível.
    await abrirRevisao();

    fireEvent.change(campos(2).d, { target: { value: "31" } });
    await act(async () => { jest.advanceTimersByTime(400); }); // debounce de 300 ms + promessa

    fireEvent.mouseDown(screen.getByText("COMPRA DE MERCADORIAS"));

    expect(campos(2).d.value).toBe("311");
    expect(campos(2).c.value).toBe("111");
    expect(campos(2).hist.value).toBe("COMPRA DE MERCADORIAS");
  });

  it("o rótulo de status da linha vai de ⚠ Pendente a ✓ Pronto", async () => {
    // O status é derivado do MESMO estado que os campos. Ele é o sinal que o contador olha para
    // saber que pode parar de mexer naquela linha.
    await abrirRevisao();
    expect(linha(2).textContent).toContain("⚠ Pendente");

    fireEvent.change(campos(2).hist, { target: { value: "COMPRA" } });
    fireEvent.change(campos(2).d, { target: { value: "311" } });
    fireEvent.change(campos(2).c, { target: { value: "111" } });

    expect(linha(2).textContent).toContain("✓ Pronto");
    expect(linha(2).textContent).not.toContain("⚠ Pendente");
  });
});

describe("4. os contadores do topo acompanham", () => {
  it("⚠ casadas / pendentes / prontas mudam junto com a digitação", async () => {
    await abrirRevisao();

    expect(contador("casadas")).toBe("1 casadas");
    expect(contador("pendentes")).toBe("5 pendentes");
    expect(contador("prontas")).toBe("1 prontas");

    fireEvent.change(campos(2).hist, { target: { value: "COMPRA" } });
    fireEvent.change(campos(2).d, { target: { value: "311" } });
    fireEvent.change(campos(2).c, { target: { value: "111" } });

    expect(contador("casadas")).toBe("1 casadas"); // casar é do backend, digitar não casa nada
    expect(contador("pendentes")).toBe("4 pendentes");
    expect(contador("prontas")).toBe("2 prontas");
    expect(botao(/^Importar 2 linhas$/)).toBeEnabled();
  });

  it('"Pular" tira a linha da conta de pendentes e acende o contador de ignoradas', async () => {
    await abrirRevisao();
    expect(screen.queryByText("ignoradas")).toBeNull(); // só aparece quando existe alguma

    fireEvent.click(pular(1));

    expect(contador("pendentes")).toBe("4 pendentes");
    expect(contador("ignoradas")).toBe("1 ignoradas");
  });
});

describe("5. Pular tira a linha do payload do Importar", () => {
  it("⚠ a linha marcada não é enviada — e as outras vão inteiras", async () => {
    const { onImport } = await abrirRevisao();

    // Deixa duas linhas prontas (a 1 e a 2) e depois desiste da 1.
    fireEvent.change(campos(1).hist, { target: { value: "ENERGIA" } });
    fireEvent.change(campos(1).d, { target: { value: "412" } });
    fireEvent.change(campos(1).c, { target: { value: "111" } });
    fireEvent.change(campos(2).hist, { target: { value: "COMPRA" } });
    fireEvent.change(campos(2).d, { target: { value: "311" } });
    fireEvent.change(campos(2).c, { target: { value: "111" } });
    expect(contador("prontas")).toBe("3 prontas");

    fireEvent.click(pular(1));
    expect(contador("prontas")).toBe("2 prontas");

    await act(async () => { fireEvent.click(botao(/^Importar 2 linhas$/)); });

    expect(onImport).toHaveBeenCalledTimes(1);
    const enviados = onImport.mock.calls[0][0];
    expect(enviados.map((l) => l.rowIndex)).toEqual([3, 6]); // a 2ª linha (rowIndex 2) ficou de fora
    expect(enviados[0]).toMatchObject({ historico: "COMPRA", contaDebito: "311", contaCredito: "111" });
    expect(screen.getByText(/importado.* com sucesso/)).toBeInTheDocument();
  });
});

describe("os <datalist> do preenchimento em lote", () => {
  it("⚠ cada campo de conta aponta para um datalist que EXISTE e traz o plano inteiro", async () => {
    // O passo 1 tira estes `<datalist>` do caminho do render (eles eram recriados a cada tecla, com
    // o plano de contas inteiro dentro). O que não pode mudar é o contrato: o `list` do input tem de
    // achar um `<datalist>` com uma `<option>` por conta — senão a sugestão nativa some e ninguém
    // repara, porque campo sem sugestão parece campo normal.
    await abrirRevisao();

    const emLote = screen.getByText("Aplicar a todas pendentes:").parentElement;
    const comLista = [...emLote.querySelectorAll("input[list]")];
    expect(comLista.length).toBe(2); // Débito e Crédito

    comLista.forEach((input) => {
      const lista = document.getElementById(input.getAttribute("list"));
      expect(lista).not.toBeNull();
      expect(lista.tagName.toLowerCase()).toBe("datalist");
      expect(lista.querySelectorAll("option")).toHaveLength(CONTAS.length);
      expect([...lista.querySelectorAll("option")].map((o) => o.value)).toEqual(["111", "311", "412"]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Passo 1.5 — `setLoading(false)` passa a viver no MESMO lote de `setTransactions`+`setStep`.
// A economia é um render da tabela inteira ao abrir a revisão. O risco é o botão ficar preso em
// "Lendo…" num caminho de saída que deixe de passar pelo `finally` — e um botão morto é bem pior
// que um render a mais.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("o botão de pré-visualizar destrava em todos os desfechos", () => {
  it("trava enquanto lê e some ao chegar na revisão", async () => {
    let liberar;
    renderModal({ onPreview: jest.fn(() => new Promise((resolve) => { liberar = resolve; })) });
    escolherArquivo();

    fireEvent.click(botao("Pré-visualizar"));
    expect(botao("Lendo...")).toBeDisabled();

    await act(async () => { liberar({ transactions: TRANSACOES }); });

    expect(screen.queryByRole("button", { name: "Lendo..." })).toBeNull();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(TRANSACOES.length);
  });

  it("⚠ erro na leitura destrava o botão e mostra o motivo", async () => {
    renderModal({ onPreview: jest.fn().mockRejectedValue(new Error("arquivo corrompido")) });
    escolherArquivo();

    await act(async () => { fireEvent.click(botao("Pré-visualizar")); });

    expect(botao("Pré-visualizar")).toBeEnabled();
    expect(screen.getByText("arquivo corrompido")).toBeInTheDocument();
  });

  it("⚠ arquivo sem transações destrava o botão e mostra o motivo", async () => {
    renderModal({ onPreview: jest.fn().mockResolvedValue({ transactions: [] }) });
    escolherArquivo();

    await act(async () => { fireEvent.click(botao("Pré-visualizar")); });

    expect(botao("Pré-visualizar")).toBeEnabled();
    expect(screen.getByText("Nenhuma transação encontrada no arquivo.")).toBeInTheDocument();
  });
});
