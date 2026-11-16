import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FechamentoModal } from "../FechamentoModal.jsx";

// Componente real, somente API em memória: caracteriza o legado sem homologar folha zero.
describe("PGDAS-2026-A — apresentação e formulário atuais", () => {
  test.each(["2026-10", "2026-11", "2026-12", "2027-01"])(
    "%s esconde folha sem Fator R e prepara zeros mesmo sem digitação", async competencia => {
      const api = {
        getFechamento: jest.fn(async () => ({ ok: true, dados: {
          razao: "Empresa sintética", regimeApuracao: "COMPETENCIA", cadastroCompleto: true,
          faturamento: { interno: 100, externo: 0, total: 100 }, entregaPgdas: {}, disparidades: [],
          rbt12: 1200, estado: "aberta", atividades: [{
            idAtividade: 1, descricao: "Atividade sintética sem Fator R", sujeitoFatorR: false,
            anexoImplicito: "I", mercado: "INTERNO", valorInterno: 100, valorExterno: 0,
          }],
        } })),
        listAtividadesPgdasd: jest.fn(async () => ({ ok: true, atividades: [] })),
        calcularFechamento: jest.fn(async () => ({ ok: true, result: { dasValor: 1 } })),
      };
      render(<FechamentoModal api={api} feedback={{}} portalClientId="sintetica" competencia={competencia}
        razao="Empresa sintética" onClose={() => {}} onChanged={() => {}} />);
      await screen.findByText("Atividade sintética sem Fator R");
      expect(screen.queryByRole("region", { name: "Folha de salários e Fator R" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Calcular \(simulação\)/i }));
      await waitFor(() => expect(api.calcularFechamento).toHaveBeenCalledTimes(1));
      const args = api.calcularFechamento.mock.calls[0];
      const formulario = args.find(v => v && typeof v === "object" && "folhaMensal12" in v);
      expect(formulario.folhaMensal12).toHaveLength(12);
      expect(formulario.folhaMensal12.every(f => f.valor === 0)).toBe(true);
    });
});
