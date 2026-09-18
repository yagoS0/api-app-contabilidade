import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BotaoAuditoria } from "../BotaoAuditoria";

test.each([0, 2])("falha de pendências deixa explícita a conferência incompleta (%s achados)", async totalAchados => {
  const api = { getAuditoriaNotas: async () => ({ auditoria: { totalAchados } }), listPendenciasPosFechamento: async () => { throw new Error("indisponível"); } };
  render(<BotaoAuditoria companyId="A" competencia="2026-08" api={api} href="#" />);
  expect(await screen.findByText(totalAchados ? /conferência parcial/ : /Conferência indisponível/)).toBeInTheDocument();
  expect(screen.queryByText("Sem pendências")).not.toBeInTheDocument();
});
