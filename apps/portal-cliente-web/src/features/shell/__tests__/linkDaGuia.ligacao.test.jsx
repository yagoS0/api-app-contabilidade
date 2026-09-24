import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../../App';
import { api } from '../../../api';
import { definirSessao, limparSessao } from '../../../api/sessionStore';
import { AppShell } from '../AppShell';

const company = { companyId: 'c2', razao: 'Empresa do aviso', cnpj: '11222333000181', myRole: 'OWNER' };
const guide = { guideId: 'guia-antiga', tipo: 'DAS', competencia: '2021-01', valor: 100, vencimento: '2021-02-20', paymentStatus: 'OVERDUE', liberadaCliente: true, vencida: true, canConfirmPayment: true, canRecalculate: true, avisoDeRecalculo: { titulo: 'Atualizar guia vencida', texto: 'A nova guia terá os acréscimos da Receita.' } };
function url(acao = 'confirmar', empresa = 'c2') {
  window.history.replaceState({}, '', `/?empresa=${empresa}&guia=guia-antiga&competencia=2021-01&acao=${acao}#/guias`);
}
beforeEach(() => {
  window.localStorage.clear(); limparSessao(); url();
  jest.spyOn(api, 'getCompanies').mockResolvedValue([{ ...company, companyId: 'c1', razao: 'Outra empresa' }, company]);
  jest.spyOn(api, 'getGuides').mockResolvedValue({ data: [guide], page: 1, limit: 1, total: 1 });
  jest.spyOn(api, 'recalcularGuia').mockResolvedValue({});
  jest.spyOn(api, 'confirmarPagamentoDaGuia').mockResolvedValue({});
});
afterEach(() => { jest.restoreAllMocks(); limparSessao(); window.history.replaceState({}, '', '/'); });
async function abrir() { render(<AppShell user={{ defaultClientId: 'c1' }} />); await act(async () => {}); }
test('abre empresa do aviso e guia antiga diretamente, sem executar ação', async () => {
  await abrir();
  expect(api.getGuides).toHaveBeenCalledWith('c2', { guideId: 'guia-antiga', page: 1, limit: 1 });
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(document.querySelector('input[type="date"]').value).toBe('');
  expect(document.querySelector('#competencia-guias').value).toBe('2021-01');
  expect(api.recalcularGuia).not.toHaveBeenCalled();
  expect(api.confirmarPagamentoDaGuia).not.toHaveBeenCalled();
});
test('empresa fora do acesso não carrega guia de outra empresa', async () => {
  url('confirmar', 'empresa-proibida'); await abrir();
  expect(screen.getByText(/Seu acesso não permite abrir a empresa deste aviso/)).toBeTruthy();
  expect(api.getGuides).not.toHaveBeenCalled();
});
test('o destino sobrevive ao login, sem consultar guia antes da autenticação', async () => {
  render(<App />); expect(api.getGuides).not.toHaveBeenCalled();
  expect(window.location.search).toContain('guia=guia-antiga');
  await act(async () => definirSessao({ accessToken: 'token', refreshToken: 'refresh', user: { defaultClientId: 'c1' } }));
  await waitFor(() => expect(api.getGuides).toHaveBeenCalledWith('c2', { guideId: 'guia-antiga', page: 1, limit: 1 }));
  expect(api.confirmarPagamentoDaGuia).not.toHaveBeenCalled();
});
test.each(['INSS', 'PARC'])('recálculo indisponível de %s orienta procurar contador', async tipo => {
  url('recalcular'); api.getGuides.mockResolvedValue({ data: [{ ...guide, tipo, canRecalculate: false }], total: 1 });
  await abrir(); expect(screen.getByText(/A atualização desta guia precisa ser providenciada pelo seu contador/)).toBeTruthy();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(api.recalcularGuia).not.toHaveBeenCalled();
});
test.each([{ ...guide, liberadaCliente: false }, { ...guide, paymentStatus: 'PAID' }])('guia sem liberação ou já paga não abre confirmação', async guia => {
  api.getGuides.mockResolvedValue({ data: [guia], total: 1 }); await abrir();
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(api.confirmarPagamentoDaGuia).not.toHaveBeenCalled();
});
test('link recalcular abre aviso; somente clique explícito faz a chamada paga', async () => {
  url('recalcular'); await abrir(); expect(api.recalcularGuia).not.toHaveBeenCalled();
  const dialog = screen.getByRole('alertdialog');
  fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Pedir guia atualizada'));
  await act(async () => {}); expect(api.recalcularGuia).toHaveBeenCalledTimes(1);
});
