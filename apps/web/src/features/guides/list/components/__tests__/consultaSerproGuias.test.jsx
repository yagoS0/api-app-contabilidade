import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ConsultaSerproGuias } from "../ConsultaSerproGuias";
it("só consulta após confirmação e usa a competência fiscal", async () => {
 const onConsultar = jest.fn().mockResolvedValue({});
 render(<ConsultaSerproGuias companyId="empresa" competencia="2026-08" regime="SIMPLES_NACIONAL" onConsultar={onConsultar} />);
 fireEvent.click(screen.getByRole("button", { name: "Consultar SERPRO" }));
 fireEvent.click(screen.getByRole("button", { name: /Buscar DAS/ }));
 expect(onConsultar).not.toHaveBeenCalled();
 await act(async () => fireEvent.click(screen.getByRole("button", { name: "Consultar guia" })));
 expect(onConsultar).toHaveBeenCalledWith("das", "empresa", "2026-08");
});
it("cancelar a consulta de INSS não chama serviço", async () => {
 const onConsultar = jest.fn();
 render(<ConsultaSerproGuias companyId="empresa" competencia="2026-08" regime="PRESUMIDO" onConsultar={onConsultar} />);
 fireEvent.click(screen.getByRole("button", { name: "Consultar SERPRO" }));
 expect(screen.getByRole("button", { name: /Buscar DAS/ })).toBeDisabled();
 fireEvent.click(screen.getByRole("button", { name: /Buscar INSS/ }));
 await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancelar" })));
 expect(onConsultar).not.toHaveBeenCalled();
});
