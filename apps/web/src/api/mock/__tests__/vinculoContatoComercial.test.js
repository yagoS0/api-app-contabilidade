import { criarMockComercial } from '../comercialMock';

const body = { nome: 'Pessoa sintética', telefone: '5521999991234', autorizado: true, evidencia: 'Solicitação sintética', canalId: 'comercial' };
test('mock confirma identidade, conserva retry e leitura não recria conversa', async () => {
  const o = { id: 'f', status: 'RASCUNHO', versao: 1 };
  const prepararConversa = jest.fn(() => 'conversa'), persistir = jest.fn();
  const api = criarMockComercial({ onboardings: new Map([['f', o]]), persistir, prepararConversa });
  expect(await api.comercial('/onboardings/f/contato/vincular', body)).toEqual({ conversaId: 'conversa', atendimentoId: 'caso-f', existente: false });
  expect(prepararConversa).toHaveBeenCalledWith(o, body, { neutro: true });
  expect(await api.comercial('/onboardings/f/contato/vincular', body)).toMatchObject({ existente: true, atendimentoId: 'caso-f' });
  expect(persistir).toHaveBeenCalledTimes(1);
  prepararConversa.mockClear();
  expect(await api.comercial('/onboardings/f/acompanhamento')).toMatchObject({ conversaId: 'conversa', versao: 1 });
  expect(prepararConversa).not.toHaveBeenCalled();
  await expect(api.comercial('/onboardings/f/contato/vincular', { ...body, telefone: '5521999995678' })).rejects.toThrow('outro contato');
  expect(o.contatoComercialMock.telefone).toBe(body.telefone);
});
test('mock conserva intenção da porta antiga e recusa ausência de autorização', async () => {
  const o = { id: 'f', status: 'RASCUNHO' }, prepararConversa = jest.fn(() => 'conversa');
  const api = criarMockComercial({ onboardings: new Map([['f', o]]), persistir: jest.fn(), prepararConversa });
  await expect(api.comercial('/onboardings/f/contato/vincular', { ...body, autorizado: false })).rejects.toThrow();
  expect(prepararConversa).not.toHaveBeenCalled();
  await api.comercial('/onboardings/f/contato', body);
  expect(prepararConversa).toHaveBeenCalledWith(o, body, { neutro: false });
});
