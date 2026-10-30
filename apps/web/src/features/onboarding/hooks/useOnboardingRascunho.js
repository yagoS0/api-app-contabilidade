import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useWorkspaceNavigation } from '../../../app/navigation/WorkspaceNavigation.shared';
import { podarInvisiveis, rascunhoVazio } from '../lib/onboardingSpec';

const DEBOUNCE_MS = 800;

// Only refusals documented for PATCH /firm/onboardings/:id. Status alone is not proof:
// loading after commit can fail, and generic 4xx/5xx or malformed success stays uncertain.
const definitiveRefusal = error =>
  (error?.status === 400 && ['validation_failed', 'dados_invalidos', 'origem_invalida'].includes(error.code)) ||
  (error?.status === 409 && ['formulario_alterado', 'onboarding_convertido'].includes(error.code));
// Each API/id pair owns its queue, revision and timers. Old requests may finish
// remotely, but cannot update the new editor or start another queued write.
export function useOnboardingRascunho({ api, onboardingId }) {
  const workspace = useWorkspaceNavigation();
  const [, render] = useState(0);
  const state = useMemo(() => ({ api, id: onboardingId, alive: true, onboarding: null,
    dados: {}, saved: {}, loading: true, error: null, unresolvedWriteError: null, definitiveWriteError: null, status: 'salvo', revision: null,
    edit: 0, confirmed: 0, pending: false, timer: null, queue: Promise.resolve(),
    epoch: 0, suspended: false, running: 0, queued: 0, remoteCheck: null, checking: false, checkError: null, checkSequence: 0, uncertainAttempt: null }), [api, onboardingId]);
  const update = useCallback(() => { if (state.alive) render(n => n + 1); }, [state]);
  const stopTimer = useCallback(() => { clearTimeout(state.timer); state.timer = null; }, [state]);
  const isCurrent = useCallback(() => state.alive, [state]);
  const conferirRemoto = useCallback(async () => {
    if (!state.alive || !state.unresolvedWriteError || state.running || state.queued) return;
    stopTimer();
    const sequence = ++state.checkSequence, epoch = state.epoch, edit = state.edit;
    state.checking = true; state.remoteCheck = null; state.checkError = null; update();
    try {
      const response = await api.getOnboarding(onboardingId);
      if (!state.alive || epoch !== state.epoch || sequence !== state.checkSequence) return;
      const record = response?.onboarding || response;
      if (response?.ok === false || record?.id !== onboardingId || !Number.isInteger(record.versao) || record.versao < state.revision ||
          typeof record.origem !== 'string' || !record.dados || typeof record.dados !== 'object' || Array.isArray(record.dados)) {
        throw new Error('Conferência sem ficha e versão válidas.');
      }
      // A GET is an observation, never acknowledgement/authorship of the lost response.
      state.remoteCheck = { record, edit, epoch, sequence };
      return record;
    } catch (error) {
      if (state.alive && epoch === state.epoch && sequence === state.checkSequence) state.checkError = error;
    } finally {
      if (state.alive && sequence === state.checkSequence) { state.checking = false; update(); }
    }
  }, [api, onboardingId, state, stopTimer, update]);
  const checkedChoice = useCallback(check => {
    if (!state.alive || !state.unresolvedWriteError || !check || check !== state.remoteCheck || state.checking ||
        state.running || state.queued || check.epoch !== state.epoch || check.edit !== state.edit) {
      throw new Error('A edição ou a conferência mudou. Confira novamente antes de escolher.');
    }
    return check.record;
  }, [state]);
  const carregar = useCallback(async () => {
    if (state.unresolvedWriteError) return conferirRemoto();
    const epoch = state.epoch;
    state.loading = true; update();
    try {
      const response = await api.getOnboarding(onboardingId);
      if (!state.alive || state.epoch !== epoch) return;
      const record = response?.onboarding || response;
      if (record?.id !== onboardingId || !Number.isInteger(record.versao)) throw new Error('Resposta da ficha inválida.');
      if (state.revision != null && record.versao < state.revision) return;
      if (state.unresolvedWriteError) return; // An older GET cannot reconcile a newly uncertain write.
      state.onboarding = record; state.revision = record.versao;
      state.saved = { ...rascunhoVazio(record.origem), cartoesPessoas: 1, ...(record.dados || {}) };
      if (!state.pending) state.dados = state.saved;
      state.error = state.unresolvedWriteError || state.definitiveWriteError || null;
    } catch (error) { if (state.alive && epoch === state.epoch) state.error = error; }
    finally { if (state.alive && epoch === state.epoch) { state.loading = false; update(); } }
  }, [api, onboardingId, state, update, conferirRemoto]);
  useLayoutEffect(() => {
    state.alive = true;
    carregar();
    return () => { state.alive = false; state.epoch++; stopTimer(); };
  }, [state, carregar, stopTimer]);

  const enviar = useCallback((patch, edit = state.edit, explicit = false, recovery = null) => {
    const key = JSON.stringify([patch, edit]);
    if (state.lastRequest?.key === key) return state.lastRequest.promise;
    if (state.unresolvedWriteError && !recovery) return Promise.reject(state.unresolvedWriteError);
    const epoch = state.epoch;
    state.queued++; update();
    const predecessorPending = state.running > 0 || state.queued > 1;
    const task = state.queue.then(() => null, error => error).then(async predecessorError => {
      state.queued--;
      update();
      if (!state.alive || epoch !== state.epoch) throw new Error('Edição encerrada.');
      if (predecessorPending && predecessorError) throw predecessorError;
      if (state.suspended && !explicit) { state.pending = true; update(); return null; }
      if (recovery) checkedChoice(recovery);
      const attemptedRevision = recovery ? recovery.record.versao : state.revision;
      if (recovery) state.remoteCheck = null;
      const attempt = { revision: attemptedRevision, origem: state.onboarding?.origem, edit, patch };
      state.running++; state.status = 'salvando'; update();
      state.activeTask = task;
      try {
        const response = await api.salvarOnboarding(onboardingId, { ...patch, versao: attemptedRevision });
        const record = response?.onboarding || response;
        if (response?.ok === false || record?.id !== onboardingId || !Number.isInteger(record.versao) || record.versao <= attemptedRevision) {
          throw new Error('Salvamento sem confirmação válida da ficha e versão.');
        }
        if (!state.alive) throw new Error('Contexto da edição encerrado.');
        state.revision = record.versao; state.onboarding = record;
        state.saved = { ...rascunhoVazio(record.origem), cartoesPessoas: 1, ...(record.dados || {}) };
        state.confirmed = Math.max(state.confirmed, edit);
        if (state.edit === edit) {
          state.pending = false;
          if (patch.origem) state.dados = state.saved;
        }
        state.error = null; state.unresolvedWriteError = null; state.definitiveWriteError = null; state.uncertainAttempt = null; state.remoteCheck = null;
        state.status = state.pending ? 'pendente' : 'salvo';
        return record;
      } catch (error) {
        if (state.alive) {
          state.pending = true; state.error = error;
          // A documented refusal is not an acknowledgement of a write.
          // A previous uncertain attempt remains unresolved even after a later refusal.
          if (definitiveRefusal(error)) state.definitiveWriteError = error;
          else { state.unresolvedWriteError ||= error; state.uncertainAttempt ||= attempt; }
          state.status = 'erro';
        }
        throw error;
      } finally { state.running--; if (state.activeTask === task) state.activeTask = null; update(); }
    });
    state.queue = task;
    state.lastRequest = { key, promise: task };
    task.then(() => { if (state.lastRequest?.promise === task) state.lastRequest = null; }, () => { if (state.lastRequest?.promise === task) state.lastRequest = null; });
    return task;
  }, [api, onboardingId, state, update, checkedChoice]);
  const usarRemoto = useCallback(check => {
    const record = checkedChoice(check);
    stopTimer();
    state.onboarding = record; state.revision = record.versao;
    state.saved = { ...rascunhoVazio(record.origem), cartoesPessoas: 1, ...record.dados };
    state.dados = state.saved; state.edit++; state.confirmed = state.edit; state.pending = false;
    state.error = null; state.unresolvedWriteError = null; state.definitiveWriteError = null;
    state.uncertainAttempt = null; state.remoteCheck = null; state.checkError = null; state.status = 'salvo';
    update();
    return record; // local adoption only: no PATCH, no attribution of the previous write
  }, [state, checkedChoice, stopTimer, update]);
  const manterEdicao = useCallback(check => {
    const record = checkedChoice(check);
    if (record.origem !== state.onboarding?.origem || !record.status || record.status !== state.onboarding?.status) {
      throw new Error('A origem ou a situação mudou. Confira os dados vigentes; a edição local permanece preservada.');
    }
    stopTimer();
    // New, consented draft-only CAS. Never replay finalizar, origem or ultimoPasso.
    // No pruning against a changed origin; server validates the full local draft.
    return enviar({ dados: { ...state.dados } }, state.edit, true, check);
  }, [state, checkedChoice, stopTimer, enviar]);
  const salvarAgora = useCallback((extra = {}) => {
    stopTimer();
    return enviar({ dados: podarInvisiveis(state.onboarding?.origem, state.dados), ...extra });
  }, [state, enviar, stopTimer]);
  const schedule = useCallback(() => {
    stopTimer();
    if (state.suspended || !state.alive || !state.pending || state.unresolvedWriteError || state.definitiveWriteError) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      enviar({ dados: podarInvisiveis(state.onboarding?.origem, state.dados) }, state.edit, false).catch(() => {});
    }, DEBOUNCE_MS);
  }, [state, stopTimer, enviar]);
  const alterarCampo = useCallback((campo, valor) => {
    if (!state.alive) return;
    state.dados = { ...state.dados, [campo]: valor,
      ...(campo === 'socios' && Array.isArray(valor) ? { cartoesPessoas: Math.max(1, valor.length) } : {}) };
    state.edit++; state.pending = true;
    state.status = state.unresolvedWriteError || state.definitiveWriteError ? 'erro' : 'pendente';
    update(); schedule();
  }, [state, update, schedule]);
  const trocarOrigem = useCallback(origem => {
    stopTimer();
    return enviar({ origem });
  }, [enviar, stopTimer]);
  const finalizar = useCallback(() => salvarAgora({ finalizar: true }), [salvarAgora]);
  const suspend = useCallback(() => { state.suspended = true; stopTimer(); }, [state, stopTimer]);
  const resume = useCallback(() => { state.suspended = false; schedule(); }, [state, schedule]);
  const invalidate = useCallback(() => { state.alive = false; state.epoch++; stopTimer(); }, [state, stopTimer]);
  const save = useCallback(async () => {
    stopTimer();
    // A finish/origin/step action already accepted must settle before a draft save.
    const running = state.running > 0 || state.queued > 0;
    try { await state.queue; } catch (error) { if (running) throw error; }
    if (!state.alive) throw new Error('Contexto da edição encerrado.');
    if (state.pending) await enviar({ dados: podarInvisiveis(state.onboarding?.origem, state.dados) }, state.edit, true);
    return { ok: !state.pending, context: state, revision: state.revision };
  }, [state, stopTimer, enviar]);
  const discard = useCallback(async () => {
    suspend();
    state.epoch++; // invalidates work that has not started; no remote cancellation
    const active = state.activeTask;
    const queued = state.queue;
    // A cancelled queued item must not hide failure of the remote write ahead of it.
    const outcomes = await Promise.allSettled([active, queued]);
    if (active && outcomes[0].status === 'rejected') throw outcomes[0].reason;
    if (!state.alive) throw new Error('Contexto da edição encerrado.');
    // Queue cancellation is local. A failed write remains unresolved even after
    // activeTask was cleared, or when a cancelled successor masks its rejection.
    if (state.unresolvedWriteError) throw state.unresolvedWriteError;
    state.dados = state.saved; state.pending = false; state.error = null; state.definitiveWriteError = null; state.status = 'salvo';
    state.edit++; state.confirmed = state.edit; update();
    return { ok: true, context: state, revision: state.revision };
  }, [state, suspend, update]);
  useEffect(() => {
    if (workspace) return undefined;
    const warn = event => {
      if (state.pending || state.running || state.queued) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [workspace, state]);
  return { onboarding: state.onboarding, dados: state.dados, carregando: state.loading,
    erro: state.error, estadoSalvamento: state.status, alterarCampo, trocarOrigem,
    salvarAgora, finalizar, recarregar: carregar, isCurrent,
    recuperacao: state.unresolvedWriteError ? { conferindo: state.checking, erro: state.checkError, conferido: state.remoteCheck,
      tentativa: state.uncertainAttempt, edit: state.edit, conferirRemoto, usarRemoto, manterEdicao } : null,
    editor: { context: state, get dirty() { return state.pending || state.running > 0 || state.queued > 0; },
      save, discard, suspend, resume, invalidate },
  };
}
export default useOnboardingRascunho;
