// Contrato do mock REAL; sem substituir métodos, CAS ou retorno do hook.
const storageKey = 'mock:onboardings:v1';
let api;
beforeEach(async () => {
  sessionStorage.removeItem(storageKey);
  jest.resetModules();
  const { createMockApi } = await import('../mockApi');
  api = createMockApi({ delay: async () => {} });
});
afterEach(() => sessionStorage.removeItem(storageKey));

test('criação, leitura e salvamentos sucessivos conservam identidade e avançam revisão', async () => {
  const { onboarding: initial } = await api.criarOnboarding('PESSOA_FISICA');
  expect(initial).toMatchObject({ versao: 0, status: 'RASCUNHO' });
  expect((await api.getOnboarding(initial.id)).onboarding.versao).toBe(0);
  const first = await api.salvarOnboarding(initial.id, { versao: 0, dados: { responsavelNome: 'Pessoa sintética' } });
  expect(first.onboarding).toMatchObject({ id: initial.id, versao: 1, dados: { responsavelNome: 'Pessoa sintética' } });
  const second = await api.salvarOnboarding(initial.id, { versao: 1, ultimoPasso: 'revisao' });
  expect(second.onboarding).toMatchObject({ id: initial.id, versao: 2, ultimoPasso: 'revisao' });
  expect((await api.getOnboarding(initial.id)).onboarding.versao).toBe(2);
  expect(JSON.parse(sessionStorage.getItem(storageKey)).fichas[0][1].versao).toBe(2);
});

test.each([undefined, null, '0', -1, 1, 0.5])('recusa revisão %s sem mutar dados, instante ou storage', async versao => {
  const { onboarding } = await api.criarOnboarding('PESSOA_FISICA');
  const before = JSON.stringify((await api.getOnboarding(onboarding.id)).onboarding);
  const stored = sessionStorage.getItem(storageKey);
  await expect(api.salvarOnboarding(onboarding.id, { versao, dados: { responsavelNome: 'Não gravar' } }))
    .rejects.toMatchObject({ code: 'formulario_alterado', status: 409 });
  expect(JSON.stringify((await api.getOnboarding(onboarding.id)).onboarding)).toBe(before);
  expect(sessionStorage.getItem(storageKey)).toBe(stored);
});

test('duas gravações concorrentes da mesma revisão têm um único vencedor; replay é conflito', async () => {
  const { onboarding } = await api.criarOnboarding('PESSOA_FISICA');
  const patch = { versao: 0, dados: { responsavelNome: 'Primeira intenção' } };
  const results = await Promise.allSettled([api.salvarOnboarding(onboarding.id, patch), api.salvarOnboarding(onboarding.id, patch)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason).toMatchObject({ code: 'formulario_alterado', status: 409 });
  await expect(api.salvarOnboarding(onboarding.id, patch)).rejects.toMatchObject({ code: 'formulario_alterado', status: 409 });
  expect((await api.getOnboarding(onboarding.id)).onboarding.versao).toBe(1);
});

test('validação de dados recusada não consome revisão', async () => {
  const { onboarding } = await api.criarOnboarding('TRANSFERENCIA');
  const before = sessionStorage.getItem(storageKey);
  await expect(api.salvarOnboarding(onboarding.id, { versao: 0, finalizar: true, dados: {} }))
    .rejects.toMatchObject({ code: 'dados_invalidos', status: 400 });
  expect(sessionStorage.getItem(storageKey)).toBe(before);
  expect((await api.getOnboarding(onboarding.id)).onboarding.versao).toBe(0);
});

test('restauração de legado só preenche versão ausente em memória; revisão existente e dados são preservados', async () => {
  const absent = { id: 'legacy', origem: 'PESSOA_FISICA', status: 'RASCUNHO', dados: { responsavelNome: 'Legado' } };
  const existing = { id: 'versioned', origem: 'PESSOA_FISICA', status: 'RASCUNHO', dados: { responsavelNome: 'Atual' }, versao: 7 };
  const stored = JSON.stringify({ fichas: [['legacy', absent], ['versioned', existing]], etapas: [], seq: 2 });
  sessionStorage.setItem(storageKey, stored);
  jest.resetModules();
  const { createMockApi } = await import('../mockApi');
  const restored = createMockApi({ delay: async () => {} });
  expect((await restored.getOnboarding('legacy')).onboarding).toMatchObject({ ...absent, versao: 0 });
  expect((await restored.getOnboarding('versioned')).onboarding).toMatchObject(existing);
  expect(sessionStorage.getItem(storageKey)).toBe(stored);
  expect((await restored.salvarOnboarding('legacy', { versao: 0, ultimoPasso: 'revisao' })).onboarding.versao).toBe(1);
  expect((await restored.getOnboarding('versioned')).onboarding.versao).toBe(7);
});

test('demanda relacionada nasce na revisão zero e ficha convertida permanece somente leitura', async () => {
  const { onboarding } = await api.criarOnboarding('PESSOA_FISICA');
  const next = await api.criarDemandaOnboarding(onboarding.id, { origem: 'TRANSFERENCIA', versao: 0, chaveSolicitacao: 'demanda-sintetica' });
  expect(next.onboarding.versao).toBe(0);
  const state = JSON.parse(sessionStorage.getItem(storageKey));
  state.fichas.find(([id]) => id === onboarding.id)[1].status = 'CONVERTIDO';
  sessionStorage.setItem(storageKey, JSON.stringify(state));
  jest.resetModules();
  const { createMockApi } = await import('../mockApi');
  const restored = createMockApi({ delay: async () => {} });
  await expect(restored.salvarOnboarding(onboarding.id, { versao: 0, dados: {} })).rejects.toMatchObject({ code: 'onboarding_convertido', status: 409 });
});