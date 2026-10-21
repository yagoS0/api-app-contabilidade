import { aplicabilidadeRotinasMock } from './companyAutomationMock';

const emptyState = () => ({ applicable: null, responsible: '', dueDate: null, note: '', reason: '' });
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const clone = value => JSON.parse(JSON.stringify(value));

// Local demonstration only: reuse uploaded guides, never simulate issuance or delivery.
export function criarManualInssMock(companies, guidesByCompany = new Map()) {
  const saved = new Map(), requests = new Map();
  function read(companyId, competencia) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('Competência inválida.', 422);
    const company = companies.find(c => c.companyId === companyId);
    if (!company) throw fail('Empresa não encontrada.', 404);
    const record = saved.get(`${companyId}:${competencia}`);
    const state = record?.state || emptyState();
    const applicable = state.applicable ?? company.hasProlabore === true;
    const source = (guidesByCompany.get(companyId) || []).filter(g => g.competencia === competencia && g.tipo === 'INSS' && !g.parcelamentoId && !String(g.sourceFileId || '').startsWith('PARC-'));
    const guides = source.map(g => {
      const available = g.status === 'PROCESSED' && g.hasPdf === true;
      return { id: g.id, status: g.status, available, reviewReason: available ? null : g.status === 'VAZIO' ? null : 'Confira o processamento e o PDF da guia.',
        valor: g.valor == null ? null : String(g.valor), vencimento: g.vencimento || null };
    });
    const absent = applicable && source.every(g => g.status === 'VAZIO') ? source.find(g => g.status === 'VAZIO') : null;
    return clone({ absence: absent ? { guideId: absent.id, at: absent.vazioEm || null, by: absent.vazioPor || null, reason: absent.vazioMotivo || null } : null, companyId, companyName: company.razao, competencia, hasProlabore: company.hasProlabore === true,
      regime: aplicabilidadeRotinasMock(company).regime, applicable, applicabilitySource: state.applicable === null ? 'company' : 'month', state,
      revision: JSON.stringify([companyId, competencia, company.hasProlabore, company.regimeTributario, record, source]), guides,
      applicabilityConflict: !applicable && guides.some(g => g.status !== 'VAZIO'),
      status: !applicable ? guides.some(g => g.status !== 'VAZIO') ? 'DOCUMENT_REVIEW' : 'NOT_APPLICABLE' : guides.some(g => !g.available && g.status !== 'VAZIO') ? 'DOCUMENT_REVIEW' : guides.some(g => g.available) ? 'DOCUMENT_AVAILABLE' : absent ? 'DOCUMENT_ABSENT' : 'PENDING_DOCUMENT',
      changedAt: record?.changedAt || null, changedBy: record?.changedBy || null });
  }
  return {
    async getOperationManualInss(competencia) { return { items: companies.map(c => read(c.companyId, competencia)) }; },
    async getCompanyManualInss(companyId, competencia) { return read(companyId, competencia); },
    async saveCompanyManualInss(companyId, competencia, input) {
      const current = read(companyId, competencia);
      const state = input?.state;
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input?.requestId || '') || typeof input.expectedRevision !== 'string') throw fail('Atualize o controle antes de salvar.', 422);
      const keys = Object.keys(emptyState());
      if (!state || Object.keys(state).length !== keys.length || keys.some(k => !Object.hasOwn(state, k))
        || !(state.applicable === null || typeof state.applicable === 'boolean')
        || [['responsible', 120], ['note', 2000], ['reason', 500]].some(([k, max]) => typeof state[k] !== 'string' || state[k].length > max)
        || state.dueDate !== null && (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(state.dueDate)
          || !Number.isFinite(Date.parse(`${state.dueDate}T12:00:00Z`)) || new Date(`${state.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== state.dueDate)) throw fail('Confira os campos e a data do controle manual de INSS.', 422);
      const normalized = { ...state, responsible: state.responsible.trim(), note: state.note.trim(), reason: state.reason.trim() };
      if (normalized.applicable !== null && !normalized.reason) throw fail('Informe o motivo da exceção nesta competência.', 422);
      const identity = JSON.stringify([companyId, competencia, input.expectedRevision, normalized]);
      const previous = requests.get(input.requestId);
      if (previous) {
        if (previous.identity !== identity) throw fail('Solicitação já utilizada para outra alteração.');
        return clone(previous.result);
      }
      if (current.revision !== input.expectedRevision) throw fail('Os dados mudaram. Atualize e confira antes de salvar.');
      if (normalized.applicable !== current.state.applicable && !normalized.reason) throw fail('Informe o motivo da mudança de aplicabilidade nesta competência.', 422);
      saved.set(`${companyId}:${competencia}`, { state: normalized, changedAt: new Date().toISOString(), changedBy: 'mock-user' });
      const result = read(companyId, competencia);
      requests.set(input.requestId, { identity, result });
      return clone(result);
    },
  };
}
