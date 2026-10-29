import { act, renderHook, waitFor } from '@testing-library/react';
import { useOnboardingRascunho } from '../useOnboardingRascunho';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const record = (id = 'o', versao = 1, dados = {}) => ({ id, versao, origem: 'PESSOA_FISICA', status: 'RASCUNHO', dados });
function api() {
  return { getOnboarding: jest.fn(async id => record(id)),
    salvarOnboarding: jest.fn(async (id, patch) => record(id, patch.versao + 1, patch.dados)) };
}
async function setup(client = api()) {
  const hook = renderHook(props => useOnboardingRascunho(props), { initialProps: { api: client, onboardingId: 'o' } });
  await waitFor(() => expect(hook.result.current.carregando).toBe(false));
  return { ...hook, api: client };
}
afterEach(() => jest.useRealTimers());

test('guardar durante intenção suspensa persiste o rascunho, sem finalizar', async () => {
  const hook = await setup();
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Guardado'); hook.result.current.editor.suspend(); });
  await act(async () => { expect((await hook.result.current.editor.save()).ok).toBe(true); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.api.salvarOnboarding.mock.calls[0][1]).toMatchObject({ dados: { responsavelNome: 'Guardado' }, versao: 1 });
  expect(hook.api.salvarOnboarding.mock.calls[0][1].finalizar).toBeUndefined();
});

test('descarte espera escrita ativa, cancela fila e não mascara conflito da escrita', async () => {
  const hook = await setup(); const response = deferred();
  hook.api.salvarOnboarding.mockReturnValueOnce(response.promise);
  let first, queued, discard;
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Primeiro'); first = hook.result.current.salvarAgora(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => {
    hook.result.current.alterarCampo('responsavelNome', 'Posterior');
    queued = hook.result.current.salvarAgora();
    hook.result.current.editor.suspend();
    discard = hook.result.current.editor.discard();
  });
  const results = Promise.allSettled([first, queued, discard]);
  await act(async () => {
    response.reject(Object.assign(new Error('Conflito ativo'), { status: 409, code: 'formulario_alterado' }));
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.dados.responsavelNome).toBe('Posterior');
  expect(hook.result.current.editor.dirty).toBe(true);
  // Nova decisão posterior à recusa definitiva; a operação anterior continua rejeitada.
  await act(async () => { await expect(hook.result.current.editor.discard()).resolves.toMatchObject({ ok: true }); });
  expect(hook.result.current.dados.responsavelNome || '').toBe('');
  expect(hook.result.current.editor.dirty).toBe(false);
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test.each(['incerto'])('descarte após escrita encerrada com %s conserva erro e conteúdo', async outcome => {
  const hook = await setup();
  const error = Object.assign(new Error(outcome), { status: outcome === '409' ? 409 : 503 });
  hook.api.salvarOnboarding.mockRejectedValueOnce(error);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Preservar'));
  await act(async () => { await expect(hook.result.current.salvarAgora()).rejects.toBe(error); });
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => { await expect(hook.result.current.editor.discard()).rejects.toBe(error); });
    expect(hook.result.current.dados.responsavelNome).toBe('Preservar');
    expect(hook.result.current.erro).toBe(error);
    expect(hook.result.current.editor.dirty).toBe(true);
  }
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test('descartar item ainda não iniciado não inventa falha remota', async () => {
  const hook = await setup();
  let queued, discard;
  act(() => {
    hook.result.current.alterarCampo('responsavelNome', 'Local');
    queued = hook.result.current.salvarAgora();
    discard = hook.result.current.editor.discard();
  });
  await act(async () => {
    const outcomes = await Promise.allSettled([queued, discard]);
    expect(outcomes[0].status).toBe('rejected');
    expect(outcomes[1]).toMatchObject({ status: 'fulfilled', value: { ok: true } });
  });
  expect(hook.api.salvarOnboarding).not.toHaveBeenCalled();
  expect(hook.result.current.editor.dirty).toBe(false);
});

test('confirmação de revisão anterior não limpa edição posterior', async () => {
  const hook = await setup(); const response = deferred();
  hook.api.salvarOnboarding.mockReturnValueOnce(response.promise);
  let first;
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Primeiro'); first = hook.result.current.salvarAgora(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Posterior'); hook.result.current.editor.suspend(); });
  await act(async () => { response.resolve(record('o', 2, { responsavelNome: 'Primeiro' })); await first; });
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.result.current.dados.responsavelNome).toBe('Posterior');
  await act(async () => { await hook.result.current.editor.save(); });
  expect(hook.api.salvarOnboarding.mock.calls[1][1]).toMatchObject({ versao: 2, dados: { responsavelNome: 'Posterior' } });
});

test.each([undefined, false, {}, { id: 'other', versao: 2 }, record('o', 1)])('resposta inválida %p conserva edição e exige conferência antes de novo CAS', async response => {
  const hook = await setup();
  hook.api.salvarOnboarding.mockResolvedValueOnce(response);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Novo'));
  await act(async () => { await expect(hook.result.current.salvarAgora()).rejects.toThrow(); });
  expect(hook.result.current.dados.responsavelNome).toBe('Novo');
  expect(hook.result.current.editor.dirty).toBe(true);
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toThrow(); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  const check = hook.result.current.recuperacao.conferido;
  await act(async () => { await hook.result.current.recuperacao.manterEdicao(check); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(2);
  expect(hook.result.current.editor.dirty).toBe(false);
});

test('409 não perde edição posterior e a fila usa a revisão confirmada', async () => {
  const hook = await setup();
  const response = deferred(); hook.api.salvarOnboarding.mockReturnValueOnce(response.promise);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Primeiro'));
  let first;
  act(() => { first = hook.result.current.salvarAgora(); });
  await act(async () => { await Promise.resolve(); });
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Posterior'));
  await act(async () => { response.reject(Object.assign(new Error('Conflito'), { status: 409, code: 'formulario_alterado' })); await expect(first).rejects.toThrow('Conflito'); });
  expect(hook.result.current.dados.responsavelNome).toBe('Posterior');
  await act(async () => { await hook.result.current.editor.save(); });
  expect(hook.api.salvarOnboarding.mock.calls[1][1]).toMatchObject({ versao: 1, dados: { responsavelNome: 'Posterior' } });
});

test('suspender antes de 800ms impede autosave; cancelar retoma; descartar não ressuscita timer', async () => {
  const hook = await setup(); jest.useFakeTimers();
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Novo'); hook.result.current.editor.suspend(); });
  await act(async () => { jest.advanceTimersByTime(1600); });
  expect(hook.api.salvarOnboarding).not.toHaveBeenCalled();
  act(() => hook.result.current.editor.resume());
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Descartar'); hook.result.current.editor.suspend(); });
  await act(async () => { await hook.result.current.editor.discard(); jest.advanceTimersByTime(1600); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.dados.responsavelNome).toBe('Novo');
});

test('guardar espera gravação ativa sem duplicar finalizar; repetição compartilha fila', async () => {
  const hook = await setup(); const response = deferred();
  hook.api.salvarOnboarding.mockReturnValueOnce(response.promise);
  let first, duplicate, saving;
  act(() => { first = hook.result.current.finalizar(); duplicate = hook.result.current.finalizar(); });
  await act(async () => { await Promise.resolve(); });
  act(() => { hook.result.current.editor.suspend(); saving = hook.result.current.editor.save(); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  await act(async () => { response.resolve(record('o', 2)); await Promise.all([first, duplicate, saving]); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.api.salvarOnboarding.mock.calls[0][1].finalizar).toBe(true);
});

test('API/id novos isolam resposta antiga e fila ainda não iniciada', async () => {
  const hook = await setup(); const old = deferred();
  hook.api.salvarOnboarding.mockReturnValueOnce(old.promise);
  let pending;
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Antigo'); pending = hook.result.current.salvarAgora(); });
  await act(async () => { await Promise.resolve(); });
  const next = api(); hook.rerender({ api: next, onboardingId: 'b' });
  await waitFor(() => expect(hook.result.current.onboarding?.id).toBe('b'));
  await act(async () => { old.resolve(record('o', 2, { responsavelNome: 'Antigo' })); await expect(pending).rejects.toThrow(); });
  expect(hook.result.current.onboarding.id).toBe('b');
  expect(hook.result.current.dados.responsavelNome).not.toBe('Antigo');
  expect(next.salvarOnboarding).not.toHaveBeenCalled();
});

test('nova decisão após 409 definitivo descarta local sem salvar novamente', async () => {
  const hook = await setup();
  const error = Object.assign(new Error('Recusa CAS'), { status: 409, code: 'formulario_alterado' });
  hook.api.salvarOnboarding.mockRejectedValueOnce(error);
  act(() => { hook.result.current.editor.suspend(); hook.result.current.alterarCampo('responsavelNome', 'Local'); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(error); });
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  await act(async () => { await expect(hook.result.current.editor.discard()).resolves.toMatchObject({ ok: true }); });
  expect(hook.result.current.editor.dirty).toBe(false);
  expect(hook.result.current.dados.responsavelNome || '').toBe('');
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test('incerteza sobrevive à releitura e bloqueia novo envio/descarte sem fingir conciliação', async () => {
  const hook = await setup(); const error = new Error('Resposta perdida');
  hook.api.salvarOnboarding.mockRejectedValueOnce(error);
  act(() => { hook.result.current.editor.suspend(); hook.result.current.alterarCampo('responsavelNome', 'Local'); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(error); });
  await act(async () => { await hook.result.current.recarregar(); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(error); });
  await act(async () => { await expect(hook.result.current.editor.discard()).rejects.toBe(error); });
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});
// Recusas documentadas antes de gravação não exigem sucesso de outra escrita para abandonar local.
test.each(['dados_invalidos', 'validation_failed', 'origem_invalida'])('400 %s permite corrigir e guardar por decisão explícita', async code => {
  const hook = await setup();
  const refusal = Object.assign(new Error('Corrija os dados'), { status: 400, code });
  hook.api.salvarOnboarding.mockRejectedValueOnce(refusal);
  act(() => { hook.result.current.editor.suspend(); hook.result.current.alterarCampo('responsavelNome', 'Inválido'); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(refusal); });
  expect(hook.result.current.erro).toBe(refusal);
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Corrigido'));
  await act(async () => { await expect(hook.result.current.editor.save()).resolves.toMatchObject({ ok: true, revision: 2 }); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(2);
  expect(hook.api.salvarOnboarding.mock.calls[1][1]).toMatchObject({ versao: 1, dados: { responsavelNome: 'Corrigido' } });
  expect(hook.result.current.editor.dirty).toBe(false);
  expect(hook.result.current.erro).toBeNull();
});

test('400 dados_invalidos permite nova decisão de descarte sem reenviar', async () => {
  const hook = await setup();
  const refusal = Object.assign(new Error('Dados inválidos'), { status: 400, code: 'dados_invalidos' });
  hook.api.salvarOnboarding.mockRejectedValueOnce(refusal);
  act(() => { hook.result.current.editor.suspend(); hook.result.current.alterarCampo('responsavelNome', 'Local'); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(refusal); });
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  expect(hook.result.current.editor.dirty).toBe(true);
  await act(async () => { await expect(hook.result.current.editor.discard()).resolves.toMatchObject({ ok: true, revision: 1 }); });
  expect(hook.result.current.dados.responsavelNome || '').toBe('');
  expect(hook.result.current.editor.dirty).toBe(false);
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test.each([
  ['rede', null, null], ['500', 500, 'erro_interno'],
  ['400 desconhecido', 400, 'outro'], ['409 sem código', 409, null],
  ['404 após confirmação possível', 404, 'onboarding_nao_encontrado'],
  ['500 com código de validação', 500, 'dados_invalidos'],
])('%s permanece incerto após releitura, edição e tentativa explícita', async (_name, status, code) => {
  const hook = await setup();
  const uncertain = Object.assign(new Error('Resultado não comprovado'), { status, code });
  const laterRefusal = Object.assign(new Error('Validação posterior'), { status: 400, code: 'dados_invalidos' });
  hook.api.salvarOnboarding.mockRejectedValueOnce(uncertain).mockRejectedValueOnce(laterRefusal);
  act(() => { hook.result.current.editor.suspend(); hook.result.current.alterarCampo('responsavelNome', 'Local'); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(uncertain); });
  await act(async () => { await hook.result.current.recarregar(); });
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Editado depois'));
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toBe(uncertain); });
  await act(async () => { await expect(hook.result.current.editor.discard()).rejects.toBe(uncertain); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.erro).toBe(uncertain);
  expect(hook.result.current.editor.dirty).toBe(true);
});

test('DTO de sucesso inválido não vira recusa definitiva nem libera descarte', async () => {
  const hook = await setup(); hook.api.salvarOnboarding.mockResolvedValueOnce({ onboarding: record('outro', 2) });
  act(() => { hook.result.current.editor.suspend(); hook.result.current.alterarCampo('responsavelNome', 'Local'); });
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toThrow('Salvamento sem confirmação válida'); });
  await act(async () => { await expect(hook.result.current.editor.discard()).rejects.toThrow('Salvamento sem confirmação válida'); });
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});
// Additional isolated proposal: never suspend before or after the first autosave error.
test.each([
  [400, 'dados_invalidos'],
  [500, 'erro_interno'],
])('debounce não reenvia após %s sem suspensão do editor', async (status, code) => {
  const hook = await setup();
  jest.useFakeTimers();
  const refusal = Object.assign(new Error('Falha sintética'), { status, code });
  hook.api.salvarOnboarding.mockRejectedValueOnce(refusal);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Primeiro'));
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.erro).toBe(refusal);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Corrigido localmente'));
  await act(async () => { await jest.advanceTimersByTimeAsync(2400); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.dados.responsavelNome).toBe('Corrigido localmente');
  expect(hook.result.current.estadoSalvamento).toBe('erro');
  expect(hook.result.current.erro).toBe(refusal);
  expect(hook.result.current.editor.dirty).toBe(true);
  hook.unmount();
});
async function uncertainHook() {
  const hook = await setup();
  const response = deferred();
  hook.api.salvarOnboarding.mockReturnValueOnce(response.promise);
  let pending;
  act(() => { hook.result.current.alterarCampo('responsavelNome', 'Local'); pending = hook.result.current.finalizar(); });
  await waitFor(() => expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1));
  expect(hook.api.salvarOnboarding.mock.calls[0][1].finalizar).toBe(true);
  act(() => hook.result.current.editor.suspend());
  await act(async () => { response.reject(new Error('Resposta perdida')); await expect(pending).rejects.toThrow('Resposta perdida'); });
  expect(hook.result.current.editor.context.suspended).toBe(true);
  expect(hook.result.current.recuperacao).not.toBeNull();
  return hook;
}

test.each([1, 2])('GET após resposta perdida com versão remota %s não confirma autoria; adoção explícita não faz PATCH', async version => {
  const hook = await uncertainHook();
  hook.api.getOnboarding.mockResolvedValueOnce(record('o', version, { responsavelNome: version === 2 ? 'Local' : 'Anterior' }));
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  expect(hook.result.current.editor.context.revision).toBe(1);
  expect(hook.result.current.erro.message).toBe('Resposta perdida');
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  const check = hook.result.current.recuperacao.conferido;
  act(() => hook.result.current.recuperacao.usarRemoto(check));
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.editor.dirty).toBe(false);
  expect(hook.result.current.recuperacao).toBeNull();
  expect(hook.result.current.dados.responsavelNome).toBe(version === 2 ? 'Local' : 'Anterior');
  expect(hook.result.current.editor.context.revision).toBe(version);
});

test('manter edição é novo CAS explícito sem repetir finalizar/origem; não promove revisão enquanto aguarda', async () => {
  const hook = await uncertainHook();
  hook.api.getOnboarding.mockResolvedValueOnce(record('o', 4, { responsavelNome: 'Outra pessoa' }));
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  const check = hook.result.current.recuperacao.conferido, response = deferred();
  hook.api.salvarOnboarding.mockReturnValueOnce(response.promise);
  let pending;
  act(() => { pending = hook.result.current.recuperacao.manterEdicao(check); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(hook.result.current.editor.context.revision).toBe(1);
  expect(hook.api.salvarOnboarding.mock.calls[1][1]).toEqual({ dados: hook.result.current.dados, versao: 4 });
  expect(hook.api.salvarOnboarding.mock.calls[0][1].finalizar).toBe(true);
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Posterior'));
  await act(async () => { response.resolve(record('o', 5, { responsavelNome: 'Local' })); await pending; });
  expect(hook.result.current.dados.responsavelNome).toBe('Posterior');
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.result.current.editor.context.revision).toBe(5);
});

test('falha GET mantém rascunho, erro original e bloqueio sem novo PATCH', async () => {
  const hook = await uncertainHook();
  hook.api.getOnboarding.mockRejectedValueOnce(new Error('Leitura indisponível'));
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  expect(hook.result.current.recuperacao.erro.message).toBe('Leitura indisponível');
  expect(hook.result.current.recuperacao.conferido).toBeNull();
  expect(hook.result.current.erro.message).toBe('Resposta perdida');
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test('409 entre GET e nova intenção CAS preserva edição e exige nova conferência', async () => {
  const hook = await uncertainHook();
  hook.api.getOnboarding.mockResolvedValueOnce(record('o', 4));
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  const check = hook.result.current.recuperacao.conferido;
  hook.api.salvarOnboarding.mockRejectedValueOnce(Object.assign(new Error('Conflito'), { status: 409, code: 'formulario_alterado' }));
  await act(async () => { await expect(hook.result.current.recuperacao.manterEdicao(check)).rejects.toThrow('Conflito'); });
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  expect(hook.result.current.editor.dirty).toBe(true);
  expect(hook.result.current.recuperacao.conferido).toBeNull();
  expect(hook.result.current.editor.context.revision).toBe(1);
  await act(async () => { await expect(hook.result.current.editor.save()).rejects.toThrow('Resposta perdida'); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(2);
});

test('edição posterior ao GET invalida escolha velha sem apagar campos', async () => {
  const hook = await uncertainHook();
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  const check = hook.result.current.recuperacao.conferido;
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Posterior'));
  expect(() => hook.result.current.recuperacao.usarRemoto(check)).toThrow('conferência mudou');
  expect(() => hook.result.current.recuperacao.manterEdicao(check)).toThrow('conferência mudou');
  expect(hook.result.current.dados.responsavelNome).toBe('Posterior');
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test.each([{ origem: 'ABERTURA' }, { status: 'CONVERTIDO' }])('contexto remoto divergente %p não poda nem envia rascunho', async changed => {
  const hook = await uncertainHook();
  hook.api.getOnboarding.mockResolvedValueOnce({ ...record('o', 4), ...changed });
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  expect(() => hook.result.current.recuperacao.manterEdicao(hook.result.current.recuperacao.conferido)).toThrow('origem ou a situação mudou');
  expect(hook.result.current.dados.responsavelNome).toBe('Local');
  expect(hook.result.current.onboarding.origem).toBe('PESSOA_FISICA');
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
});

test('GET e ações de contexto antigo não afetam outra ficha', async () => {
  const hook = await uncertainHook(), response = deferred();
  const oldRecovery = hook.result.current.recuperacao;
  hook.api.getOnboarding.mockReturnValueOnce(response.promise);
  let checking;
  act(() => { checking = oldRecovery.conferirRemoto(); });
  const next = api(); hook.rerender({ api: next, onboardingId: 'b' });
  await waitFor(() => expect(hook.result.current.onboarding?.id).toBe('b'));
  await act(async () => { response.resolve(record('o', 3)); await checking; });
  expect(() => oldRecovery.usarRemoto({})).toThrow();
  expect(hook.result.current.recuperacao).toBeNull();
  expect(hook.result.current.onboarding.id).toBe('b');
  expect(next.salvarOnboarding).not.toHaveBeenCalled();
});

test('conferência não agenda retry automático, nem depois de nova edição', async () => {
  const hook = await uncertainHook(); jest.useFakeTimers();
  act(() => hook.result.current.editor.resume());
  await act(async () => { await hook.result.current.recuperacao.conferirRemoto(); });
  act(() => hook.result.current.alterarCampo('responsavelNome', 'Posterior'));
  await act(async () => { await jest.advanceTimersByTimeAsync(2400); });
  expect(hook.api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(hook.result.current.editor.dirty).toBe(true);
});