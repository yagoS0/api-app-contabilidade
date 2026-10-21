import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormasIndicacoesParcelamento } from '../FormasIndicacoesParcelamento';
const item = { id: 'i', descricao: 'Indicação fictícia', modalidade: 'PARCSN', revision: 'a'.repeat(64), atual: null, historico: [] };
const persisted = (body, revision = 'b'.repeat(64)) => ({ ...item, revision, atual: { formaPagamento: body.formaPagamento, desde: body.desde }, historico: [{ formaPagamento: body.formaPagamento, desde: body.desde, usuarioId: 'contador-teste', em: '2026-10-21T12:00:00Z' }] });
const setup = (canEdit = true, save = jest.fn(async (_company, _id, body) => ({ ok: true, indicacao: persisted(body) })), afterSaved = jest.fn()) => {
 const api = { getFormasIndicacoesParcelamento: jest.fn(async () => ({ ok: true, items: [item], canEdit })), salvarFormaIndicacaoParcelamento: save }, onSaved = afterSaved;
 const view = render(<FormasIndicacoesParcelamento api={api} companyId="c" mes="2026-10" onSaved={onSaved} />);
 const details = view.container.querySelector('details'); details.open = true; fireEvent(details, new Event('toggle'));
 return { api, onSaved, view };
};
test('forma explícita e vigência, sem pré-seleção e sem criar contrato ou confirmar pagamento', async () => {
 const { api, onSaved } = setup();
 const form = await screen.findByLabelText('Forma de pagamento');
 expect(form).toHaveValue(''); expect(api.salvarFormaIndicacaoParcelamento).not.toHaveBeenCalled();
 fireEvent.change(form, { target: { value: 'DEBITO_AUTOMATICO' } });
 fireEvent.click(screen.getByRole('button', { name: 'Confirmar forma de pagamento' }));
 await screen.findByText('Configuração salva.');
 expect(api.salvarFormaIndicacaoParcelamento).toHaveBeenCalledWith('c', 'i', expect.objectContaining({ expectedRevision: item.revision, formaPagamento: 'DEBITO_AUTOMATICO', desde: '2026-10' })); expect(onSaved).toHaveBeenCalledTimes(1);
});
test('somente leitura não oferece configuração', async () => {
 const { api } = setup(false); await screen.findByText('Indicação fictícia');
 expect(screen.queryByLabelText('Forma de pagamento')).toBeNull(); expect(api.salvarFormaIndicacaoParcelamento).not.toHaveBeenCalled();
});
test('resposta incerta mantém a mesma solicitação e campos bloqueados', async () => {
 const save = jest.fn().mockRejectedValueOnce(Error('timeout')).mockImplementation(async (_company, _id, body) => ({ ok: true, indicacao: persisted(body) })); setup(true, save);
 fireEvent.change(await screen.findByLabelText('Forma de pagamento'), { target: { value: 'GUIA_MENSAL' } });
 fireEvent.click(screen.getByRole('button', { name: 'Confirmar forma de pagamento' })); await screen.findByRole('alert');
 expect(screen.getByLabelText('Forma de pagamento')).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Conferir salvamento' }));
 await waitFor(() => expect(save).toHaveBeenCalledTimes(2)); expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});


test('salva, mostra histórico persistido e permite nova alteração com revisão e solicitação novas', async () => {
 const { api } = setup();
 fireEvent.change(await screen.findByLabelText('Forma de pagamento'), { target: { value: 'DEBITO_AUTOMATICO' } });
 fireEvent.click(screen.getByRole('button', { name: 'Confirmar forma de pagamento' }));
 await screen.findByText('Configuração salva.');
 expect(screen.getByText('Débito automático · desde 2026-10')).toBeInTheDocument();
 expect(screen.getByText(/registrado em .*usuário contador-teste/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Alterar configuração' }));
 fireEvent.change(screen.getByLabelText('Forma de pagamento'), { target: { value: 'GUIA_MENSAL' } });
 fireEvent.click(screen.getByRole('button', { name: 'Confirmar forma de pagamento' }));
 await screen.findByText('Configuração salva.');
 expect(screen.getByText('Guia mensal · desde 2026-10')).toBeInTheDocument();
 const first = api.salvarFormaIndicacaoParcelamento.mock.calls[0][2], second = api.salvarFormaIndicacaoParcelamento.mock.calls[1][2];
 expect(second.expectedRevision).toBe('b'.repeat(64));
 expect(second.requestId).not.toBe(first.requestId);
 expect(second.formaPagamento).toBe('GUIA_MENSAL');
});

test('falha de atualização externa conserva sucesso e histórico; vigência futura não altera mês exibido', async () => {
 setup(true, undefined, jest.fn(() => { throw Error('refresh'); }));
 fireEvent.change(await screen.findByLabelText('Forma de pagamento'), { target: { value: 'DEBITO_AUTOMATICO' } });
 fireEvent.change(screen.getByLabelText('Válido a partir de'), { target: { value: '2026-11' } });
 fireEvent.click(screen.getByRole('button', { name: 'Confirmar forma de pagamento' }));
 await screen.findByText('Configuração salva; não foi possível atualizar a lista de guias.');
 expect(screen.getByText('Configuração salva.')).toBeInTheDocument();
 expect(screen.getByText('Forma de pagamento a conferir')).toBeInTheDocument();
 expect(screen.getByText(/Débito automático · desde 2026-11 · registrado/)).toBeInTheDocument();
 expect(screen.getByRole('button', { name: 'Alterar configuração' })).toBeEnabled();
});
