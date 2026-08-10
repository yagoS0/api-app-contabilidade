// O CAMPO VAZIO PRECISA APARECER VAZIO — e o gate por soma tem de continuar valendo.
//
// A memória de apuração (`ApuracaoConfigMemory`) deixou de guardar o VALOR: ela tem chave
// `portalClientId` e nenhuma competência, então o valor de um mês era carregado para dentro de
// outro (medido em produção: 48 de 85 competências com faturamento abriam com número de outro mês, e
// 10 de 10 competências SEM faturamento abriam com valor > 0). Hoje o valor vem do faturamento da
// própria competência — e, quando a forma lembrada tem 2+ atividades, ele vem `null`, porque não
// existe regra de rateio e inventar uma seria o portal chutando o que vai numa declaração.
//
// ⚠ ESTE ARQUIVO EXISTE POR CAUSA DE UMA EXPRESSÃO: `value={a.valorInterno || 0}` renderiza **0**
// para `null`/`undefined`. Sem o `?? ""`, o "vazio" do backend nunca chega à tela: a mudança inteira
// ficaria invisível, com um zero fabricado no lugar do campo em branco — e o contador confirmaria
// esse zero achando que alguém o conferiu.
//
// ⚠ E a segunda metade: com valor `null` a soma tem de continuar zero, senão o gate por SOMA
// (7b341aad) some — é ele que faz a caixa "Declarar SEM MOVIMENTO" renderizar e o Calcular parar
// antes da chamada PAGA ao SERPRO.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FechamentoModal } from "../FechamentoModal.jsx";

const FORMA_DUAS_ATIVIDADES = [
  { idAtividade: 11, descricao: "Serviços sujeitos ao Fator R", anexoImplicito: "III", mercado: "INTERNO", sujeitoFatorR: true, valorInterno: null, valorExterno: null },
  { idAtividade: 1, descricao: "Revenda de mercadorias", anexoImplicito: "I", mercado: "INTERNO", sujeitoFatorR: false, valorInterno: null, valorExterno: null },
];

function dadosBase(over = {}) {
  return {
    razao: "CDA MARKETING LTDA", cnpj: "65.227.792/0001-00",
    regimeApuracao: "COMPETENCIA", cadastroCompleto: true,
    faturamento: { interno: 0, externo: 9000, total: 9000 },
    semMovimentoDisponivel: false, empresaZerada: false, semFaturamento: false,
    entregaPgdas: {}, disparidades: [], rbt12: 480000, estado: "aberta",
    atividades: FORMA_DUAS_ATIVIDADES,
    origemAtividades: "memoria(2026-07-31)",
    prefillValor: {
      total: 9000, indefinido: true, mercadoAplicado: null, origem: "faturamento_da_competencia",
      motivo: "A configuração lembrada desta empresa tem 2 atividades, e o portal não tem como saber "
        + "quanto do faturamento da competência cabe a cada uma — não existe regra de rateio. "
        + "Preencha os valores.",
    },
    ...over,
  };
}

function montar(over = {}, apiOver = {}) {
  const calcularFechamento = jest.fn(async () => ({ ok: true, result: { dasValor: 0 } }));
  const api = {
    getFechamento: jest.fn(async () => ({ ok: true, dados: dadosBase(over) })),
    listAtividadesPgdasd: jest.fn(async () => ({ ok: true, atividades: [] })),
    calcularFechamento,
    ...apiOver,
  };
  render(
    <FechamentoModal
      api={api} feedback={{}} portalClientId="p1" competencia="2026-07"
      razao="CDA MARKETING LTDA" onClose={() => {}} onChanged={() => {}}
    />,
  );
  return { api, calcularFechamento };
}

/** Os inputs de valor da tabela de atividades, na ordem: [int1, ext1, int2, ext2, …]. */
function camposDeValor() {
  return screen.getAllByPlaceholderText("—");
}

describe("valor indefinido — o campo aparece VAZIO, com o motivo", () => {
  it("⚠ `null` renderiza campo VAZIO, nunca 0", async () => {
    montar();
    await screen.findByText(/Revenda de mercadorias/);
    for (const campo of camposDeValor()) expect(campo).toHaveValue(null);
  });

  it("o motivo do vazio aparece na tela — campo em branco sem explicação parece campo quebrado", async () => {
    montar();
    expect(await screen.findByText(/não existe regra de rateio/i)).toBeInTheDocument();
  });

  it("⚠ 7b341aad — com valor vazio a soma é ZERO e o Calcular fica bloqueado, nomeando o motivo", async () => {
    // O gate por soma é o que impede a chamada PAGA. Com o valor fantasma da memória antiga
    // (`somaAtividades > 0`) ele não disparava: era exatamente este o estrago em produção.
    const { calcularFechamento } = montar();
    await screen.findByText(/Revenda de mercadorias/);
    const botao = screen.getByRole("button", { name: /Calcular/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/preencha os valores/i));
    fireEvent.click(botao);
    expect(calcularFechamento).not.toHaveBeenCalled();
  });

  it("⚠ 7b341aad — sem faturamento, a caixa 'Declarar SEM MOVIMENTO' RENDERIZA com valor vazio", async () => {
    // Era o efeito colateral mais caro do valor guardado: soma > 0 escondia a caixa numa competência
    // sem uma única nota, e o Calcular saía habilitado.
    montar({
      faturamento: { interno: 0, externo: 0, total: 0 },
      semMovimentoDisponivel: true,
      prefillValor: { total: 0, indefinido: true, motivo: "sem rateio", mercadoAplicado: null, origem: "faturamento_da_competencia" },
    });
    expect(await screen.findByText(/Declarar SEM MOVIMENTO/i)).toBeInTheDocument();
  });

  it("⚠ apagar o campo NÃO grava 0 — `Number('') || 0` seria uma afirmação inventada", async () => {
    montar();
    await screen.findByText(/Revenda de mercadorias/);
    const [interno] = camposDeValor();
    fireEvent.change(interno, { target: { value: "500" } });
    expect(interno).toHaveValue(500);
    fireEvent.change(interno, { target: { value: "" } });
    expect(interno).toHaveValue(null);
  });
});

describe("valor definido — vem do faturamento da PRÓPRIA competência, no mercado lembrado", () => {
  const UMA_EXTERNA = [{
    idAtividade: 30, descricao: "Prestação de serviços ao exterior", anexoImplicito: "III",
    mercado: "EXTERNO", sujeitoFatorR: true, valorInterno: 0, valorExterno: 9000,
  }];

  function comMercadoExterno() {
    return montar({
      atividades: UMA_EXTERNA,
      prefillValor: { total: 9000, indefinido: false, motivo: null, mercadoAplicado: "EXTERNO", origem: "faturamento_da_competencia" },
    });
  }

  it("⚠ O MERCADO EXTERNO CHEGA À TELA — o valor está na coluna Externo, não na Interno", async () => {
    // `flagExportacao` nunca é escrita para NFS-e, então o faturamento chega ao fechamento como se
    // fosse interno. Só a memória sabe que a CDA presta serviço ao exterior; se o mercado se perder,
    // a declaração seguinte nasce interna.
    comMercadoExterno();
    await screen.findByText(/Prestação de serviços ao exterior/);
    const [interno, externo] = camposDeValor();
    expect(interno).toHaveValue(0);
    expect(externo).toHaveValue(9000);
  });

  it("a tela diz de onde veio o número e em que mercado ele entrou", async () => {
    comMercadoExterno();
    expect(await screen.findByText(/desta competência/i)).toBeInTheDocument();
    expect(screen.getByText("EXTERNO")).toBeInTheDocument();
  });

  it("com valor preenchido o Calcular é liberado e o payload leva os valores", async () => {
    const { calcularFechamento } = comMercadoExterno();
    await screen.findByText(/Prestação de serviços ao exterior/);
    const botao = screen.getByRole("button", { name: /Calcular/i });
    expect(botao).not.toBeDisabled();
    fireEvent.click(botao);
    await waitFor(() => expect(calcularFechamento).toHaveBeenCalled());
    const [, , payload] = calcularFechamento.mock.calls[0];
    expect(payload.atividades[0]).toMatchObject({ idAtividade: 30, valorExterno: 9000 });
    expect(payload.semMovimento).toBe(false);
  });
});
