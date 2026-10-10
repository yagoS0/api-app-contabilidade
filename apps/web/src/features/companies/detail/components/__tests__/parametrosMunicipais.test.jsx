import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParametrosMunicipais } from '../ParametrosMunicipais';
const dados = { habilitado: true, ambiente: 'homolog', municipio: '3304557', servicos: ['171901'], consultas: [] };
const retorno = { id: 'consulta1', municipio: '3304557', recurso: 'convenio', createdAt: '2026-10-10T12:00:00Z', status: 'RECEBIDO_PARA_CONFERENCIA', resposta: { exemplo: true } };
beforeAll(() => { Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: () => 'consulta-123456789' }); });
function montar(extra = {}) {
  const api = { getParametrosMunicipais: jest.fn(async () => dados), consultarParametrosMunicipais: jest.fn(async () => retorno), ...extra };
  render(<ParametrosMunicipais companyId="portal" api={api} podeConsultar />); return api;
}
test('abrir a tela só lê; consulta oficial exige o clique e exibe limite de vigência', async () => {
  const api = montar();
  const b = await screen.findByRole('button', { name: 'Consultar fonte oficial' });
  expect(api.consultarParametrosMunicipais).not.toHaveBeenCalled();
  fireEvent.click(b);
  expect(await screen.findByText(/Retorno recebido para conferência/)).toBeInTheDocument();
  expect(api.consultarParametrosMunicipais).toHaveBeenCalledWith('portal', expect.objectContaining({ municipio: '3304557', recurso: 'convenio' }));
  expect(screen.getByText(/não comprova vigência/)).toBeInTheDocument();
});
test('falha HTTP reutiliza identificador ao recuperar consulta', async () => {
  const api = montar({ consultarParametrosMunicipais: jest.fn().mockRejectedValueOnce(new Error('Rede indisponível')).mockResolvedValue(retorno) });
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar fonte oficial' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recuperar consulta' }));
  await waitFor(() => expect(api.consultarParametrosMunicipais).toHaveBeenCalledTimes(2));
  expect(api.consultarParametrosMunicipais.mock.calls[0][1]).toEqual(api.consultarParametrosMunicipais.mock.calls[1][1]);
});
test('integração desativada não apresenta botão de consulta', async () => {
  montar({ getParametrosMunicipais: jest.fn(async () => ({ ...dados, habilitado: false })) });
  expect(await screen.findByText(/ainda não habilitada/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Consultar fonte oficial' })).not.toBeInTheDocument();
});
test('sem permissão não carrega dados', () => {
  const api = { getParametrosMunicipais: jest.fn() };
  render(<ParametrosMunicipais companyId="portal" api={api} podeConsultar={false} />);
  expect(api.getParametrosMunicipais).not.toHaveBeenCalled();
});

test('comparar dia interpreta histórico salvo sem consultar novamente o ADN', async () => {
  const registro = { ...retorno, recurso: 'servico', codigoServico: '171901001', ambiente: 'homolog', resposta: {
    aliquotas: { '17.19.01.001': [{ Aliq: 0, Incidencia: 'SIM', DtIni: '2026-01-16T00:00:00', DtFim: null }] },
  } };
  const api = montar({ getParametrosMunicipais: jest.fn(async () => ({ ...dados, consultas: [registro] })) });
  await screen.findByText(/Retorno recebido para conferência/);
  fireEvent.change(screen.getByLabelText('Dia da prestação para conferir vigência'), { target: { value: '2026-01-15' } });
  expect(screen.getByText(/Período fora da competência/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Dia da prestação para conferir vigência'), { target: { value: '2026-01-16' } });
  expect(screen.getByText(/Período cobre a competência/)).toBeInTheDocument();
  expect(screen.getByText(/Alíquota: 0%/)).toBeInTheDocument();
  expect(api.consultarParametrosMunicipais).not.toHaveBeenCalled();
});

test('alíquotas exigem complemento explícito e trocar município limpa esse código', async () => {
  const api = montar();
  const botao = await screen.findByRole('button', { name: 'Consultar fonte oficial' });
  fireEvent.change(screen.getByLabelText('Consultar'), { target: { value: 'servico' } });
  expect(botao).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Complemento municipal (3 dígitos)'), { target: { value: '001' } });
  fireEvent.click(botao);
  await waitFor(() => expect(api.consultarParametrosMunicipais).toHaveBeenCalledWith('portal', expect.objectContaining({ codigoServico: '171901', codigoServicoMunicipal: '001' })));
  await screen.findByText(/Retorno recebido para conferência/);
  fireEvent.change(screen.getByLabelText('Município da consulta (IBGE)'), { target: { value: '3550308' } });
  expect(screen.getByLabelText('Complemento municipal (3 dígitos)')).toHaveValue('');
  expect(botao).toBeDisabled();
});
