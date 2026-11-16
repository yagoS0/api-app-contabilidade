jest.mock('../../../../../infrastructure/db/prisma.js', () => ({ prisma: { $transaction: jest.fn() } }));
import { prisma } from '../../../../../infrastructure/db/prisma.js';
import { lerContextoFs12, lerContextoFs12Consistente } from '../leituraContextoFs12.js';
const data = s => new Date(`${s}T00:00:00.000Z`);
const periodo = { id: 'r1', companyId: 'c1', regime: 'SIMPLES', vigenciaInicio: data('2025-01-01'), vigenciaFim: null, updatedAt: data('2026-10-01') };
function banco(historico = [periodo]) {
  return { portalClient: { findUnique: jest.fn(async () => ({ companyId: 'c1' })) }, company: {
    findUnique: jest.fn(async () => ({ id: 'c1', dataAbertura: data('2020-03-12'), regimeHistorico: historico })),
  } };
}
const entrada = { portalClientId: 'p1', competencia: '2026-11' };
test('resolve namespaces explicitamente e lê somente fatos cadastrais', async () => {
  const db = banco(); const out = await lerContextoFs12(db, entrada);
  expect(db.portalClient.findUnique).toHaveBeenCalledWith({ where: { id: 'p1' }, select: { companyId: true } });
  expect(db.company.findUnique.mock.calls[0][0].where).toEqual({ id: 'c1' });
  expect(out).toMatchObject({ empresaId: 'c1', inicioAtividade: '2020-03', regimeDoPeriodo: { tipo: 'SIMPLES_NACIONAL', empresaId: 'c1', competencia: '2026-11' } });
});
test.each([
  [], [periodo, periodo], [{ ...periodo, companyId: 'outra' }],
  [{ ...periodo, vigenciaInicio: data('2026-11-02') }], [{ ...periodo, vigenciaFim: data('2026-11-29') }],
  [{ ...periodo, regime: 'DESCONHECIDO' }], [{ ...periodo, vigenciaInicio: new Date('invalid') }],
  [{ ...periodo, vigenciaInicio: new Date('2026-11-01T03:00:00.000Z') }],
].map(h => [h]))('histórico insuficiente/ambíguo não comprova regime: %j', async h => {
  expect((await lerContextoFs12(banco(h), entrada)).regimeDoPeriodo).toBeNull();
});
test('limites civis do mês completo e revisão atual preservados', async () => {
  const out = await lerContextoFs12(banco([{ ...periodo, vigenciaInicio: data('2026-11-01'), vigenciaFim: data('2026-11-30') }]), entrada);
  expect(out.regimeDoPeriodo.referencia).toContain('2026-10-01T00:00:00.000Z');
});
test('portal sem vínculo não consulta Company e falha não é ausência', async () => {
  const db = banco(); db.portalClient.findUnique.mockResolvedValue(null);
  expect(await lerContextoFs12(db, entrada)).toBeNull(); expect(db.company.findUnique).not.toHaveBeenCalled();
  db.portalClient.findUnique.mockRejectedValue(Error('banco indisponível'));
  await expect(lerContextoFs12(db, entrada)).rejects.toThrow('banco indisponível');
});

test('uma transação de leitura consistente compartilha o mesmo cliente nas duas consultas', async () => {
 const tx=banco();prisma.$transaction.mockImplementation(async (fn)=>fn(tx));
 const out=await lerContextoFs12Consistente(entrada);
 expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'RepeatableRead'});
 expect(tx.portalClient.findUnique).toHaveBeenCalledTimes(1);expect(tx.company.findUnique).toHaveBeenCalledTimes(1);
 expect(out.empresaId).toBe('c1');
});
