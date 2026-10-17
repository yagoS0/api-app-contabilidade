import { randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { CHECKLIST_FECHAMENTO } from './fechamentoBlockers.js';
import { appendEventoTx, hashSnapshot, jsonSnapshot, listarEventosContabeis } from './AuditoriaContabilService.js';

export class CorrecaoContabilError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new CorrecaoContabilError(code, message, status); };
const PREFIX = 'contabil:correcao:v1:';
const keyFor = (companyId, competencia) => `${PREFIX}${encodeURIComponent(companyId)}:${competencia}`;
function validar(companyId, competencia) {
  if (!companyId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) fail('competencia_invalida', 'Informe a empresa e competência válidas.', 400);
}
export async function snapshotMesTx(tx, companyId, competencia) {
  validar(companyId, competencia);
  const circular = await tx.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
  const entries = await tx.accountingEntry.findMany({ where: { portalClientId: companyId, competencia }, include: { lines: { orderBy: { ordem: 'asc' } } }, orderBy: { id: 'asc' } });
  // Campos fiscais não são mutados nem participam do token contábil.
  const campos = ['id', 'fechadoContabilEm', 'fechadoContabilPor', ...Object.values(CHECKLIST_FECHAMENTO).map((c) => c.campo)];
  return jsonSnapshot({ circular: circular ? Object.fromEntries(campos.map((k) => [k, circular[k] ?? null])) : null, entries: ordenarLancamentos(entries) });
}
function ordenarLancamentos(entries) {
  return jsonSnapshot(entries || []).map(e => ({ ...e, lines: [...(e.lines || [])].sort((a, b) =>
    Number(a.ordem || 0) - Number(b.ordem || 0) || String(a.id || hashSnapshot(a)).localeCompare(String(b.id || hashSnapshot(b)))) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
export const hashLancamentosConferidos = (companyId, competencia, snapshot) =>
  hashSnapshot({ companyId, competencia, entries: ordenarLancamentos(snapshot?.entries) });

export function conferenciaEfetiva(correcao, snapshot, companyId, competencia) {
  const hashLancamentos = hashLancamentosConferidos(companyId, competencia, snapshot);
  const valida = correcao?.conferencia?.hashLancamentos === hashLancamentos;
  const checklist = Object.fromEntries(Object.entries(CHECKLIST_FECHAMENTO).map(([item, def]) =>
    [item, valida && correcao.conferencia.itens?.[item] === true && snapshot.circular?.[def.campo] === true]));
  const campos = Object.fromEntries(Object.entries(CHECKLIST_FECHAMENTO).map(([item, def]) => [def.campo, checklist[item]]));
  return { valida, hashLancamentos, checklist, campos };
}
export function diferencasLancamentos(antes, depois) {
  const a = new Map((antes?.entries || []).map((e) => [e.id, e]));
  const b = new Map((depois?.entries || []).map((e) => [e.id, e]));
  return [...new Set([...a.keys(), ...b.keys()])].filter((id) => hashSnapshot(a.get(id)) !== hashSnapshot(b.get(id)))
    .map((entryId) => ({ entryId, antes: a.get(entryId) || null, depois: b.get(entryId) || null }));
}
async function ler(tx, companyId, competencia) {
  const key = keyFor(companyId, competencia);
  const row = await tx.appSetting.findUnique({ where: { key } });
  return { key, row, state: row?.value || { revision: 0, active: null, history: [] } };
}
async function salvar(tx, leitura, state) {
  const value = jsonSnapshot({ ...state, revision: leitura.state.revision + 1 });
  if (!leitura.row) await tx.appSetting.create({ data: { key: leitura.key, value } });
  else {
    const r = await tx.appSetting.updateMany({ where: { key: leitura.key, value: { equals: leitura.row.value } }, data: { value } });
    if (r.count !== 1) fail('VERSAO_ALTERADA', 'A contabilidade mudou. Atualize a tela antes de continuar.');
  }
}
export async function estadoCorrecaoTx(tx, companyId, competencia) {
  const atual = await snapshotMesTx(tx, companyId, competencia);
  const leitura = await ler(tx, companyId, competencia);
  return { versao: hashSnapshot({ atual, revision: leitura.state.revision }), correcao: leitura.state.active, atual,
    conferencia: conferenciaEfetiva(leitura.state.active, atual, companyId, competencia) };
}

export async function corrigirMesFechado({ companyId, competencia, motivo, versao, autor }, db = prisma) {
  validar(companyId, competencia);
  if (!autor?.id) fail('autor_obrigatorio', 'Identifique o contador responsável.', 403);
  if (!String(motivo || '').trim()) fail('MOTIVO_OBRIGATORIO', 'Informe o motivo da correção.', 400);
  if (!versao) fail('VERSAO_OBRIGATORIA', 'Atualize o fechamento antes de corrigir.', 400);
  return db.$transaction(async (tx) => {
    const leitura = await ler(tx, companyId, competencia);
    const { atual, versao: atualVersao } = await estadoCorrecaoTx(tx, companyId, competencia);
    if (leitura.state.active?.versaoAnterior === versao && leitura.state.active?.autor?.id === autor.id && leitura.state.active?.motivo === motivo.trim()) {
      return { ok: true, fechado: false, competencia, correcao: leitura.state.active, versao: atualVersao, repetido: true };
    }
    if (versao !== atualVersao) fail('VERSAO_ALTERADA', 'O fechamento mudou. Atualize a tela e confira novamente.');
    if (!atual.circular?.fechadoContabilEm) fail('MES_JA_ABERTO', 'A competência já está aberta.');
    const correcao = { id: randomUUID(), companyId, competencia, status: 'PENDENTE', motivo: motivo.trim(), autor, em: new Date().toISOString(), versaoAnterior: versao, antes: atual };
    const data = { fechadoContabilEm: null, fechadoContabilPor: null, ...Object.fromEntries(Object.values(CHECKLIST_FECHAMENTO).map((c) => [c.campo, false])) };
    const r = await tx.companyMonthlyCircular.updateMany({ where: { portalClientId: companyId, competencia, fechadoContabilEm: new Date(atual.circular.fechadoContabilEm) }, data });
    if (r.count !== 1) fail('VERSAO_ALTERADA', 'O fechamento mudou durante a correção.');
    await salvar(tx, leitura, { ...leitura.state, active: correcao });
    await appendEventoTx(tx, { tipo: 'CORRECAO_ABERTA', companyId, entidadeId: correcao.id, chaveEvento: versao, autor, antes: atual, depois: await snapshotMesTx(tx, companyId, competencia), metadados: { competencia, motivo: correcao.motivo } });
    return { ok: true, fechado: false, competencia, correcao, versao: (await estadoCorrecaoTx(tx, companyId, competencia)).versao };
  }, { isolationLevel: 'Serializable' });
}

// Chamado dentro da MESMA transação da alteração. Reseta conferência já feita sobre dados antigos.
export async function registrarAlteracaoTx(tx, { companyId, competencia, autor, antes, depois, metadados = {} }) {
  const leitura = await ler(tx, companyId, competencia);
  if (!leitura.state.active) return;
  await salvar(tx, leitura, { ...leitura.state, active: { ...leitura.state.active, conferencia: null } });
  await tx.companyMonthlyCircular.updateMany({ where: { portalClientId: companyId, competencia }, data: Object.fromEntries(Object.values(CHECKLIST_FECHAMENTO).map((c) => [c.campo, false])) });
  await appendEventoTx(tx, { tipo: 'CORRECAO_ALTERACAO', companyId, entidadeId: leitura.state.active.id, chaveEvento: randomUUID(), autor, antes, depois, metadados: { ...metadados, competencia } });
}

export async function registrarConferenciaTx(tx, { companyId, competencia, autor, antes, depois, item }) {
  const leitura = await ler(tx, companyId, competencia);
  if (!leitura.state.active) return;
  const def = CHECKLIST_FECHAMENTO[item];
  if (!def) fail('item_invalido', 'Item de conferência inválido.', 400);
  const snapshot = await snapshotMesTx(tx, companyId, competencia);
  const efetiva = conferenciaEfetiva(leitura.state.active, snapshot, companyId, competencia);
  const itens = efetiva.valida ? { ...leitura.state.active.conferencia.itens } : {};
  itens[item] = depois?.[def.campo] === true;
  // Um produtor legado pode ter mudado lançamentos sem limpar flags. Somente este novo item
  // foi conferido contra a nova base; os demais precisam de confirmação novamente.
  const flags = Object.fromEntries(Object.entries(CHECKLIST_FECHAMENTO).map(([chave, c]) => [c.campo, itens[chave] === true]));
  await tx.companyMonthlyCircular.updateMany({ where: { portalClientId: companyId, competencia }, data: flags });
  // Incremento monotônico evita aceitar uma confirmação antiga após marcar/desmarcar.
  await salvar(tx, leitura, { ...leitura.state, active: { ...leitura.state.active,
    conferencia: { hashLancamentos: efetiva.hashLancamentos, itens } } });
  await appendEventoTx(tx, { tipo: 'CORRECAO_CHECKLIST', companyId, entidadeId: leitura.state.active.id,
    chaveEvento: String(leitura.state.revision + 1), autor, antes, depois: { ...depois, ...flags },
    metadados: { competencia, item, hashLancamentos: efetiva.hashLancamentos, reiniciada: !efetiva.valida } });
}

export async function concluirCorrecaoTx(tx, { companyId, competencia, versao, autor, snapshotAntes }) {
  const leitura = await ler(tx, companyId, competencia);
  if (!leitura.state.active) return;
  const esperada = hashSnapshot({ atual: snapshotAntes, revision: leitura.state.revision });
  if (versao !== esperada) fail('VERSAO_ALTERADA', 'Os lançamentos mudaram. Confira novamente antes de fechar.');
  const conferida = conferenciaEfetiva(leitura.state.active, snapshotAntes, companyId, competencia);
  if (!conferida.valida || Object.values(conferida.checklist).some(valor => !valor))
    fail('CONFERENCIA_DESATUALIZADA', 'Os lançamentos precisam de nova conferência antes do fechamento.');
  const depois = await snapshotMesTx(tx, companyId, competencia);
  const concluida = { ...leitura.state.active, status: 'RESOLVIDA', resolvidaEm: new Date().toISOString(), resolvidaPor: autor, depois, alteracoes: diferencasLancamentos(leitura.state.active.antes, depois) };
  await salvar(tx, leitura, { ...leitura.state, active: null, history: [...leitura.state.history, concluida] });
  await appendEventoTx(tx, { tipo: 'CORRECAO_CONFERIDA', companyId, entidadeId: concluida.id, chaveEvento: versao, autor, antes: concluida.antes, depois, metadados: { competencia, alteracoes: concluida.alteracoes } });
}

export async function listarCorrecoesContabeis(client, companyId, competencia = null) {
  if (competencia) validar(companyId, competencia);
  const rows = await client.appSetting.findMany({ where: { key: { startsWith: `${PREFIX}${encodeURIComponent(companyId)}:` } } });
  const correcoes = [], historico = [];
  for (const { value } of rows) {
    for (const item of value?.history || []) if (!competencia || item.competencia === competencia) historico.push(item);
    if (value?.active && (!competencia || value.active.competencia === competencia)) {
      const depois = await snapshotMesTx(client, companyId, value.active.competencia);
      correcoes.push({ ...value.active, depois, alteracoes: diferencasLancamentos(value.active.antes, depois) });
    }
  }
  const eventos = (await listarEventosContabeis(client, companyId)).filter((e) => !competencia || e.metadados?.competencia === competencia);
  return { correcoes, historico: [...historico, ...eventos] };
}
