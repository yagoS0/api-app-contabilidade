import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BotaoAuditoria } from "../BotaoAuditoria";

test('falha da auditoria conserva fora da conferência desconhecido com pendências disponíveis', async () => {
  const api = { getAuditoriaNotas: async () => { throw Error('offline'); }, listPendenciasPosFechamento: async () => [{ id: 'p' }] };
  render(<BotaoAuditoria card companyId="A" competencia="2026-10" api={api} href="#" />);
  expect(await screen.findByText('Conferência indisponível')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveTextContent('Fora da conferência: indisponível');
  expect(screen.getByRole('link')).toHaveTextContent('1 pendências pós-fechamento');
  expect(screen.getByRole('link')).not.toHaveTextContent('0 fora da conferência');
});

test.each([0, 2])("falha de pendências deixa explícita a conferência incompleta (%s achados)", async totalAchados => {
  const api = { getAuditoriaNotas: async () => ({ auditoria: { totalAchados } }), listPendenciasPosFechamento: async () => { throw new Error("indisponível"); } };
  render(<BotaoAuditoria companyId="A" competencia="2026-08" api={api} href="#" />);
  expect(await screen.findByText(totalAchados ? /conferência parcial/ : /Conferência indisponível/)).toBeInTheDocument();
  expect(screen.queryByText("Sem pendências")).not.toBeInTheDocument();
});

test('cartão de auditoria não soma achados, notas sem competência e pendências como notas distintas', async () => {
  const api = { getAuditoriaNotas: async () => ({ auditoria: { totalAchados: 3, foraDaConferencia: { total: 2 } } }), listPendenciasPosFechamento: async () => [{ id: 'p' }, { id: 'q' }] };
  render(<BotaoAuditoria card companyId="A" competencia="2026-10" api={api} href="/companies/A/auditoria" />);
  expect(await screen.findByText('3 achado(s) na competência')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveTextContent('2 fora da conferência');
  expect(screen.getByRole('link')).toHaveTextContent('2 pendências pós-fechamento em todas as competências');
  expect(screen.getByRole('link')).not.toHaveTextContent('7 notas');
});
