// O MODAL DE CONTABILIZAÇÃO EM LOTE — a regra chegando à tela.
//
// ⚠ A REGRA tem teste próprio (`../../lib/__tests__/contabilizacaoEmLote.test.js`). O que se prende
// aqui é o que só se vê montando: que o débito que casa com nota NÃO vira linha editável, que a
// aplicação em massa não sobrescreve o que a pessoa digitou, que o envio é UMA chamada por linha e
// que o SUCESSO PARCIAL aparece linha a linha.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalDeContabilizacao } from "../ModalDeContabilizacao";

const PLANO = [
  { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
  { codigo: "400", codigoCompleto: "41102", nome: "Despesas Gerais", analitica: false },
  { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  { codigo: "402", codigoCompleto: "411020002", nome: "Energia Elétrica", analitica: true },
];

const linha = (extra = {}) => ({
  id: "d-1",
  estado: "A_CONFERIR",
  competencia: "2026-07",
  dataPagamento: "2026-07-15",
  origemPagamento: "OFX",
  mesFechado: false,
  valor: "100.00",
  descricaoOriginal: "FORNECEDOR UM",
  sugestao: null,
  ...extra,
});

function montar(props = {}) {
  const aoEnviarLinha = props.aoEnviarLinha || jest.fn(async () => ({ ok: true }));
  const aoConcluir = jest.fn();
  const utils = render(
    <ModalDeContabilizacao
      itens={props.itens || [linha()]}
      contas={props.contas || PLANO}
      idsQueCasam={props.idsQueCasam || new Map()}
      podeEscrever={props.podeEscrever ?? true}
      podeEscolherConta={props.podeEscolherConta ?? true}
      estadoDoPlano={props.estadoDoPlano}
      totalDaFila={props.totalDaFila}
      aoFechar={jest.fn()}
      aoEnviarLinha={aoEnviarLinha}
      aoConcluir={aoConcluir}
    />,
  );
  return { ...utils, aoEnviarLinha, aoConcluir };
}

/**
 * As células de conta de cada linha, na ordem da tabela.
 *
 * ⚠ O rótulo NOMEIA A LINHA (`… — FORNECEDOR UM`) — vinte campos com o mesmo nome acessível
 * deixavam quem usa leitor de tela sem saber de qual fornecedor era cada um.
 */
const camposDeConta = () => screen.queryAllByLabelText(/^Conta contábil da despesa/);

describe("⚠⚠ o débito que casa com nota não vira linha editável", () => {
  it("ele sai da tabela E aparece com o motivo — nada some em silêncio", () => {
    montar({
      itens: [linha(), linha({ id: "ofx-1", descricaoOriginal: "PAGTO KODA BEAR" })],
      idsQueCasam: new Map([["ofx-1", "casa_com_nota"]]),
    });

    // uma linha editável, não duas
    expect(camposDeConta()).toHaveLength(1);
    // e o motivo está na tela, VISÍVEL — não num `title`
    expect(screen.getByText(/lançaria a mesma despesa duas vezes/i)).toBeInTheDocument();
    expect(screen.getByText(/PAGTO KODA BEAR/)).toBeInTheDocument();
  });

  it("⚠ o título conta só as que entram", () => {
    montar({
      itens: [linha(), linha({ id: "ofx-1" }), linha({ id: "ofx-2" })],
      idsQueCasam: new Map([["ofx-1", "casa_com_nota"], ["ofx-2", "casa_com_nota"]]),
    });
    expect(screen.getByText(/Contabilizar em lote — 1 lançamento/i)).toBeInTheDocument();
  });

  it("⚠⚠ com TODAS casando, o lote fica vazio e diz por quê — não abre uma tabela em branco", () => {
    montar({ itens: [linha({ id: "ofx-1" })], idsQueCasam: new Map([["ofx-1", "casa_com_nota"]]) });
    expect(camposDeConta()).toHaveLength(0);
    expect(screen.getByText(/Nenhuma linha desta fila pode ser contabilizada em lote/i)).toBeInTheDocument();
  });
});

describe("⚠ o que a tela diz sobre a contrapartida", () => {
  it("⚠⚠ UMA coluna de conta, e a tela diz que o crédito é o caixa", () => {
    montar();
    expect(screen.getByText(/a contrapartida não é escolhida aqui/i)).toBeInTheDocument();
    // ⚠ Uma segunda coluna de conta prometeria liberdade que o servidor não tem.
    expect(camposDeConta()).toHaveLength(1);
    expect(screen.queryByText(/crédito \(conta\)/i)).not.toBeInTheDocument();
  });

  it("⚠⚠ a PROCEDÊNCIA da data viaja até aqui — prova e declaração não podem ficar iguais", () => {
    montar({
      itens: [
        linha({ id: "d-1", origemPagamento: "OFX", descricaoOriginal: "DO EXTRATO" }),
        linha({ id: "d-2", origemPagamento: "DECLARADO_PELO_CONTADOR", descricaoOriginal: "SEM COMPROVANTE" }),
      ],
    });
    const declarada = screen.getByText("SEM COMPROVANTE").closest("tr");
    expect(within(declarada).getByText(/declarad/i)).toBeInTheDocument();
  });
});

describe("⚠ o campo nasce com a sugestão, traduzida para o reduzido", () => {
  it("sugestão conhecida pré-preenche", () => {
    montar({ itens: [linha({ sugestao: { conta: "411020001" } })] });
    expect(camposDeConta()[0]).toHaveValue("401");
  });

  it("⚠ sugestão fora do plano deixa VAZIO — nunca a primeira conta", () => {
    montar({ itens: [linha({ sugestao: { conta: "999999999" } })] });
    expect(camposDeConta()[0]).toHaveValue("");
  });
});

describe("⚠⚠ a aplicação em massa só toca as pendentes", () => {
  it("preenche as vazias e NÃO sobrescreve a que foi digitada à mão", () => {
    montar({
      itens: [
        linha({ id: "d-1" }),
        linha({ id: "d-2", descricaoOriginal: "FORNECEDOR DOIS" }),
        linha({ id: "d-3", descricaoOriginal: "FORNECEDOR TRES" }),
      ],
    });
    // o contador digita na SEGUNDA linha
    fireEvent.change(camposDeConta()[1], { target: { value: "401" } });

    fireEvent.change(screen.getByLabelText(/Aplicar nas linhas sem conta/i), { target: { value: "402" } });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar nas 2 em branco/i }));

    const campos = camposDeConta();
    expect(campos[0]).toHaveValue("402");
    // ⚠⚠ ESTA é a asserção que importa: o estrago silencioso deste modal seria ela virar 402.
    expect(campos[1]).toHaveValue("401");
    expect(campos[2]).toHaveValue("402");
  });

  it("⚠ com tudo preenchido o botão desabilita, com o motivo", () => {
    montar({ itens: [linha({ sugestao: { conta: "411020001" } })] });
    fireEvent.change(screen.getByLabelText(/Aplicar nas linhas sem conta/i), { target: { value: "402" } });
    const botao = screen.getByRole("button", { name: /Aplicar nas 0 em branco/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/já têm conta/i));
  });
});

describe("⚠⚠ a conta recusada é nomeada NA LINHA, e a linha não é enviada", () => {
  it("sintética diz que é de agregação e não entra na contagem do botão", () => {
    montar();
    fireEvent.change(camposDeConta()[0], { target: { value: "400" } });
    expect(screen.getByText(/agregação/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Contabilizar 0$/ })).toBeDisabled();
  });

  it("⚠ conta boa habilita o botão com a contagem certa", () => {
    montar();
    fireEvent.change(camposDeConta()[0], { target: { value: "401" } });
    expect(screen.getByRole("button", { name: /^Contabilizar 1$/ })).toBeEnabled();
  });
});

describe("⚠⚠ o envio: N chamadas, uma por linha", () => {
  it("manda `contaAplicada` em codigoCompleto — e NÃO manda a data", async () => {
    const { aoEnviarLinha } = montar({ itens: [linha({ sugestao: { conta: "411020001" } })] });
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 1$/ }));

    await waitFor(() => expect(aoEnviarLinha).toHaveBeenCalledTimes(1));
    expect(aoEnviarLinha).toHaveBeenCalledWith("d-1", { contaAplicada: "411020001" });
    // ⚠⚠ A DATA NÃO VIAJA. `lerPagamentoDoCorpo` decide por `hasOwnProperty`: reenviá-la apagaria o
    // `OFX` e transformaria PROVA em DECLARAÇÃO.
    const corpo = aoEnviarLinha.mock.calls[0][1];
    expect(Object.prototype.hasOwnProperty.call(corpo, "dataPagamento")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(corpo, "origemPagamento")).toBe(false);
  });

  it("uma chamada POR LINHA, com o id de cada uma", async () => {
    const { aoEnviarLinha, aoConcluir } = montar({
      itens: [
        linha({ id: "d-1", sugestao: { conta: "411020001" } }),
        linha({ id: "d-2", sugestao: { conta: "411020002" }, descricaoOriginal: "DOIS" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 2$/ }));

    await waitFor(() => expect(aoEnviarLinha).toHaveBeenCalledTimes(2));
    expect(aoEnviarLinha.mock.calls.map((c) => c[0])).toEqual(["d-1", "d-2"]);
    // ⚠ a fila recarrega UMA vez, depois do laço — não por linha
    await waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
  });

  it("⚠⚠ SUCESSO PARCIAL: a que passou diz 'contabilizada', a que falhou mostra o motivo do SERVIDOR", async () => {
    const aoEnviarLinha = jest.fn(async (id) => {
      if (id === "d-2") throw new Error("A competência está fechada.");
      return { ok: true };
    });
    montar({
      itens: [
        linha({ id: "d-1", sugestao: { conta: "411020001" }, descricaoOriginal: "UM" }),
        linha({ id: "d-2", sugestao: { conta: "411020002" }, descricaoOriginal: "DOIS" }),
      ],
      aoEnviarLinha,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 2$/ }));

    await waitFor(() => expect(screen.getByText(/A competência está fechada\./)).toBeInTheDocument());
    const um = screen.getByText("UM").closest("tr");
    expect(within(um).getByText("contabilizada")).toBeInTheDocument();
    // ⚠ e o rodapé conta as duas coisas — "falhou" sozinho faria reenviar a que deu certo
    expect(screen.getByText(/1 contabilizada\(s\) · 1 recusada\(s\)/)).toBeInTheDocument();
  });

  // ⚠⚠ ACHADO NO NAVEGADOR, não no teste — e é por isso que este bloco existe.
  //
  // O teste media a CHAMADA (que já estava certa: o laço pulava as concluídas) e não o RÓTULO. Com
  // tudo contabilizado, o botão continuava dizendo "Contabilizar 4", habilitado, e o clique não
  // fazia nada. Botão que não faz nada é pior que botão ausente.
  it("⚠⚠ terminado o lote, o botão zera a contagem e DESABILITA com o motivo", async () => {
    const { aoEnviarLinha } = montar({ itens: [linha({ sugestao: { conta: "411020001" } })] });
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 1$/ }));
    await waitFor(() => expect(aoEnviarLinha).toHaveBeenCalledTimes(1));

    const botao = await screen.findByRole("button", { name: /^Contabilizar 0$/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/já foram contabilizadas/i));
  });

  it("⚠ e os dois zeros do botão pedem consertos diferentes — a frase os distingue", () => {
    // sem conta escolhida: o conserto é escolher uma, não fechar o modal.
    montar();
    expect(screen.getByRole("button", { name: /^Contabilizar 0$/ }))
      .toHaveAttribute("title", expect.stringMatching(/Nenhuma linha tem conta escolhida/i));
  });

  it("⚠ a linha recusada CONTINUA reenviável — a falha pode ser transitória", async () => {
    let tentativas = 0;
    const aoEnviarLinha = jest.fn(async () => {
      tentativas += 1;
      if (tentativas === 1) throw new Error("A rede caiu.");
      return { ok: true };
    });
    montar({ itens: [linha({ sugestao: { conta: "411020001" } })], aoEnviarLinha });

    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 1$/ }));
    await waitFor(() => expect(screen.getByText(/A rede caiu\./)).toBeInTheDocument());
    // ⚠⚠ O botão NÃO zera aqui: recusada não é concluída, e mandar fechar seria perder o trabalho.
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 1$/ }));
    await waitFor(() => expect(screen.getByText("contabilizada")).toBeInTheDocument());
    expect(aoEnviarLinha).toHaveBeenCalledTimes(2);
  });
});

describe("⚠ os impedimentos da fila valem aqui", () => {
  it("mês fechado fica de fora com a frase do pré-voo, não uma segunda", () => {
    montar({ itens: [linha({ mesFechado: true })] });
    expect(screen.getByText(/Reabra o mês/i)).toBeInTheDocument();
  });

  it("⚠⚠ nota sem data de pagamento fica de fora — o POST voltaria `sem_data_de_pagamento`", () => {
    montar({ itens: [linha({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null })] });
    expect(camposDeConta()).toHaveLength(0);
    expect(screen.getByText(/declaração sua/i)).toBeInTheDocument();
  });

  it("⚠ quem não pode escrever não tem lote nenhum", () => {
    montar({ podeEscrever: false });
    expect(camposDeConta()).toHaveLength(0);
    expect(screen.getByText(/Seu perfil não pode alterar/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O DESFECHO QUE NÃO VOLTOU — e o fecho total que ele causava.
//
// Medido por agente adversarial em 27/08/2026: com um `aoEnviarLinha` que nunca assenta, o laço
// ficava preso, `enviando` nunca voltava, e o `ocupado` do `Modal` desligava as TRÊS saídas (✕, Esc,
// fundo) com o `Cancelar` também desabilitado. Só recarregando a página.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a linha que não responde", () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
  afterEach(() => jest.useRealTimers());

  it("⚠⚠ o modal DESTRAVA sozinho — e a linha vira 'sem resposta', nunca 'recusada'", async () => {
    // uma promessa que nunca assenta: é a conexão pendurada
    const aoEnviarLinha = jest.fn(() => new Promise(() => {}));
    montar({ itens: [linha({ sugestao: { conta: "411020001" } })], aoEnviarLinha });

    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 1$/ }));
    await waitFor(() => expect(aoEnviarLinha).toHaveBeenCalled());

    await act(async () => { jest.advanceTimersByTime(46_000); });

    // ⚠⚠ "sem resposta" e NÃO "recusada": o pedido saiu, e esta linha PODE ter virado lançamento.
    await waitFor(() => expect(screen.getAllByText(/sem resposta/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/recusou esta linha/i)).not.toBeInTheDocument();
    // ⚠⚠ E AS SAÍDAS VOLTAM — é o ponto deste teste. Enquanto `enviando` fica preso, `ocupado`
    // desliga o ✕, o Esc e o clique no fundo de uma vez, e o único caminho é recarregar a página.
    // ⚠ São dois "Fechar": o ✕ do primitivo e o do rodapé. Os DOIS têm de voltar — é justamente o
    // conjunto que `ocupado` desliga.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Contabilizando…/ })).not.toBeInTheDocument());
    for (const b of screen.getAllByRole("button", { name: /^Fechar$/ })) expect(b).toBeEnabled();
  });

  it("⚠⚠ o lote PARA na indeterminada — as seguintes ficam sem tentativa, que é a verdade", async () => {
    const aoEnviarLinha = jest.fn(() => new Promise(() => {}));
    montar({
      itens: [
        linha({ id: "d-1", sugestao: { conta: "411020001" } }),
        linha({ id: "d-2", sugestao: { conta: "411020002" }, descricaoOriginal: "SEGUNDA" }),
      ],
      aoEnviarLinha,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 2$/ }));
    await waitFor(() => expect(aoEnviarLinha).toHaveBeenCalledTimes(1));

    await act(async () => { jest.advanceTimersByTime(46_000); });

    await waitFor(() => expect(screen.getAllByText(/sem resposta/i).length).toBeGreaterThan(0));
    // ⚠ a segunda nunca foi tentada — continuar depois de um desfecho desconhecido é seguir sem
    // saber onde se está (o precedente da emissão em lote de NFS-e).
    expect(aoEnviarLinha).toHaveBeenCalledTimes(1);
    const segunda = screen.getByText("SEGUNDA").closest("tr");
    expect(within(segunda).getByText("—")).toBeInTheDocument();
  });
});

describe("⚠⚠ o caixa torto derruba TODA linha da empresa — e o lote precisa dizer isso", () => {
  // `111010001` é a contrapartida cravada de `montarLancamento`; sem ela no plano, o servidor
  // recusa cada linha, por mais certa que esteja a conta escolhida.
  const SEM_CAIXA = PLANO.filter((c) => c.codigoCompleto !== "111010001");

  it("⚠⚠ o botão NÃO promete o envio, e o motivo sai VISÍVEL — não só no `title`", () => {
    montar({ contas: SEM_CAIXA, itens: [linha({ sugestao: { conta: "411020001" } })] });
    const botao = screen.getByRole("button", { name: /^Contabilizar 0$/ });
    expect(botao).toBeDisabled();
    expect(screen.getAllByRole("alert").some((e) => /caixa/i.test(e.textContent))).toBe(true);
  });

  it("⚠ com o caixa são, o mesmo lote envia normalmente", () => {
    montar({ itens: [linha({ sugestao: { conta: "411020001" } })] });
    expect(screen.getByRole("button", { name: /^Contabilizar 1$/ })).toBeEnabled();
  });

  it("⚠⚠ plano que FALHOU não vira 'esta empresa não tem plano de contas'", () => {
    montar({ contas: [], estadoDoPlano: "falhou" });
    expect(screen.getAllByRole("alert").some((e) => /não foi possível carregar/i.test(e.textContent))).toBe(true);
  });
});

describe("⚠ a fila é paginada e o modal só vê a página", () => {
  it("⚠⚠ ele DIZ isso — número menor sem explicação se lê como despesa perdida", () => {
    montar({ itens: [linha()], totalDaFila: 137 });
    expect(screen.getByText(/1.*das.*137.*linhas da fila|Este lote vê/i)).toBeInTheDocument();
  });

  it("⚠ sem truncamento, não há aviso nenhum", () => {
    montar({ itens: [linha()], totalDaFila: 1 });
    expect(screen.queryByText(/Este lote vê/i)).not.toBeInTheDocument();
  });

  it("⚠ `total` ausente NÃO vira zero nem inventa aviso", () => {
    montar({ itens: [linha()] });
    expect(screen.queryByText(/Este lote vê/i)).not.toBeInTheDocument();
  });
});

describe("⚠ o limite da exclusão é DITO, não suposto", () => {
  it("⚠⚠ a tela avisa que a nota paga à mão não é reconhecida como par do débito", () => {
    montar();
    expect(screen.getByText(/já informou o pagamento de alguma nota/i)).toBeInTheDocument();
  });
});

describe("⚠ o filtro 'só as sem conta'", () => {
  it("esconde as preenchidas sem tirá-las do envio", async () => {
    const { aoEnviarLinha } = montar({
      itens: [
        linha({ id: "d-1", sugestao: { conta: "411020001" }, descricaoOriginal: "COM CONTA" }),
        linha({ id: "d-2", descricaoOriginal: "SEM CONTA" }),
      ],
    });
    fireEvent.click(screen.getByLabelText(/Mostrar só as sem conta/i));
    expect(screen.queryByText("COM CONTA")).not.toBeInTheDocument();
    expect(screen.getByText("SEM CONTA")).toBeInTheDocument();

    // ⚠⚠ ESCONDER NÃO É EXCLUIR: a linha preenchida continua no envio.
    fireEvent.click(screen.getByRole("button", { name: /^Contabilizar 1$/ }));
    await waitFor(() => expect(aoEnviarLinha).toHaveBeenCalledWith("d-1", { contaAplicada: "411020001" }));
  });
});
