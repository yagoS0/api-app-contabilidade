import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BotaoAuditoria } from "../BotaoAuditoria";

test('falha da auditoria conserva fora da conferência desconhecido com pendências disponíveis', async () => {
  const api = { getAuditoriaNotas: async () => { throw Error('offline'); }, listPendenciasPosFechamento: async () => [{ id: 'p' }] };
  render(<BotaoAuditoria card companyId="A" competencia="2026-10" api={api} href="#" />);
  expect(await screen.findByText('Conferência indisponível')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('aria-description', expect.stringContaining('Fora da conferência: indisponível'));
  expect(screen.getByRole('link')).toHaveAttribute('aria-description', expect.stringContaining('1 pendências pós-fechamento'));
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
  expect(await screen.findByText('Achados na competência')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveTextContent('3');
  expect(screen.getByRole('link')).toHaveAttribute('aria-description', expect.stringContaining('2 fora da conferência'));
  expect(screen.getByRole('link')).toHaveAttribute('aria-description', expect.stringContaining('2 pendências pós-fechamento em todas as competências'));
  expect(screen.getByRole('link')).not.toHaveTextContent('7 notas');
});

test('cartão parcial conserva quantidade conhecida e identifica leitura incompleta', async () => {
  const api = { getAuditoriaNotas: async () => ({ auditoria: { totalAchados: 3, foraDaConferencia: { total: 2 } } }), listPendenciasPosFechamento: async () => { throw Error('offline'); } };
  render(<BotaoAuditoria card companyId="A" competencia="2026-10" api={api} href="#" />);
  expect(await screen.findByText('Conferência parcial')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveTextContent('3');
  expect(screen.getByRole('link')).not.toHaveTextContent('Sem achados');
});
test('resposta tardia não altera auditoria da nova empresa e competência', async () => {
  let concluir;
  const api = { getAuditoriaNotas: jest.fn().mockImplementationOnce(() => new Promise(resolve => { concluir = resolve; })).mockResolvedValue({ auditoria: { totalAchados: 2, foraDaConferencia: { total: 0 } } }), listPendenciasPosFechamento: async () => [] };
  const { rerender } = render(<BotaoAuditoria card companyId="A" competencia="2026-09" api={api} href="#" />);
  expect(screen.getByRole('link')).toHaveTextContent('Carregando');
  rerender(<BotaoAuditoria card companyId="B" competencia="2026-10" api={api} href="#" />);
  await screen.findByText('Achados na competência');
  await act(async () => concluir({ auditoria: { totalAchados: 99, foraDaConferencia: { total: 0 } } }));
  expect(screen.getByRole('link')).toHaveTextContent('2'); expect(screen.getByRole('link')).not.toHaveTextContent('99');
});
