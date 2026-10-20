import { createRealApi } from '../realApi';
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });
const responder = payload => global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });
test.each([null, {}, { ok: false }, { ok: true, onboarding: {} }])('encerramento rejeita confirmação inválida %j', async payload => {
  responder(payload);
  await expect(createRealApi().desistirOnboarding('f', '', 3)).rejects.toThrow();
});
test.each([null, {}, { ok: false }])('descarte rejeita confirmação inválida %j', async payload => {
  responder(payload);
  await expect(createRealApi().descartarOnboarding('f', 3)).rejects.toThrow();
});
test('transporta a versão vista na confirmação nas duas ações', async () => {
  responder({ ok: true, onboarding: { id: 'f', status: 'DESISTIU' } });
  await createRealApi().desistirOnboarding('f', 'Sem interesse', 3);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ versao: 3, motivo: 'Sem interesse' });
  responder({ ok: true });
  await createRealApi().descartarOnboarding('f', 4);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ versao: 4 });
});
test('recusa HTTP preserva código e não vira sucesso', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'formulario_alterado', message: 'Confira novamente' }) });
  await expect(createRealApi().desistirOnboarding('f', '', 3)).rejects.toMatchObject({ status: 409 });
});
