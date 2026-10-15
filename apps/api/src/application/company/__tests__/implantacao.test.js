import { projetarImplantacao, validarEdicaoImplantacao, lerImplantacao, salvarImplantacao } from '../ImplantacaoService.js';
const agora = new Date('2026-10-15T01:00:00Z'); // Ainda dia 14 em São Paulo.
const onboarding = { id: 'o1', etapas: [
  { id: 'e1', chave: 'certificado_a1', titulo: 'A1 recebido', concluidaEm: new Date('2026-10-13T12:00:00Z'), concluidaPorId: 'contador', observacao: 'Conferido na entrada' },
  { id: 'e2', chave: 'documentos', titulo: 'Documentos', observacao: 'Falta alteração contratual' },
  { id: 'e3', chave: 'conversao', acao: 'CONVERSAO', titulo: 'Carteira', concluidaEm: agora },
  { id: 'e4', chave: 'conferencia_debitos', titulo: 'Conferir débitos', observacao: 'Cliente deve enviar recibos' },
] };
const corpo = { status: 'AGENDADO', responsavel: 'Equipe fiscal', prazo: '2026-10-20', pendencia: 'Solicitar A1', versao: 0 };
function banco() {
  const salvas = [];
  const db = {
    portalClient: { findUnique: jest.fn(async () => ({ id: 'p1' })) },
    onboarding: { findUnique: jest.fn(async () => onboarding) },
    implantacaoTarefa: {
      findMany: jest.fn(async ({ where }) => salvas.filter(t => t.portalClientId === where.portalClientId)),
      create: jest.fn(async ({ data }) => { const t = { ...data, id: 't1', versao: 1 }; salvas.push(t); return t; }),
      updateMany: jest.fn(async ({ where, data }) => { const t = salvas.find(t => t.portalClientId === where.portalClientId && t.chave === where.chave && t.versao === where.versao); if (!t) return { count: 0 }; Object.assign(t, data, { versao: t.versao + 1 }); return { count: 1 }; }),
    },
  };
  db.$transaction = fn => fn(db);
  return db;
}
test('reaproveita etapas, observações e conclusões sem duplicar certificado/documentos nem carregar conversão como pendência', () => {
  const r = projetarImplantacao(onboarding, [], agora);
  expect(r.tarefas.filter(t => t.chave === 'certificado_a1')).toHaveLength(1);
  expect(r.tarefas.find(t => t.chave === 'certificado_a1')).toMatchObject({ status: 'CONCLUIDO', origem: { etapaId: 'e1', concluidaPorId: 'contador' } });
  expect(r.tarefas.find(t => t.chave === 'documentos').pendencia).toBe('Falta alteração contratual');
  expect(r.tarefas.some(t => t.titulo === 'Carteira')).toBe(false);
  expect(r.tarefas.find(t => t.chave === 'onboarding:e4').pendencia).toBe('Cliente deve enviar recibos');
});
test('usa prazo civil de São Paulo e exclui conclusões/dispensas dos atrasos', () => {
  const salvas = ['A_FAZER', 'CONCLUIDO', 'NAO_SE_APLICA'].map((status, i) => ({ chave: `x${i}`, status, prazo: '2026-10-13' }));
  salvas.push({ chave: 'hoje', status: 'AGENDADO', prazo: '2026-10-14' });
  expect(projetarImplantacao(null, salvas, agora).resumo.atrasadas).toBe(1);
});
test.each([
  { ...corpo, responsavel: '' }, { ...corpo, prazo: null }, { ...corpo, prazo: '2026-02-30' },
  { ...corpo, status: 'NAO_SE_APLICA', pendencia: '' }, { ...corpo, status: 'AGUARDANDO_CLIENTE', pendencia: '' },
  { ...corpo, status: 'liberada' }, { ...corpo, portalClientId: 'outra' }, { ...corpo, versao: -1 },
])('recusa corpo inválido %#', entrada => expect(() => validarEdicaoImplantacao(entrada)).toThrow());
test('leitura não grava e falha do banco não vira checklist vazia', async () => {
  const db = banco();
  await lerImplantacao('p1', db, agora);
  expect(db.implantacaoTarefa.create).not.toHaveBeenCalled();
  db.implantacaoTarefa.findMany.mockRejectedValue(new Error('indisponível'));
  await expect(lerImplantacao('p1', db)).rejects.toThrow('indisponível');
});
test('reabre conclusão herdada, persiste prazo/responsável e preserva origem e auditoria; não reimporta por cima', async () => {
  const db = banco();
  let r = await salvarImplantacao('p1', 'certificado_a1', corpo, 'u1', db, agora);
  let t = r.tarefas.find(t => t.chave === 'certificado_a1');
  expect(t).toMatchObject({ status: 'AGENDADO', responsavel: 'Equipe fiscal', prazo: '2026-10-20', versao: 1, concluidaEm: null, origem: { etapaId: 'e1' } });
  expect(t.historico[0]).toMatchObject({ atorId: 'u1', antes: { status: 'CONCLUIDO' }, depois: { status: 'AGENDADO' } });
  await expect(salvarImplantacao('p1', 'certificado_a1', corpo, 'u2', db, agora)).rejects.toMatchObject({ status: 409 });
  r = await salvarImplantacao('p1', 'certificado_a1', { ...corpo, versao: 1, status: 'CONCLUIDO' }, 'u2', db, agora);
  t = r.tarefas.find(t => t.chave === 'certificado_a1');
  expect(t).toMatchObject({ concluidaPorId: 'u2', versao: 2 });
  expect(t.historico).toHaveLength(2);
  expect(db.onboarding.update).toBeUndefined();
});
test('não aceita chave de outra ficha nem sobrescrita concorrente', async () => {
  const db = banco();
  await expect(salvarImplantacao('p1', 'onboarding:outra', corpo, 'u1', db)).rejects.toMatchObject({ status: 404 });
  db.implantacaoTarefa.create.mockRejectedValue({ code: 'P2002' });
  await expect(salvarImplantacao('p1', 'documentos', corpo, 'u1', db)).rejects.toMatchObject({ status: 409 });
});
