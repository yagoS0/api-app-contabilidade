// A DIGITAÇÃO NO MODAL DE IMPORTAÇÃO EXCEL — a versão enxuta da rede de segurança do OFX.
//
// Enxuta porque a tela é menor: aqui não há auto-propagação por descrição nem atalhos de teclado.
// Cada linha tem Histórico, Débito e Crédito e mais nada — e é justamente por ser simples que ela
// concentrava o pior custo por tecla do app: havia UM `<datalist>` com o plano inteiro **por linha**.
//
// O que esta suíte protege quando esse `<datalist>` virar um só para a tabela toda:
//
//   1. escrita ISOLADA por linha e por campo;
//   2. o `list` de cada campo continuando a achar um `<datalist>` com o plano inteiro — some a
//      sugestão nativa e nada na tela denuncia, porque campo sem sugestão parece campo normal;
//   3. os contadores do topo acompanhando;
//   4. "Pular" tirando a linha do payload do Importar.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImportExcelModal } from "../renderImportExcelModal.jsx";

const CONTAS = [
  { codigo: "111", nome: "Caixa", tipo: "ATIVO", natureza: "DEVEDORA" },
  { codigo: "311", nome: "Mercadorias", tipo: "DESPESA", natureza: "DEVEDORA" },
  { codigo: "412", nome: "Tarifas bancarias", tipo: "DESPESA", natureza: "DEVEDORA" },
];

// A última linha chega casada pelo backend: nasce completa, conta como "casada" e já entra no
// payload do Importar antes de qualquer digitação.
const LINHAS = [
  { rowIndex: 1, data: "2026-07-02", descricao: "TARIFA PACOTE", valor: 34.9, match: null },
  { rowIndex: 2, data: "2026-07-05", descricao: "ENERGIA CEMIG", valor: 210.5, match: null },
  { rowIndex: 3, data: "2026-07-08", descricao: "MERCADO CENTRAL", valor: 88, match: null },
  {
    rowIndex: 4, data: "2026-07-30", descricao: "FOLHA DE PAGAMENTO", valor: 5000,
    match: { matchType: "exact", contaDebito: "412", contaCredito: "111" },
  },
];

function renderModal(props = {}) {
  const handlers = {
    onPreview: jest.fn().mockResolvedValue({ transactions: LINHAS }),
    onCommit: jest.fn().mockResolvedValue({ ok: true }),
    onClose: jest.fn(),
    ...props,
  };
  render(<ImportExcelModal accounts={CONTAS} {...handlers} />);
  return handlers;
}

function botao(nome) {
  return screen.getByRole("button", { name: nome });
}

async function abrirRevisao(props = {}) {
  const handlers = renderModal(props);
  fireEvent.change(document.querySelector('input[type="file"]'), {
    target: { files: [new File(["col"], "planilha.xlsx")] },
  });
  await act(async () => { fireEvent.click(botao("Pré-visualizar")); });
  return handlers;
}

// Campos localizados pela POSIÇÃO na linha: a linha "Pulada" mantém os inputs, mas uma busca global
// por placeholder ("—") casaria também os campos do preenchimento em lote.
function linha(i) {
  return document.querySelectorAll("tbody tr")[i];
}
// ⚠ Ancorado em `input[list]`, não em `input[type="text"]`: a linha ganhou o campo de HISTÓRICO
// (sugestão editável) e ele vem ANTES de D e C. Só os campos de conta apontam para o `<datalist>`
// do plano — a âncora que sobrevive a mudança de coluna é essa, não o índice bruto.
function campos(i) {
  const contas = linha(i).querySelectorAll("input[list]");
  return { d: contas[0], c: contas[1], h: linha(i).querySelector('input[type="text"]:not([list])') };
}
function pular(i) {
  return linha(i).querySelector('input[type="checkbox"]');
}
// `getByText` casa só os nós de texto DIRETOS — o número mora num `<strong>` filho do `<span>`.
function contador(rotulo) {
  return screen.getByText(rotulo).textContent.trim();
}

describe("1. cada linha escreve na SUA linha", () => {
  it("⚠ digitar no Débito da 3ª linha não escreve em nenhuma outra", async () => {
    await abrirRevisao();

    fireEvent.change(campos(2).d, { target: { value: "311" } });

    expect(campos(2).d.value).toBe("311");
    expect(campos(2).c.value).toBe("");
    expect(campos(0).d.value).toBe("");
    expect(campos(1).d.value).toBe("");
    expect(campos(3).d.value).toBe("412"); // a casada segue intacta
  });

  it("⚠ o Crédito da mesma linha é outro campo — e não há propagação entre linhas no Excel", async () => {
    // Diferente do OFX: aqui `updateRow` não olha para a descrição. Duas linhas com o MESMO texto
    // continuam independentes, e é isso que o teste trava.
    await abrirRevisao();

    fireEvent.change(campos(0).c, { target: { value: "111" } });

    expect(campos(0).c.value).toBe("111");
    expect(campos(0).d.value).toBe("");
    expect(campos(1).c.value).toBe("");
  });

  it("o rótulo de status da linha vai de ⚠ Pendente a ✓ Pronto", async () => {
    await abrirRevisao();
    expect(linha(2).textContent).toContain("⚠ Pendente");

    fireEvent.change(campos(2).d, { target: { value: "311" } });
    fireEvent.change(campos(2).c, { target: { value: "111" } });

    expect(linha(2).textContent).toContain("✓ Pronto");
    expect(linha(2).textContent).not.toContain("⚠ Pendente");
  });
});

describe("2. a sugestão nativa continua ligada em TODOS os campos de conta", () => {
  it("⚠ cada input com `list` acha um <datalist> com o plano de contas inteiro", async () => {
    // Este é o teste que o passo 1 tem de manter verde ao trocar N datalists (um por linha) por UM
    // só para a tabela: o que importa é o `list` do input resolver para um `<datalist>` existente
    // com uma `<option>` por conta. Quantos elementos existem é detalhe de implementação.
    await abrirRevisao();

    const comLista = [...document.querySelectorAll("input[list]")];
    // 2 por linha (D e C) + 2 do preenchimento em lote
    expect(comLista).toHaveLength(LINHAS.length * 2 + 2);

    comLista.forEach((input) => {
      const lista = document.getElementById(input.getAttribute("list"));
      expect(lista).not.toBeNull();
      expect(lista.tagName.toLowerCase()).toBe("datalist");
      expect([...lista.querySelectorAll("option")].map((o) => o.value)).toEqual(["111", "311", "412"]);
    });
  });
});

describe("3. os contadores do topo acompanham", () => {
  it("⚠ prontas sobe com a digitação; casadas é do backend e não se mexe", async () => {
    await abrirRevisao();

    expect(contador("casadas")).toBe("1 casadas");
    expect(contador("prontas para importar")).toBe("1 prontas para importar");

    fireEvent.change(campos(2).d, { target: { value: "311" } });
    fireEvent.change(campos(2).c, { target: { value: "111" } });

    expect(contador("casadas")).toBe("1 casadas");
    expect(contador("prontas para importar")).toBe("2 prontas para importar");
    expect(botao(/^Importar 2 linhas$/)).toBeEnabled();
  });

  it('"Pular" tira a linha das prontas e acende o contador de ignoradas', async () => {
    await abrirRevisao();
    expect(screen.queryByText("ignoradas")).toBeNull();

    fireEvent.click(pular(3)); // a linha casada, a única pronta até aqui

    expect(contador("prontas para importar")).toBe("0 prontas para importar");
    expect(contador("ignoradas")).toBe("1 ignoradas");
    expect(botao(/^Importar 0 linhas?$/)).toBeDisabled();
  });
});

describe("4. Pular tira a linha do payload do Importar", () => {
  it("⚠ a linha marcada não é enviada — e as outras vão inteiras", async () => {
    const { onCommit, onClose } = await abrirRevisao();

    fireEvent.change(campos(0).d, { target: { value: "412" } });
    fireEvent.change(campos(0).c, { target: { value: "111" } });
    fireEvent.change(campos(2).d, { target: { value: "311" } });
    fireEvent.change(campos(2).c, { target: { value: "111" } });
    expect(contador("prontas para importar")).toBe("3 prontas para importar");

    fireEvent.click(pular(0));
    expect(contador("prontas para importar")).toBe("2 prontas para importar");

    await act(async () => { fireEvent.click(botao(/^Importar 2 linhas$/)); });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const enviados = onCommit.mock.calls[0][0];
    expect(enviados.map((l) => l.rowIndex)).toEqual([3, 4]); // a 1ª linha (rowIndex 1) ficou de fora
    expect(enviados[0]).toMatchObject({ contaDebito: "311", contaCredito: "111", valor: 88 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// A regra do prefixo mora em `lib/historicoSugerido.js`, com teste próprio. O que se cobre aqui é a
// LIGAÇÃO: a sugestão chega ao campo, o campo é editável, e o que sobe no payload é o texto da tela.
describe("5. o histórico é SUGESTÃO editável — e a descrição da planilha sobrevive ao lado", () => {
  it("⚠ o campo nasce preenchido com 'PAGO ' + descrição", async () => {
    await abrirRevisao();
    expect(campos(0).h.value).toBe("PAGO TARIFA PACOTE");
    expect(campos(3).h.value).toBe("PAGO FOLHA DE PAGAMENTO");
    // A descrição crua continua VISÍVEL na linha — é ela que vai para `descricaoImportacao`.
    expect(linha(0).textContent).toContain("TARIFA PACOTE");
  });

  it("⚠ o contador escreve por cima, e é o texto DELE que sobe", async () => {
    const { onCommit } = await abrirRevisao();

    fireEvent.change(campos(3).h, { target: { value: "FOLHA DE JULHO/2026" } });
    await act(async () => { fireEvent.click(botao(/^Importar 1 linha$/)); });

    const [linhaEnviada] = onCommit.mock.calls[0][0];
    expect(linhaEnviada.historico).toBe("FOLHA DE JULHO/2026");
    // ⚠ `descricao` NÃO acompanha a edição: são dois fatos diferentes, e é a separação deles que
    // este import inteiro existe para resolver.
    expect(linhaEnviada.descricao).toBe("FOLHA DE PAGAMENTO");
  });

  it("⚠ esvaziar o campo NÃO grava histórico vazio — cai na descrição, igual ao backend", async () => {
    const { onCommit } = await abrirRevisao();

    fireEvent.change(campos(3).h, { target: { value: "   " } });
    await act(async () => { fireEvent.click(botao(/^Importar 1 linha$/)); });

    expect(onCommit.mock.calls[0][0][0].historico).toBe("FOLHA DE PAGAMENTO");
  });

  it("a memória vence o prefixo quando o backend devolve um historicoSugerido", async () => {
    await abrirRevisao({
      onPreview: jest.fn().mockResolvedValue({
        transactions: [{
          rowIndex: 1, data: "2026-07-02", descricao: "TARIFA PACOTE", valor: 34.9,
          match: { matchType: "exact", contaDebito: "412", contaCredito: "111", historicoSugerido: "TARIFAS BANCARIAS DO MES" },
        }],
      }),
    });
    expect(campos(0).h.value).toBe("TARIFAS BANCARIAS DO MES");
  });
});
