// Somente demonstração local. Nenhuma escrita contábil ou integração externa.
const chave = companyId => `altan:demo:avisos-contabeis:${companyId}`;
const vazio = () => ({ correcoes: [], pagamentos: [], historico: [], versoes: {}, fechamentos: {} });
function ler(companyId) { try { return JSON.parse(localStorage.getItem(chave(companyId))) || vazio(); } catch { return vazio(); } }
function salvar(companyId, estado) { localStorage.setItem(chave(companyId), JSON.stringify(estado)); }
export function revisaoMock(companyId, competencia) { return String(ler(companyId).versoes?.[competencia] || "1"); }
export function avisosMock(companyId, { competencia } = {}) {
  const estado = ler(companyId);
  const filtrar = xs => xs.filter(x => !competencia || (x.origem === "CLIENTE" ? x.competenciaPagamento : x.competencia) === competencia);
  const correcoes = filtrar(estado.correcoes), pagamentos = filtrar(estado.pagamentos);
  return { ok: true, total: correcoes.length + pagamentos.length, correcoes, pagamentos, historico: filtrar(estado.historico) };
}
export function corrigirMock(companyId, competencia, { motivo, versao }, antes) {
  if (!motivo?.trim()) throw Error("Informe o motivo da correção.");
  if (versao !== revisaoMock(companyId, competencia)) throw Error("O fechamento mudou. Atualize antes de corrigir.");
  const estado = ler(companyId);
  if (estado.correcoes.some(c => c.competencia === competencia)) throw Error("Este mês já está em correção.");
  const correcao = { id: `demo-correcao-${competencia}-${Date.now()}`, competencia, status: "PENDENTE", motivo, autor: "Contador da demonstração", em: new Date().toISOString(), antes, alteracoes: [] };
  estado.correcoes.push(correcao); estado.versoes[competencia] = String(Number(versao) + 1); salvar(companyId, estado);
  return correcao;
}
export function conferirMock(companyId, competencia, versao, depois) {
  const estado = ler(companyId), correcao = estado.correcoes.find(c => c.competencia === competencia);
  if (correcao && versao !== revisaoMock(companyId, competencia)) throw Error("A revisão mudou. Atualize antes de fechar.");
  if (correcao) { estado.correcoes = estado.correcoes.filter(c => c.id !== correcao.id); estado.historico.push({ ...correcao, status: "RESOLVIDA", depois, resolvidaEm: new Date().toISOString() }); }
  estado.versoes[competencia] = String(Number(revisaoMock(companyId, competencia)) + 1); salvar(companyId, estado);
}
export function retomarMock(companyId, id) {
  const confirmacao = ler(companyId).pagamentos.find(p => p.id === id);
  if (!confirmacao) throw Error("Confirmação não encontrada para esta empresa.");
  return { ok: true, confirmacao: { ...confirmacao, estadoBaixa: "PENDENTE", motivo: "Demonstração: a baixa requer dados contábeis válidos. Nenhum lançamento real foi criado." } };
}

export function estadoFechamentoMock(companyId, competencia) { return ler(companyId).fechamentos?.[competencia] || null; }
export function salvarFechamentoMock(companyId, competencia, circular) { const estado = ler(companyId); estado.fechamentos ||= {}; estado.fechamentos[competencia] = circular; salvar(companyId, estado); }
