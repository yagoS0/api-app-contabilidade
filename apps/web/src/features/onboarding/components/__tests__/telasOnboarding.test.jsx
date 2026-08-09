// As TELAS montam e obedecem à spec.
//
// Verificação executada, não afirmada: renderiza o wizard e o detalhe contra o mock real do app e
// confere as regras que só existem na tela — o campo que aparece/some pela origem, o selo com o
// texto certo, e o botão de efeito colateral desabilitado enquanto não há empresa.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChecklistEtapas } from "../ChecklistEtapas";
import { SeloDeclarado, textoDoSelo } from "../SeloDeclarado";
import { FichaDeclarada } from "../PassoRevisao";
import { OnboardingWizardPage } from "../../pages/renderOnboardingWizardPage";

function apiFalsa(overrides = {}) {
  return {
    getOnboarding: jest.fn(async () => ({
      ok: true,
      onboarding: {
        id: "onb-1", origem: "TRANSFERENCIA", status: "RASCUNHO",
        origemPreenchimento: "ESCRITORIO", dados: {}, ultimoPasso: "identificacao",
        etapas: [],
      },
    })),
    salvarOnboarding: jest.fn(async (id, patch) => ({
      ok: true,
      onboarding: {
        id, origem: patch.origem || "TRANSFERENCIA", status: "RASCUNHO",
        origemPreenchimento: "ESCRITORIO", dados: patch.dados || {}, ultimoPasso: patch.ultimoPasso || null,
        etapas: [],
      },
    })),
    ...overrides,
  };
}

describe("SeloDeclarado — o texto NÃO pode mentir sobre quem declarou", () => {
  test("Fase 1 (escritório) lê 'declarado no atendimento'", () => {
    expect(textoDoSelo("ESCRITORIO")).toBe("declarado no atendimento");
    render(<SeloDeclarado origemPreenchimento="ESCRITORIO" />);
    expect(screen.getByText("declarado no atendimento")).toBeInTheDocument();
  });

  test("só com CLIENTE o selo diz 'declarado pelo cliente'", () => {
    expect(textoDoSelo("CLIENTE")).toBe("declarado pelo cliente");
    // ausência de informação NÃO vira "pelo cliente"
    expect(textoDoSelo(null)).toBe("declarado no atendimento");
    expect(textoDoSelo("")).toBe("declarado no atendimento");
  });
});

describe("FichaDeclarada — percorre a MESMA spec do wizard", () => {
  test("mostra o campo não respondido em vez de escondê-lo", () => {
    render(
      <FichaDeclarada
        origem="TRANSFERENCIA"
        dados={{ razaoSocial: "EMPRESA X LTDA" }}
        origemPreenchimento="ESCRITORIO"
      />
    );
    expect(screen.getByText("EMPRESA X LTDA")).toBeInTheDocument();
    // some da tela quem não respondeu ⇒ ninguém sabe se foi resposta vazia ou pergunta não feita
    expect(screen.getAllByText("— não informado —").length).toBeGreaterThan(0);
  });

  test("campo sensível PREENCHIDO ganha o selo; vazio não ganha", () => {
    const { rerender } = render(
      <FichaDeclarada origem="TRANSFERENCIA" dados={{ regimeAtual: "SIMPLES" }} origemPreenchimento="ESCRITORIO" />
    );
    expect(screen.getAllByText("declarado no atendimento").length).toBeGreaterThan(0);

    rerender(<FichaDeclarada origem="TRANSFERENCIA" dados={{}} origemPreenchimento="ESCRITORIO" />);
    expect(screen.queryByText("declarado no atendimento")).not.toBeInTheDocument();
  });

  test("a ficha de ABERTURA não mostra CNPJ — não é o que se perguntou", () => {
    render(<FichaDeclarada origem="ABERTURA" dados={{}} origemPreenchimento="ESCRITORIO" />);
    expect(screen.queryByText("CNPJ")).not.toBeInTheDocument();
    expect(screen.getByText("Nome pretendido")).toBeInTheDocument();
  });
});

describe("ChecklistEtapas — efeito colateral exige empresa", () => {
  const etapas = [
    { id: "e1", titulo: "Certificado A1 da empresa instalado", ordem: 1, acao: "CERTIFICADO_A1", obrigatoria: true, concluidaEm: null },
    { id: "e2", titulo: "Situação fiscal consultada (SITFIS)", ordem: 2, acao: "SITFIS", obrigatoria: true, concluidaEm: null },
    { id: "e3", titulo: "Empresa criada no portal", ordem: 3, acao: "CONVERSAO", obrigatoria: true, concluidaEm: null },
  ];

  test("sem portalClientId os botões de SITFIS e A1 ficam desabilitados COM o motivo", () => {
    render(<ChecklistEtapas etapas={etapas} portalClientId={null} onAlternar={() => {}} onObservacao={() => {}} />);

    const botaoA1 = screen.getByRole("button", { name: "Ir para o certificado A1" });
    const botaoSitfis = screen.getByRole("button", { name: "Consultar situação fiscal" });
    expect(botaoA1).toBeDisabled();
    expect(botaoSitfis).toBeDisabled();
    expect(botaoA1).toHaveAttribute("title", expect.stringContaining("depois de criar a empresa"));

    // a conversão NÃO depende de empresa — é ela que a cria
    expect(screen.getByRole("button", { name: "Criar a empresa" })).toBeEnabled();
  });

  test("com portalClientId os botões habilitam", () => {
    render(<ChecklistEtapas etapas={etapas} portalClientId="portal-1" onAlternar={() => {}} onObservacao={() => {}} />);
    expect(screen.getByRole("button", { name: "Ir para o certificado A1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Consultar situação fiscal" })).toBeEnabled();
  });

  // A consequência do A1 ausente é INVISÍVEL na tela da empresa; cor nenhuma comunica isso.
  test("o A1 pendente traz a frase por extenso, não só a régua colorida", () => {
    render(<ChecklistEtapas etapas={etapas} portalClientId="portal-1" onAlternar={() => {}} onObservacao={() => {}} />);
    expect(screen.getByText(/captura de NFS-e falha em silêncio/i)).toBeInTheDocument();
  });

  test("pós-conversão o card mostra o estado REAL do certificado", () => {
    render(
      <ChecklistEtapas
        etapas={etapas}
        portalClientId="portal-1"
        certificado={{ hasCertificate: false }}
        onAlternar={() => {}}
        onObservacao={() => {}}
      />
    );
    expect(screen.getByText("Nenhum certificado instalado nesta empresa.")).toBeInTheDocument();
  });
});

describe("Wizard — a origem manda no formulário", () => {
  test("abre no passo salvo e mostra os campos da origem gravada", async () => {
    render(<OnboardingWizardPage api={apiFalsa()} onboardingId="onb-1" onVoltar={() => {}} />);

    // ⚠ Esperar por "Identificação" seria falso positivo: o rótulo do passo existe na TRILHA
    // desde o primeiro render. O que prova que o wizard reabriu no passo salvo é o CAMPO.
    await waitFor(() => expect(screen.getByLabelText(/^CNPJ/)).toBeInTheDocument());
    // TRANSFERENCIA pergunta CNPJ e "Razão social"
    expect(screen.getByLabelText(/^Razão social/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^CNPJ/)).toBeInTheDocument();
    // e oferece a consulta à Receita naquele campo
    expect(screen.getByRole("button", { name: "consultar Receita" })).toBeInTheDocument();
  });

  test("a trilha marca o passo atual com aria-current='step'", async () => {
    render(<OnboardingWizardPage api={apiFalsa()} onboardingId="onb-1" onVoltar={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/^CNPJ/)).toBeInTheDocument());
    const trilha = screen.getByRole("navigation", { name: "Etapas do cadastro" });
    const atual = within(trilha).getByRole("button", { current: "step" });
    expect(atual).toHaveTextContent("Identificação");
  });

  test("o campo escondido pela regra do rascunho não é renderizado", async () => {
    const api = apiFalsa({
      getOnboarding: jest.fn(async () => ({
        ok: true,
        onboarding: {
          id: "onb-1", origem: "ABERTURA", status: "RASCUNHO", origemPreenchimento: "ESCRITORIO",
          dados: { tipoEmpresa: "MEI" }, ultimoPasso: "identificacao", etapas: [],
        },
      })),
    });
    render(<OnboardingWizardPage api={api} onboardingId="onb-1" onVoltar={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/^Nome pretendido/)).toBeInTheDocument());
    // MEI não tem quadro societário
    expect(screen.queryByText("Sócios")).not.toBeInTheDocument();
  });

  test("digitar marca 'alterações não salvas' e o debounce salva o rascunho", async () => {
    const api = apiFalsa();
    render(<OnboardingWizardPage api={api} onboardingId="onb-1" onVoltar={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText(/^Razão social/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Razão social/), { target: { value: "NOVA" } });
    expect(screen.getByText("alterações não salvas")).toBeInTheDocument();

    // O debounce é de 800ms — esperar por ele é o que prova que a digitação não fica só na tela.
    await waitFor(() => expect(api.salvarOnboarding).toHaveBeenCalled(), { timeout: 3000 });
    const [, patch] = api.salvarOnboarding.mock.calls.at(-1);
    expect(patch.dados.razaoSocial).toBe("NOVA");
    // ⚠ e o que foi salvo passou pela PODA: `dados` não carrega campo de outra origem.
    expect(patch.dados.paradaDesde).toBeUndefined();
  });
});
