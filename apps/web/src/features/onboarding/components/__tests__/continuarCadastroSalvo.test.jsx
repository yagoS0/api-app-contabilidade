import { act, fireEvent, render, screen } from "@testing-library/react";
import { FluxoComercial } from "../FluxoComercial";

test("continuar preenchimento atualiza imediatamente o cadastro salvo sem esperar polling", async () => {
  jest.useFakeTimers();
  let vista;
  try {
    let ficha = { id: "empresa", origem: "TRANSFERENCIA", status: "RASCUNHO", cnpj: null, dados: {}, versao: 0 };
    const api = {
      getOnboardingComercial: jest.fn(async () => ({ analises: [] })),
      criarAnaliseOnboarding: jest.fn(),
      comercial: jest.fn(async (path) => path === "/recursos" ? { recursos: [] } : {
        onboarding: ficha, propostas: [], contratos: [], documentos: [], trabalhos: [],
        jornada: { projecao: { atual: "publica", passos: [{ id: "publica", titulo: "Dados da empresa", acessivel: true, pendencias: [] }] } },
      }),
    };
    await act(async () => { vista = render(<FluxoComercial api={api} onboardingId="empresa" revisao={0} />); });
    expect(screen.queryByRole("region", { name: "Cadastro já preenchido" })).not.toBeInTheDocument();
    expect(api.comercial.mock.calls.filter(([path]) => path === "/onboardings/empresa")).toHaveLength(1);
    ficha = { ...ficha, versao: 8, cnpj: "11222333000181", dados: { razaoSocial: "Empresa recém-preenchida", cadastroCnpj: {
      cnpj: "11222333000181", fonte: "BRASIL_API", consultadoEm: "2026-10-08T12:00:00Z",
      empresa: { razaoSocial: "Empresa recém-preenchida", endereco: { rua: "Rua recém-salva", numero: "42" }, cnaePrincipal: "6201501" },
    } } };
    // O relógio falso não é avançado: uma atualização só pode vir da revisão explícita.
    await act(async () => { vista.rerender(<FluxoComercial api={api} onboardingId="empresa" revisao={1} />); });
    expect(screen.getByRole("region", { name: "Cadastro já preenchido" })).toBeVisible();
    expect(screen.getByText("Rua recém-salva, 42")).toBeVisible();
    expect(api.comercial.mock.calls.filter(([path]) => path === "/onboardings/empresa")).toHaveLength(2);
    expect(api.criarAnaliseOnboarding).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Conferi os dados: continuar" })); });
    expect(api.comercial).toHaveBeenCalledWith("/onboardings/empresa/jornada/conferencia", expect.objectContaining({ versao: 8, tipo: "PUBLICA" }));
  } finally {
    vista?.unmount();
    jest.useRealTimers();
  }
});
