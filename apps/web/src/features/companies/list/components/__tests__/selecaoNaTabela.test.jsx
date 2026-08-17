// A SELEÇÃO NA TABELA E A BARRA QUE NASCE DELA — a LIGAÇÃO, não as regras.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// O defeito que a seleção conserta foi nomeado pelo dono: *"'Envio de e-mails em lote' não diz para
// quem vai enviar"*. Trocar isso por uma seleção só resolve se três coisas forem verdade na tela:
//
//   1. "selecionar todos" respeita o FILTRO ativo — filtrado em 4, seleciona 4, e o rótulo diz 4;
//   2. nada sai antes da PRÉVIA e da CONFIRMAÇÃO, e a confirmação repete os números;
//   3. ação indisponível aparece com o motivo EM TEXTO — `title` não conta (não é descobrível,
//      some ao mover o mouse e não existe no toque).

import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { CompaniesTable } from "../renderCompaniesTable.jsx";
import { BarraSelecaoEmpresas } from "../BarraSelecaoEmpresas.jsx";

function empresa(over = {}) {
  return {
    companyId: "c1",
    razao: "ACME LTDA",
    cnpj: "11222333000181",
    legacyCompany: { regimeTributario: "SIMPLES", certStorageKey: "k", certExpiresAt: "2099-01-01" },
    guideCompliance: { das: { required: true, state: "gerada", ok: true, guideId: "g1" } },
    fiscalSituacao: "REGULAR",
    fiscalCheckedAt: new Date().toISOString(),
    notasEmitidas: { total: 0 },
    apuracao: { apurada: false },
    ...over,
  };
}

// ─── A TABELA ─────────────────────────────────────────────────────────────────────────────────

function montarTabela(props = {}) {
  return render(
    <CompaniesTable
      companies={[empresa()]}
      travas={null}
      competencia="2026-07"
      onOpenCompany={jest.fn()}
      acoesGuia={{}}
      busca=""
      {...props}
    />,
  );
}

describe("a coluna de seleção só existe quando a página a oferece", () => {
  test("⚠ sem os handlers, NENHUMA caixa aparece — a tabela continua exatamente o que era", () => {
    montarTabela();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  test("a caixa da linha carrega o NOME da empresa — 'Selecionar' trinta vezes não distingue nada", () => {
    montarTabela({ selecionados: new Set(), onAlternarSelecao: jest.fn(), onSelecionarTodos: jest.fn() });
    expect(screen.getByRole("checkbox", { name: "Selecionar ACME LTDA" })).toBeInTheDocument();
  });

  test("clicar na caixa da linha avisa a página com o id — a tabela não guarda a seleção", () => {
    const onAlternarSelecao = jest.fn();
    montarTabela({ selecionados: new Set(), onAlternarSelecao, onSelecionarTodos: jest.fn() });
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar ACME LTDA" }));
    expect(onAlternarSelecao).toHaveBeenCalledWith("c1");
  });
});

describe('⚠ "SELECIONAR TODOS" RESPEITA O FILTRO — e o rótulo diz o número real', () => {
  // `companies` chega FILTRADO da página. Um "todos" que alcançasse a carteira inteira mandaria
  // guia para empresa que o contador não está mais vendo.
  const quatro = ["a", "b", "c", "d"].map((id, i) => empresa({ companyId: id, razao: `EMPRESA ${i}` }));

  test("com 4 linhas na lista, o rótulo diz 4 — não 33", () => {
    montarTabela({
      companies: quatro,
      totalSemFiltro: 33, // a carteira inteira tem 33; o recorte tem 4
      selecionados: new Set(),
      onAlternarSelecao: jest.fn(),
      onSelecionarTodos: jest.fn(),
    });
    expect(screen.getByRole("checkbox", { name: "Selecionar as 4 empresas desta lista" })).toBeInTheDocument();
    // A tabela continua declarando os dois números, que é o que evita o relato "o chip diz 33".
    expect(screen.getByText(/de 33 empresas/)).toBeInTheDocument();
  });

  test("marcar todos entrega EXATAMENTE os ids do recorte", () => {
    const onSelecionarTodos = jest.fn();
    montarTabela({ companies: quatro, totalSemFiltro: 33, selecionados: new Set(), onAlternarSelecao: jest.fn(), onSelecionarTodos });
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar as 4 empresas/ }));
    expect(onSelecionarTodos).toHaveBeenCalledWith(["a", "b", "c", "d"], true);
  });

  test("com todos marcados, o clique DESMARCA os mesmos ids", () => {
    const onSelecionarTodos = jest.fn();
    montarTabela({
      companies: quatro, selecionados: new Set(["a", "b", "c", "d"]),
      onAlternarSelecao: jest.fn(), onSelecionarTodos,
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar as 4 empresas/ }));
    expect(onSelecionarTodos).toHaveBeenCalledWith(["a", "b", "c", "d"], false);
  });

  test("parte marcada → estado intermediário (senão 'algumas' e 'nenhuma' ficam iguais)", () => {
    montarTabela({ companies: quatro, selecionados: new Set(["a"]), onAlternarSelecao: jest.fn(), onSelecionarTodos: jest.fn() });
    const todos = screen.getByRole("checkbox", { name: /Selecionar as 4 empresas/ });
    expect(todos.indeterminate).toBe(true);
    expect(todos.checked).toBe(false);
  });

  test("⚠ as FECHADAS entram no 'todos' mesmo colapsadas — e o rótulo avisa que estão lá", () => {
    const fechada = empresa({ companyId: "z", razao: "FECHADA LTDA", fechamentoContabil: { fechado: true } });
    const onSelecionarTodos = jest.fn();
    montarTabela({
      companies: [...quatro, fechada], selecionados: new Set(),
      onAlternarSelecao: jest.fn(), onSelecionarTodos,
    });
    const todos = screen.getByRole("checkbox", { name: /Selecionar as 5 empresas desta lista \(1 no grupo Fechadas, recolhido\)/ });
    fireEvent.click(todos);
    expect(onSelecionarTodos.mock.calls[0][0]).toContain("z");
  });
});

// ─── A BARRA ──────────────────────────────────────────────────────────────────────────────────

const RELATORIO = {
  competencia: "2026-07",
  simples: [{
    portalClientId: "c1", razao: "ACME LTDA", cnpj: "1", competencia: "2026-07",
    tiposGuias: { DAS: { guideId: "g1" } }, pendingGuideIds: ["g1"],
  }],
  presumidos: [{
    portalClientId: "c2", razao: "BETA LTDA", cnpj: "2", competencia: "2026-07",
    tiposGuias: { IRPJ: { guideId: "g2" }, CSLL: { guideId: "g3" } }, pendingGuideIds: ["g2", "g3"],
  }],
  outros: [],
};

function apiFalso(over = {}) {
  return {
    getBatchEmailReport: jest.fn().mockResolvedValue(RELATORIO),
    sendBatchEmails: jest.fn().mockResolvedValue({ ok: true, sent: 2 }),
    criarApuracaoBatch: jest.fn(),
    createNotasCaptura: jest.fn(),
    createNotasDownload: jest.fn().mockResolvedValue({ ok: true, jobId: "j1" }),
    createSitfisDownload: jest.fn(),
    ...over,
  };
}

async function montarBarra({ empresas, api = apiFalso(), ...props } = {}) {
  const utils = render(
    <BarraSelecaoEmpresas
      api={api}
      empresasSelecionadas={empresas || [empresa()]}
      competencia="2026-07"
      jobsAtivos={0}
      onLimparSelecao={jest.fn()}
      onConcluido={jest.fn()}
      {...props}
    />,
  );
  return { ...utils, api };
}

describe("a barra diz PARA QUANTAS — e por que uma ação não se aplica", () => {
  test("sem seleção a barra não existe", async () => {
    await montarBarra({ empresas: [] });
    expect(screen.queryByRole("region", { name: /empresas selecionadas/i })).not.toBeInTheDocument();
  });

  test("com seleção, o número aparece junto da competência", async () => {
    await montarBarra({ empresas: [empresa(), empresa({ companyId: "c2", razao: "BETA LTDA" })] });
    expect(screen.getByText("2 empresas selecionadas")).toBeInTheDocument();
    expect(screen.getByText(/competência 07\/2026/)).toBeInTheDocument();
  });

  test("⚠ ação indisponível aparece DESABILITADA e com o motivo EM TEXTO, não só no `title`", async () => {
    // Lucro Presumido não apura neste portal — a ação não some, ela explica.
    await montarBarra({
      empresas: [empresa({ legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO", certStorageKey: "k" } })],
    });
    expect(screen.getByRole("button", { name: /Apurar e transmitir/ })).toBeDisabled();
    expect(screen.getByText(/nenhuma das 1 empresa selecionada se aplica/)).toBeInTheDocument();
  });

  test("⚠ com processo em segundo plano, as ações que criam JOB travam — com o motivo", async () => {
    await montarBarra({ jobsAtivos: 1 });
    expect(screen.getByRole("button", { name: /Baixar XMLs/ })).toBeDisabled();
    expect(screen.getAllByText(/1 processo em segundo plano/).length).toBeGreaterThan(0);
  });

  test("a poda pelo filtro NÃO é silenciosa", async () => {
    await montarBarra({ avisoDeRecorte: "12 empresa(s) saíram da seleção porque não estão mais nesta lista." });
    expect(screen.getByText(/12 empresa\(s\) saíram da seleção/)).toBeInTheDocument();
  });
});

describe("⚠ PRÉVIA ANTES, CONFIRMAÇÃO DEPOIS — nada sai no clique do botão", () => {
  test("abrir o envio consulta o RELATÓRIO e não envia nada", async () => {
    const { api } = await montarBarra({ empresas: [empresa(), empresa({ companyId: "c2", razao: "BETA LTDA" })] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    await waitFor(() => expect(api.getBatchEmailReport).toHaveBeenCalledWith("2026-07"));
    expect(api.sendBatchEmails).not.toHaveBeenCalled();
  });

  test("a confirmação REPETE os números que saem do relatório (3 guias, 2 empresas, 07/2026)", async () => {
    await montarBarra({ empresas: [empresa(), empresa({ companyId: "c2", razao: "BETA LTDA" })] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    await within(modal).findByText("Enviar 3 guias de 2 empresas, competência 07/2026?");
    // Linha a linha, com os tributos de cada uma.
    expect(within(modal).getByText(/2 guia\(s\) · IRPJ, CSLL/)).toBeInTheDocument();
    // E o aviso de que o e-mail chega ao cliente.
    expect(within(modal).getByText(/chega ao cliente/i)).toBeInTheDocument();
  });

  test("só o CONFIRMAR envia — e envia exatamente os ids da prévia", async () => {
    const { api } = await montarBarra({ empresas: [empresa(), empresa({ companyId: "c2", razao: "BETA LTDA" })] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    await within(modal).findByText(/Enviar 3 guias/);
    await act(async () => { fireEvent.click(within(modal).getByRole("button", { name: /Confirmar e executar/ })); });
    expect(api.sendBatchEmails).toHaveBeenCalledWith([
      { portalClientId: "c1", competencia: "2026-07" },
      { portalClientId: "c2", competencia: "2026-07" },
    ]);
  });

  test("⚠ prévia que NÃO carrega BLOQUEIA o envio — e não inventa um número no lugar dela", async () => {
    const api = apiFalso({ getBatchEmailReport: jest.fn().mockRejectedValue(new Error("o servidor demorou demais")) });
    await montarBarra({ api });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    expect(await within(modal).findByText(/Não foi possível carregar a prévia/)).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: /Confirmar e executar/ })).toBeDisabled();
    // Nenhum número de guia aparece — nem o da listagem.
    expect(within(modal).queryByText(/Enviar \d+ guia/)).not.toBeInTheDocument();
    expect(api.sendBatchEmails).not.toHaveBeenCalled();
  });

  test("quem fica de fora aparece NA PRÉVIA com o motivo", async () => {
    const semGuia = empresa({ companyId: "c3", razao: "GAMA LTDA", guideCompliance: { das: { required: true, state: "enviada", ok: true } } });
    await montarBarra({ empresas: [empresa(), semGuia] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    await within(modal).findByText(/Ficam de fora \(1\)/);
    expect(within(modal).getByText("GAMA LTDA")).toBeInTheDocument();
  });

  test("⚠ prévia que resolve para ZERO não pergunta 'enviar 0 guias de 0 empresas?'", async () => {
    // Pergunta sobre nada — e que ainda parece defeito de contagem. O certo é afirmar o desfecho.
    const api = apiFalso({
      getBatchEmailReport: jest.fn().mockResolvedValue({ competencia: "2026-07", simples: [], presumidos: [], outros: [] }),
    });
    await montarBarra({ api });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    expect(await within(modal).findByText(/Nada a fazer com esta seleção/)).toBeInTheDocument();
    expect(within(modal).queryByText(/Enviar 0 guias/)).not.toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: /Confirmar e executar/ })).toBeDisabled();
  });

  test("⚠ o botão do ENVIO não carrega contador — o número dele só existe na prévia", async () => {
    // As outras quatro contam sobre o dado da própria listagem; o envio depende de `batch-report`,
    // que só é consultado ao abrir o modal. Dois números para a mesma pergunta é o defeito.
    await montarBarra({ empresas: [empresa(), empresa({ companyId: "c2", razao: "BETA", empresaZerada: true })] });
    expect(screen.getByRole("button", { name: "Enviar guias por e-mail" })).toBeInTheDocument();
    // A de capturar, essa sim, mostra que só 2 de 2 entram (aqui as duas têm A1) — e quando o
    // recorte é menor que a seleção, o número aparece.
    expect(screen.getByRole("button", { name: /Baixar situação fiscal \(ZIP\)/ })).toBeInTheDocument();
  });

  test("⚠ ninguém aparece em ENTRAM e em FICAM DE FORA ao mesmo tempo — o relatório decide", async () => {
    // Visto na tela: a listagem dizia "todas as guias já enviadas" (regra local) e o relatório
    // dizia "2 pendentes" para a MESMA empresa, que então saía nas duas listas. Quem manda é o
    // relatório — ele é o que o envio consome.
    const jaEnviadaNaListagem = empresa({
      companyId: "c1", razao: "ACME LTDA",
      guideCompliance: { das: { required: true, state: "enviada", ok: true } },
    });
    await montarBarra({ empresas: [jaEnviadaNaListagem] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    await within(modal).findByText(/Enviar 1 guia de 1 empresa/);
    expect(within(modal).getAllByText("ACME LTDA")).toHaveLength(1);
    expect(within(modal).queryByText(/Ficam de fora/)).not.toBeInTheDocument();
  });

  test("o motivo ESPECÍFICO da regra local vence o genérico do relatório", async () => {
    // "empresa zerada — não há guia a entregar" informa mais que "nenhuma guia pendente".
    const zerada = empresa({ companyId: "c9", razao: "ZERADA LTDA", empresaZerada: true });
    await montarBarra({ empresas: [empresa(), zerada] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar guias por e-mail/ })); });
    const modal = await screen.findByRole("dialog", { name: /Enviar guias por e-mail/ });
    await within(modal).findByText(/Ficam de fora \(1\)/);
    expect(within(modal).getByText(/empresa zerada — não há guia a entregar/)).toBeInTheDocument();
  });

  test("cancelar não chama nada", async () => {
    const { api } = await montarBarra();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Baixar XMLs/ })); });
    const modal = await screen.findByRole("dialog", { name: /Baixar XMLs/ });
    fireEvent.click(within(modal).getByRole("button", { name: "Cancelar" }));
    expect(api.createNotasDownload).not.toHaveBeenCalled();
  });

  test("ação reversível também tem prévia, e executa com os ids selecionados", async () => {
    const { api } = await montarBarra();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Baixar XMLs/ })); });
    const modal = await screen.findByRole("dialog", { name: /Baixar XMLs/ });
    expect(within(modal).getByText(/Entram \(1\)/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(modal).getByRole("button", { name: "Executar" })); });
    expect(api.createNotasDownload).toHaveBeenCalledWith({
      companyIds: ["c1"], competenciaDe: "2026-07", competenciaAte: "2026-07",
    });
  });
});
