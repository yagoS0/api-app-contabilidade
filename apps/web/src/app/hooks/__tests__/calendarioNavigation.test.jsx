import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useCalendarioNavigation } from "../useCalendarioNavigation";

function montar(entrada = "/companies") {
  return renderHook(() => ({ nav: useCalendarioNavigation(), location: useLocation() }), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[entrada]}>{children}</MemoryRouter>,
  });
}

test("criação e retorno preservam mês, empresa e visão; criação consumida não reabre", () => {
  const { result } = montar();
  const context = { referencia: "2026-09-10", visao: "semana", empresaFiltro: "c1", categorias: ["obrigacao"], painelAberto: false };
  act(() => result.current.nav.onContextChange(context));
  act(() => result.current.nav.abrir({ companyId: "c1", dataInicio: "2026-09-10", dataFim: "2026-09-15", criar: true }));
  expect(result.current.location.pathname).toBe("/obrigacoes");
  expect(result.current.nav.contexto.criacao.dataFim).toBe("2026-09-15");
  act(() => result.current.nav.criado({ companyId: "c1" }));
  expect(result.current.nav.contexto.criacao).toBeNull();
  act(() => result.current.nav.voltar());
  expect(result.current.location.pathname).toBe("/companies");
  expect(result.current.nav.initialContext).toEqual(context);
});

test("volta ao calendário da empresa e pode ir à data criada", () => {
  const { result } = montar("/companies/c1/obrigacoes");
  act(() => result.current.nav.abrir({ companyId: "c1" }));
  act(() => result.current.nav.voltar("2026-10-02", "c1"));
  expect(result.current.location.pathname).toBe("/companies/c1/obrigacoes");
  expect(result.current.nav.initialContext).toMatchObject({ referencia: "2026-10-02", empresaFiltro: "c1", visao: "mes" });
});

test("acesso direto tem retorno interno seguro e nova entrada não herda contexto", () => {
  const { result } = montar("/obrigacoes");
  act(() => result.current.nav.voltar());
  expect(result.current.location.pathname).toBe("/companies");
  const fresh = montar();
  expect(fresh.result.current.nav.initialContext).toBeUndefined();
});
