jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { corrigirMesFechado, estadoCorrecaoTx, registrarAlteracaoTx, concluirCorrecaoTx, listarCorrecoesContabeis, diferencasLancamentos, registrarConferenciaTx, hashLancamentosConferidos } from '../CorrecaoMesContabilService.js';

import { CHECKLIST_FECHAMENTO } from '../fechamentoBlockers.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
function banco() {
  let data = { settings: {}, circular: { id: 'c', portalClientId: 'emp', competencia: '2026-09', estado: 'transmitido', fechadoContabilEm: '2026-10-01T10:00:00.000Z', fechadoContabilPor: 'outro', despesasOk: true }, entries: [{ id: 'l', competencia: '2026-09', portalClientId: 'emp', historico: 'antes', lines: [] }] };
  const matches = (row, where) => Object.entries(where).every(([k, v]) => k === 'value' ? JSON.stringify(row[k]) === JSON.stringify(v.equals) : String(row[k]) === String(v instanceof Date ? v.toISOString() : v));
  const db = {
    appSetting: {
      findUnique: jest.fn(async ({ where }) => clone(data.settings[where.key] || null)),
      findMany: jest.fn(async ({ where }) => clone(Object.values(data.settings).filter(r => r.key.startsWith(where.key.startsWith)))),
      create: jest.fn(async ({ data: row }) => { if (data.settings[row.key]) throw new Error('duplicate'); data.settings[row.key] = clone(row); return row; }),
      updateMany: jest.fn(async ({ where, data: patch }) => { const row = data.settings[where.key]; if (!row || !matches(row, where)) return { count: 0 }; Object.assign(row, clone(patch)); return { count: 1 }; }),
    },
    companyMonthlyCircular: {
      findUnique: jest.fn(async ({ where }) => where.portalClientId_competencia.portalClientId === 'emp' ? clone(data.circular) : null),
      updateMany: jest.fn(async ({ where, data: patch }) => { if (!matches(data.circular, where)) return { count: 0 }; Object.assign(data.circular, clone(patch)); return { count: 1 }; }),
    },
    accountingEntry: { findMany: jest.fn(async ({ where }) => clone(data.entries.filter(e => matches(e, where)))) },
    $transaction: jest.fn(async fn => { const original = clone(data); try { return await fn(db); } catch (e) { data = original; throw e; } }),
    state: () => data,
  };
  return db;
}
const args = { companyId: 'emp', competencia: '2026-09', motivo: 'Corrigir lançamento duplicado', autor: { id: 'contador' } };
async function abrir(db) { return corrigirMesFechado({ ...args, versao: (await estadoCorrecaoTx(db, 'emp', '2026-09')).versao }, db); }
test('abre somente contabilidade, limpa checklist e preserva snapshot e fiscal', async () => {
  const db = banco(); const r = await abrir(db);
  expect(r.fechado).toBe(false);
  expect(db.state().circular.estado).toBe('transmitido');
  expect(db.state().circular.fechadoContabilEm).toBeNull();
  expect(db.state().circular.despesasOk).toBe(false);
  expect(r.correcao.antes.circular.fechadoContabilPor).toBe('outro');
  const lista = await listarCorrecoesContabeis(db, 'emp', '2026-09');
  expect(lista.correcoes).toHaveLength(1);
  expect(lista.historico[0].autor.id).toBe('contador');
  expect(await listarCorrecoesContabeis(db, 'outra')).toEqual({ correcoes: [], historico: [] });
});
test('repetição mesma versão/autor/motivo não cria outro evento', async () => {
  const db = banco(); const versao = (await estadoCorrecaoTx(db, 'emp', '2026-09')).versao;
  const r1 = await corrigirMesFechado({ ...args, versao }, db);
  const r2 = await corrigirMesFechado({ ...args, versao }, db);
  expect(r2.repetido).toBe(true); expect(r1.correcao.id).toBe(r2.correcao.id);
  expect(db.appSetting.create).toHaveBeenCalledTimes(2);
});
test('recusa versão antiga, motivo vazio e autor ausente', async () => {
  const db = banco();
  await expect(corrigirMesFechado({ ...args, versao: 'antiga' }, db)).rejects.toMatchObject({ code: 'VERSAO_ALTERADA' });
  await expect(corrigirMesFechado({ ...args, motivo: '', versao: 'x' }, db)).rejects.toMatchObject({ code: 'MOTIVO_OBRIGATORIO' });
  await expect(corrigirMesFechado({ ...args, autor: null }, db)).rejects.toMatchObject({ code: 'autor_obrigatorio' });
  expect(db.state().circular.fechadoContabilEm).not.toBeNull();
});
test('falha de auditoria aborta transação inteira (cliente transacional simulado)', async () => {
  const db = banco(); const create = db.appSetting.create.getMockImplementation();
  db.appSetting.create.mockImplementation(async a => { if (a.data.key.startsWith('contabil:audit:')) throw new Error('auditoria indisponível'); return create(a); });
  await expect(abrir(db)).rejects.toThrow('auditoria indisponível');
  expect(db.state().circular.fechadoContabilEm).not.toBeNull();
  expect(Object.keys(db.state().settings)).toHaveLength(0);
});
test('edição e exclusão permanecem visíveis e reconferência resolve sem apagar histórico', async () => {
  const db = banco(); await abrir(db);
  const antes = clone(db.state().entries[0]);
  db.state().entries = [];
  await registrarAlteracaoTx(db, { companyId: 'emp', competencia: '2026-09', autor: { id: 'editor' }, antes, depois: null, metadados: { confirmacaoId: 'confirmacao-cliente' } });
  const lista = await listarCorrecoesContabeis(db, 'emp');
  expect(lista.correcoes[0].alteracoes).toEqual([{ entryId: 'l', antes, depois: null }]);
  await conferirTodos(db);
  const estado = await estadoCorrecaoTx(db, 'emp', '2026-09');
  await expect(concluirCorrecaoTx(db, { ...args, snapshotAntes: estado.atual, versao: 'antiga' })).rejects.toMatchObject({ code: 'VERSAO_ALTERADA' });
  await concluirCorrecaoTx(db, { ...args, snapshotAntes: estado.atual, versao: estado.versao });
  const fim = await listarCorrecoesContabeis(db, 'emp');
  expect(fim.correcoes).toHaveLength(0);
  expect(fim.historico.some(h => h.status === 'RESOLVIDA' && h.alteracoes[0].depois === null)).toBe(true);
  expect(fim.historico.some(h => h.autor?.id === 'editor' && h.metadados?.confirmacaoId === 'confirmacao-cliente')).toBe(true);
});
test('diff inclui adição e alteração mesmo de produtor sem instrumentação', () => {
  expect(diferencasLancamentos({ entries: [{ id: 'a', valor: 1 }] }, { entries: [{ id: 'a', valor: 2 }, { id: 'b', valor: 3 }] })).toHaveLength(2);
});

async function conferir(db, item, valor = true) {
  return db.$transaction(async tx => {
    const antes = clone(db.state().circular);
    db.state().circular[CHECKLIST_FECHAMENTO[item].campo] = valor;
    await registrarConferenciaTx(tx, { ...args, antes, depois: clone(db.state().circular), item });
  }, { isolationLevel: 'Serializable' });
}
async function conferirTodos(db) { for (const item of Object.keys(CHECKLIST_FECHAMENTO)) await conferir(db,item); }

test('produtor legado após conferência invalida todas as marcas mesmo com token atualizado', async () => {
  const db = banco(); await abrir(db); await conferirTodos(db);
  const conferida = await estadoCorrecaoTx(db,'emp','2026-09');
  expect(Object.values(conferida.conferencia.checklist).every(Boolean)).toBe(true);
  // Simula efeito persistido de estorno/gerador legado sem chamar registrarAlteracaoTx.
  db.state().entries[0].historico = 'alterado pelo produtor legado';
  const recarga = await estadoCorrecaoTx(db,'emp','2026-09');
  expect(recarga.versao).not.toBe(conferida.versao);
  expect(Object.values(recarga.conferencia.checklist)).toEqual([false,false,false,false,false]);
  expect(db.state().circular.despesasOk).toBe(true); // flag antiga sozinha não aprova.
  await expect(concluirCorrecaoTx(db,{...args,snapshotAntes:recarga.atual,versao:recarga.versao})).rejects.toMatchObject({code:'CONFERENCIA_DESATUALIZADA'});
  await conferir(db,'despesas');
  const primeira = await estadoCorrecaoTx(db,'emp','2026-09');
  expect(primeira.conferencia.checklist).toEqual({folhaProlabore:false,despesas:true,receitas:false,provisoes:false,pagamentos:false});
  expect(db.state().circular.receitasOk).toBe(false);
  await conferirTodos(db);
  const nova = await estadoCorrecaoTx(db,'emp','2026-09');
  await concluirCorrecaoTx(db,{...args,snapshotAntes:nova.atual,versao:nova.versao});
  expect((await listarCorrecoesContabeis(db,'emp')).correcoes).toHaveLength(0);
});
test('marcar/desmarcar altera versão e mutação instrumentada apaga o carimbo', async () => {
  const db = banco(); await abrir(db); await conferirTodos(db);
  const anterior = await estadoCorrecaoTx(db,'emp','2026-09');
  await conferir(db,'despesas',false);
  const desmarcada = await estadoCorrecaoTx(db,'emp','2026-09');
  expect(desmarcada.versao).not.toBe(anterior.versao);
  expect(desmarcada.conferencia.checklist.despesas).toBe(false);
  await registrarAlteracaoTx(db,{...args,antes:{valor:1},depois:{valor:2}});
  expect((await estadoCorrecaoTx(db,'emp','2026-09')).correcao.conferencia).toBeNull();
});
test('hash inclui empresa/competência e toda linha, com ordenação canônica', () => {
  const rows = [{id:'b',lines:[]},{id:'a',lines:[{id:'2',ordem:0,valor:2},{id:'1',ordem:0,valor:1}]}];
  const hash = hashLancamentosConferidos('emp','2026-09',{entries:rows});
  expect(hashLancamentosConferidos('emp','2026-09',{entries:[{...rows[1],lines:[...rows[1].lines].reverse()},rows[0]]})).toBe(hash);
  expect(hashLancamentosConferidos('outra','2026-09',{entries:rows})).not.toBe(hash);
  expect(hashLancamentosConferidos('emp','2026-10',{entries:rows})).not.toBe(hash);
  rows[1].lines[0].valor = 3;
  expect(hashLancamentosConferidos('emp','2026-09',{entries:rows})).not.toBe(hash);
});

test('correção antiga sem carimbo não reutiliza flags físicas verdadeiras', async () => {
  const db = banco(); await abrir(db);
  for (const { campo } of Object.values(CHECKLIST_FECHAMENTO)) db.state().circular[campo] = true;
  const estado = await estadoCorrecaoTx(db,'emp','2026-09');
  expect(estado.conferencia.valida).toBe(false);
  expect(Object.values(estado.conferencia.checklist).some(Boolean)).toBe(false);
  await expect(concluirCorrecaoTx(db,{...args,snapshotAntes:estado.atual,versao:estado.versao})).rejects.toMatchObject({code:'CONFERENCIA_DESATUALIZADA'});
});
