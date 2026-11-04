import { lerReferenciaVencimento, salvarReferenciaVencimento } from '../ReferenciaVencimentoService.js';

const identity = { tributo: 'IRPJ', tipoPeriodo: 'MENSAL', competencia: '2026-09' };
const command = (extra = {}) => ({ identidade: identity, acao: 'CONFIRMAR', expectedRevision: 0, requestId: 'teste_req_1',
  dataCivil: '2026-10-30', origem: 'CONFIRMADA_CONTADOR', descricaoFonte: 'Declaração fictícia', confirmacao: true, motivo: 'Teste', ...extra });
// Mock transacional focal. Concorrência real, constraints e trigger exigem PostgreSQL descartável.
function fixture() {
  let row = null, events = [], user = { role: 'contador', accountType: 'FIRM', status: 'active' }, access = { role: 'ACCOUNTANT', status: 'ACTIVE' };
  const tx = {
    $queryRaw: jest.fn(async () => []), user: { findUnique: jest.fn(async () => user) },
    portalClient: { findUnique: jest.fn(async () => ({ id: 'empresa_a' })) },
    companyFirmAccess: { findUnique: jest.fn(async () => access) },
    referenciaVencimentoFiscal: {
      findUnique: jest.fn(async () => row),
      create: jest.fn(async ({ data }) => { row = { parcelamentoId: null, numeroParcela: null, ...data }; return row; }),
      updateMany: jest.fn(async ({ where, data }) => { if (row.revision !== where.revision) return { count: 0 }; row = { ...row, ...data }; return { count: 1 }; }),
    },
    referenciaVencimentoFiscalEvento: {
      findUnique: jest.fn(async ({ where }) => events.find(e => e.actorId === where.actorId_requestId.actorId && e.requestId === where.actorId_requestId.requestId) || null),
      create: jest.fn(async ({ data }) => { events.push(data); return data; }),
    },
  };
  const db = { $transaction: jest.fn(async fn => {
    const previousRow = row, previousEvents = [...events];
    try { return await fn(tx); } catch (e) { row = previousRow; events = previousEvents; throw e; }
  }) };
  return { db, tx, row: () => row, events: () => events, revokeAccess: () => { access = null; }, inactivate: () => { user.status = 'inactive'; } };
}
describe('persistência da referência sem efeitos externos', () => {
  test('ausência não inventa prazo; salva autoria do servidor e não habilita captura', async () => {
    const f = fixture();
    expect(await lerReferenciaVencimento(f.db, 'empresa_a', 'contador_a', identity)).toMatchObject({ reference: null, revision: 0, captureCapabilityGranted: false });
    const saved = await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command());
    expect(saved).toMatchObject({ revision: 1, captureCapabilityGranted: false, referenceConsumerReady: false,
      reference: { confirmedBy: 'contador_a', dataCivil: '2026-10-30', status: 'ATIVA' } });
    expect(f.events()[0].before).toEqual({ reference: null });
    expect(f.events()[0].after.reference.id).toBe(saved.reference.id);
    expect(f.db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  test('replay não cria evento; payload diferente ou versão posterior recusados', async () => {
    const f = fixture();
    const first = await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command());
    expect(await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command())).toEqual(first);
    expect(f.events()).toHaveLength(1);
    await expect(salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command({ dataCivil: '2026-10-29' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command({ expectedRevision: 1, requestId: 'teste_req_2' }));
    await expect(salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command())).rejects.toMatchObject({ code: 'REFERENCE_CHANGED' });
  });
  test('replay e leitura revalidam vínculo e usuário ativo', async () => {
    const f = fixture();
    await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command());
    f.revokeAccess();
    await expect(salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command())).rejects.toMatchObject({ status: 403 });
    f.inactivate();
    await expect(lerReferenciaVencimento(f.db, 'empresa_a', 'contador_a', identity)).rejects.toMatchObject({ status: 403 });
  });
  test('revogação conserva confirmação e histórico; reconfirmação é nova revisão', async () => {
    const f = fixture();
    const first = await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command());
    const revoked = await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', { identidade: identity, acao: 'REVOGAR', expectedRevision: 1, requestId: 'revogar_req', motivo: 'Fonte corrigida' });
    expect(revoked.reference).toMatchObject({ status: 'REVOGADA', dataCivil: first.reference.dataCivil, confirmedAt: first.reference.confirmedAt, revision: 2 });
    await salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command({ expectedRevision: 2, requestId: 'confirmar_3', dataCivil: '2026-10-29' }));
    expect(f.events()).toHaveLength(3);
    expect(f.events()[2].before.reference.status).toBe('REVOGADA');
  });
  test('CAS antigo e falha de auditoria não deixam alteração parcial', async () => {
    const f = fixture();
    await expect(salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command({ expectedRevision: 3 }))).rejects.toMatchObject({ code: 'REFERENCE_CHANGED' });
    expect(f.row()).toBeNull();
    f.tx.referenciaVencimentoFiscalEvento.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(salvarReferenciaVencimento(f.db, 'empresa_a', 'contador_a', command())).rejects.toThrow('audit unavailable');
    expect(f.row()).toBeNull();
    expect(f.events()).toHaveLength(0);
  });
});
