// AS ABAS DE REGIME NA PÁGINA PRINCIPAL — a LIGAÇÃO, não as regras.
//
// A regra ("qual aba esta empresa ocupa", "quando `Outros` aparece") tem teste próprio em
// `lib/__tests__/abaRegime.test.js`. Aqui se prova o que só a tela pode provar:
//
//   1. as abas aparecem ACIMA da tabela, com a contagem da lista JÁ filtrada;
//   2. trocar de aba troca as linhas — são duas tabelas, não uma com rótulo diferente;
//   3. ⚠ trocar de aba PODA A SELEÇÃO e a poda é DITA (a barra some junto com a seleção vazia, e
//      sem o aviso solto as marcações sumiriam em silêncio);
//   4. ⚠ o filtro "Regime" saiu INTEIRO — nem `<select>`, nem chip, nem contagem no botão;
//   5. ⚠ a aba ativa sai no CABEÇALHO IMPRESSO;
//   6. a escolha da aba PERSISTE em `localStorage` (⚠ o modo de VISÃO não persiste mais);
//   7. `Ano` e `Calendário` não ganham abas — são o outro eixo (o tempo).
//
// E a barra de ações depois do pedido de 18/08/2026: hambúrguer com gaveta lateral nascendo
// FECHADA, Apuração e Consultas dentro dela, e o botão de envio de e-mails em lote fora da barra.

import { render, screen, fireEvent, within } from "@testing-library/react";
import { CompaniesHomePage } from "../renderCompaniesHomePage.jsx";

function empresa(companyId, razao, regime, over = {}) {
  return {
    companyId,
    razao,
    cnpj: "11222333000181",
    legacyCompany: regime === undefined ? {} : { regimeTributario: regime, certStorageKey: "k", certExpiresAt: "2099-01-01" },
    guideCompliance: { das: { required: true, state: "gerada", ok: true, guideId: `g-${companyId}` } },
    fiscalSituacao: "REGULAR",
    fiscalCheckedAt: new Date().toISOString(),
    notasEmitidas: { total: 0 },
    apuracao: { apurada: false },
    ...over,
  };
}

const CARTEIRA = [
  empresa("s1", "ALFA SIMPLES LTDA", "SIMPLES"),
  empresa("s2", "BETA SIMPLES LTDA", "SIMPLES"),
  empresa("p1", "GAMA PRESUMIDO LTDA", "LUCRO_PRESUMIDO"),
];

// ⚠⚠ A CARTEIRA ABRE NO CALENDÁRIO desde 01/09/2026, e as abas de REGIME só existem na visão de
// Tabela — o Calendário é o outro eixo (o tempo) e nunca foi recortado por regime. Por isso o
// helper troca de visão logo depois de montar. Sem isso, todo caso aqui mediria a ausência da barra
// de regime numa tela que nunca a teve, e ficaria verde pelo motivo errado.
function irParaTabela() {
  fireEvent.click(screen.getByRole("button", { name: /^Tabela$/ }));
}

function montar(props = {}) {
  const r = render(
    <CompaniesHomePage
      user={{ name: "Contador" }}
      companies={CARTEIRA}
      loadingCompanies={false}
      onCreateCompany={jest.fn()}
      onRefreshCompanies={jest.fn()}
      onOpenCompany={jest.fn()}
      onLogout={jest.fn()}
      dashboardCompetencia="2026-07"
      onChangeCompetencia={jest.fn()}
      api={{}}
      {...props}
    />,
  );
  irParaTabela();
  return r;
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom sempre tem, mas o app não conta com isso */ }
});

/** A barra de abas de regime (a outra é a de visões, hoje só Calendário/Tabela). */
function barraDeRegime() {
  return screen.getByRole("group", { name: "Regime tributário" });
}
function abas() {
  return within(barraDeRegime()).getAllByRole("button").map((b) => b.textContent);
}
function clicarAba(nome) {
  fireEvent.click(within(barraDeRegime()).getByRole("button", { name: new RegExp(nome, "i") }));
}
/** A barra que só existe quando há seleção. */
function barraDeSelecao() {
  return screen.queryByRole("region", { name: /Ações sobre as empresas selecionadas/i });
}
/** As razões sociais das linhas visíveis. */
function razoesVisiveis() {
  return CARTEIRA.map((c) => c.razao).filter((r) => screen.queryByText(r));
}

describe("as abas ficam acima da tabela, com a contagem", () => {
  test("duas abas quando toda a carteira é Simples ou Presumido — `Outros` não aparece", () => {
    montar();
    expect(abas()).toEqual(["●Simples Nacional(2)", "●Lucro Presumido(1)"]);
  });

  test("⚠ a contagem sai da lista JÁ FILTRADA — buscar reduz a aba junto com a tabela", () => {
    montar();
    fireEvent.change(screen.getByPlaceholderText(/Clínica/i), { target: { value: "ALFA" } });
    expect(abas()).toEqual(["●Simples Nacional(1)", "●Lucro Presumido(0)"]);
  });

  test("⚠ `Outros` APARECE quando há empresa fora dos dois regimes, e a linha DIZ por quê", () => {
    montar({ companies: [...CARTEIRA, empresa("x1", "DELTA SEM REGIME LTDA", null)] });
    expect(abas()).toEqual(["●Simples Nacional(2)", "●Lucro Presumido(1)", "●Outros(1)"]);
    clicarAba("Outros");
    expect(screen.getByText("DELTA SEM REGIME LTDA")).toBeInTheDocument();
    expect(screen.getByText("Sem regime cadastrado")).toBeInTheDocument();
  });

  test("empresa de Lucro Real cai em `Outros` com o regime nomeado — não some da carteira", () => {
    montar({ companies: [...CARTEIRA, empresa("r1", "EPSILON REAL LTDA", "LUCRO_REAL")] });
    clicarAba("Outros");
    expect(screen.getByText("EPSILON REAL LTDA")).toBeInTheDocument();
    expect(screen.getByText("Lucro Real")).toBeInTheDocument();
  });
});

describe("são duas tabelas: trocar de aba troca as linhas", () => {
  test("o Simples abre por padrão e mostra só as do Simples", () => {
    montar();
    expect(razoesVisiveis()).toEqual(["ALFA SIMPLES LTDA", "BETA SIMPLES LTDA"]);
  });

  test("o Presumido mostra só as do Presumido", () => {
    montar();
    clicarAba("Lucro Presumido");
    expect(razoesVisiveis()).toEqual(["GAMA PRESUMIDO LTDA"]);
  });

  // ⚠⚠ O CASO "a aba vale também na visão Cards" SAIU EM 01/09/2026 — a visão Cards foi removida
  // do produto a pedido do dono. Ele afirmava que o recorte por regime valia nas DUAS listas da
  // carteira; hoje há uma lista só, e é a Tabela, coberta pelos dois casos acima.

  test("⚠ o Calendário NÃO ganha abas de regime — é o outro eixo, o tempo", () => {
    // ⚠ Este caso media `Ano` até 01/09/2026. `Ano` não é mais uma visão da carteira: virou
    // granularidade DENTRO do Calendário. A afirmação não mudou de conteúdo — mudou o caminho até
    // ela, e agora basta NÃO ir para a Tabela, porque o Calendário é o padrão.
    render(
      <CompaniesHomePage
        user={{ name: "Contador" }}
        companies={CARTEIRA}
        loadingCompanies={false}
        onCreateCompany={jest.fn()}
        onRefreshCompanies={jest.fn()}
        onOpenCompany={jest.fn()}
        onLogout={jest.fn()}
        dashboardCompetencia="2026-07"
        onChangeCompetencia={jest.fn()}
        api={{}}
      />,
    );
    expect(screen.queryByRole("group", { name: "Regime tributário" })).toBeNull();
  });

  // ⚠⚠ ESTE CASO SE CHAMAVA "a escolha PERSISTE, como o modo de visão", e a comparação FICOU FALSA
  // em 01/09/2026: o `modoVisao` DEIXOU de persistir (a carteira abre sempre no Calendário, por
  // decisão do dono). A persistência da ABA continua inteira e é o que este caso mede — só o
  // vizinho que ele citava é que não existe mais.
  test("a escolha da aba PERSISTE em `dashboard:abaRegime`", () => {
    const { unmount } = montar();
    clicarAba("Lucro Presumido");
    expect(localStorage.getItem("dashboard:abaRegime")).toBe("LUCRO_PRESUMIDO");
    unmount();
    montar();
    expect(razoesVisiveis()).toEqual(["GAMA PRESUMIDO LTDA"]);
  });

  test("⚠ aba guardada que não existe mais cai no padrão — a tabela nunca fica vazia sem aba marcada", () => {
    localStorage.setItem("dashboard:abaRegime", "OUTROS"); // ninguém em `Outros` nesta carteira
    montar();
    expect(abas()).toEqual(["●Simples Nacional(2)", "●Lucro Presumido(1)"]);
    expect(razoesVisiveis()).toEqual(["ALFA SIMPLES LTDA", "BETA SIMPLES LTDA"]);
  });
});

describe("⚠ trocar de aba PODA a seleção, e a poda é DITA", () => {
  function marcar(razao) {
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`Selecionar ${razao}`, "i") }));
  }

  test("a empresa marcada no Simples não sobrevive à ida para o Presumido", () => {
    montar();
    marcar("ALFA SIMPLES LTDA");
    expect(barraDeSelecao()).toHaveTextContent("1 empresa selecionada");

    clicarAba("Lucro Presumido");

    // A barra some junto com a seleção — o que não pode sumir é a explicação.
    expect(barraDeSelecao()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 empresa(s) saíram da seleção porque não estão mais nesta lista.",
    );
  });

  test("o aviso é dispensável — ele descreve o que aconteceu, não um estado atual", () => {
    montar();
    marcar("ALFA SIMPLES LTDA");
    clicarAba("Lucro Presumido");
    fireEvent.click(screen.getByRole("button", { name: /Dispensar o aviso/i }));
    expect(screen.queryByText(/saíram da seleção/i)).toBeNull();
  });

  test("⚠ nenhum id invisível sobrevive: voltar para a aba de origem NÃO ressuscita a marcação", () => {
    montar();
    marcar("ALFA SIMPLES LTDA");
    clicarAba("Lucro Presumido");
    clicarAba("Simples Nacional");
    expect(barraDeSelecao()).toBeNull();
  });

  test('"selecionar todos" marca a aba ATIVA, não a carteira inteira', () => {
    montar();
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar as 2 empresas desta lista/i }));
    expect(barraDeSelecao()).toHaveTextContent("2 empresas selecionadas");
  });
});

describe("⚠ o filtro Regime saiu INTEIRO", () => {
  test("não há `<select>` de Regime no painel de Filtros", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    expect(screen.queryByLabelText(/^Regime$/i)).toBeNull();
    expect(screen.getByLabelText(/Situação fiscal/i)).toBeInTheDocument(); // os outros continuam
  });

  test("a aba NÃO conta como filtro ativo — ela é navegação, não recorte removível", () => {
    montar();
    clicarAba("Lucro Presumido");
    // Sem "(N)" no botão e sem chip removível: o critério do projeto vale para filtro escondido,
    // e uma aba desenhada em cima da tabela é o oposto de escondida.
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
    // O chip removível é um BOTÃO ("Situação fiscal: com pendência ✕"). Nenhum deles fala de
    // regime. (O "Regime:" que existe no DOM é o do cabeçalho IMPRESSO, que é onde ele deve estar.)
    expect(screen.queryByRole("button", { name: /Regime:/i })).toBeNull();
  });

  test("um filtro de verdade continua contando e virando chip", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    fireEvent.change(screen.getByLabelText(/Situação fiscal/i), { target: { value: "comPendencia" } });
    expect(screen.getByRole("button", { name: "Filtros (1)" })).toBeInTheDocument();
  });
});

describe("⚠ o VAZIO da aba não pode dizer a coisa errada", () => {
  test("aba sem ninguém em toda a carteira: diz que a ABA está vazia, não que a carteira está", () => {
    // Mandar "cadastre a primeira empresa" a quem tem a carteira cheia é a ausência respondendo à
    // pergunta errada.
    montar({ companies: [CARTEIRA[0], CARTEIRA[1]] }); // só Simples
    clicarAba("Lucro Presumido");
    expect(screen.getByText(/Nenhuma empresa de/i)).toHaveTextContent("Nenhuma empresa de Lucro Presumido nesta carteira.");
    expect(screen.queryByText(/Nenhuma empresa nesta carteira ainda/i)).toBeNull();
  });

  test("⚠ o denominador do \"Exibindo X de N\" é a ABA — senão o botão `Limpar filtros` prometeria trazer quem está na outra", () => {
    montar();
    // 2 do Simples, sem filtro nenhum: nada de "Exibindo 2 de 3" com um botão que não resolve.
    expect(screen.queryByText(/Exibindo/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
  });

  test("filtro de verdade dentro da aba continua contando e oferecendo a limpeza", () => {
    montar();
    fireEvent.change(screen.getByPlaceholderText(/Clínica/i), { target: { value: "ALFA" } });
    expect(screen.getByText(/Exibindo/)).toHaveTextContent("Exibindo 1 de 2 empresas");
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });
});

describe("⚠ a folha impressa DIZ de qual aba ela é", () => {
  test("o cabeçalho do papel nomeia o regime e conta as empresas daquela aba", () => {
    const { container } = montar();
    const cabecalho = container.querySelector("[data-print-only]");
    expect(cabecalho).toHaveTextContent("Regime: Simples Nacional");
    expect(cabecalho).toHaveTextContent("2 empresa(s)");
  });

  test("trocar de aba troca o que o papel afirma", () => {
    const { container } = montar();
    clicarAba("Lucro Presumido");
    const cabecalho = container.querySelector("[data-print-only]");
    expect(cabecalho).toHaveTextContent("Regime: Lucro Presumido");
    expect(cabecalho).toHaveTextContent("1 empresa(s)");
  });
});

describe("a barra de ações e a gaveta lateral (dono, 18/08/2026)", () => {
  const handlers = {
    onOpenApuracao: jest.fn(),
    onOpenSerproFuncoes: jest.fn(),
    onOpenRotinas: jest.fn(),
    onOpenPlanejamento: jest.fn(),
    onOpenObrigacoes: jest.fn(),
    onOpenGuideSettings: jest.fn(),
    onOpenChartGlobal: jest.fn(),
    onOpenPendingReport: jest.fn(),
    onOpenBatchEmail: jest.fn(),
    onOpenOnboardings: jest.fn(),
  };
  const abrirGaveta = () => fireEvent.click(screen.getByRole("button", { name: /Abrir o menu de ferramentas/i }));

  test("⚠ a gaveta NASCE FECHADA — a cada carregamento, sem lembrar da última vez", () => {
    montar(handlers);
    expect(screen.queryByRole("dialog", { name: /Ferramentas e configurações/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Abrir o menu de ferramentas/i }))
      .toHaveAttribute("aria-expanded", "false");
  });

  test("na barra do topo sobram só `Nova empresa` e `Onboardings` (fora o hambúrguer)", () => {
    montar(handlers);
    const barra = screen.getByRole("navigation", { name: "Atalhos" });
    expect(within(barra).getByRole("button", { name: /Nova empresa/i })).toBeInTheDocument();
    expect(within(barra).getByRole("button", { name: "Onboardings" })).toBeInTheDocument();
    expect(within(barra).queryByRole("button", { name: /Envio de e-mails em lote/i })).toBeNull();
    expect(within(barra).queryByRole("button", { name: "Apuração" })).toBeNull();
    expect(within(barra).queryByRole("button", { name: "Consultas" })).toBeNull();
  });

  test("⚠ Apuração e Consultas MUDARAM DE LUGAR, não sumiram — mesmo rótulo, mesmo handler", () => {
    montar(handlers);
    abrirGaveta();
    const gaveta = screen.getByRole("dialog", { name: /Ferramentas e configurações/i });
    expect(within(gaveta).getByText("Ferramentas")).toBeInTheDocument();
    expect(within(gaveta).getByText("Configurações")).toBeInTheDocument();
    for (const rotulo of ["Apuração", "Consultas", "Rotinas", "Planejamento",
      "Obrigações do escritório", "Configuração SERPRO", "Plano de Contas Global", "Pendências de e-mail"]) {
      expect(within(gaveta).getByRole("button", { name: rotulo })).toBeInTheDocument();
    }
    fireEvent.click(within(gaveta).getByRole("button", { name: "Consultas" }));
    expect(handlers.onOpenSerproFuncoes).toHaveBeenCalled();
  });

  test("o hambúrguer anuncia o que controla, e fecha pelo Esc devolvendo o foco", () => {
    montar(handlers);
    const botao = screen.getByRole("button", { name: /Abrir o menu de ferramentas/i });
    expect(botao).toHaveAttribute("aria-controls", "dashboard-gaveta");
    abrirGaveta();
    expect(screen.getByRole("dialog", { name: /Ferramentas e configurações/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Ferramentas e configurações/i })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Abrir o menu de ferramentas/i }));
  });

  test("item sem handler não vira linha — nada de oferecer função que não existe aqui", () => {
    montar({ ...handlers, onOpenRotinas: undefined });
    abrirGaveta();
    const gaveta = screen.getByRole("dialog", { name: /Ferramentas e configurações/i });
    expect(within(gaveta).queryByRole("button", { name: "Rotinas" })).toBeNull();
  });
});
