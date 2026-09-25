import { fireEvent, render, screen } from "@testing-library/react";
import { GuideSendActivity } from "../GuideSendActivity";

test("mostra progresso real e conserva resultado parcial sem prometer entrega", () => {
  const base = { companyName: "Empresa A", total: 2, completed: 1, resultados: [{ guideId: "g1", rotulo: "DAS", texto: "Pedido aceito, aguardando confirmação de entrega" }] };
  const fechar = jest.fn();
  const { rerender } = render(<GuideSendActivity activity={{ ...base, status: "running" }} onDismiss={fechar} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
  expect(screen.queryByRole("button", { name: /Fechar/ })).not.toBeInTheDocument();
  expect(screen.getByText(/pode continuar usando/)).toBeInTheDocument();
  rerender(<GuideSendActivity activity={{ ...base, completed: 2, status: "pending" }} onDismiss={fechar} />);
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("Envio com pendências")).toBeInTheDocument();
  expect(screen.getByText(/Pedido aceito/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Fechar resultado/ }));
  expect(fechar).toHaveBeenCalledTimes(1);
});
