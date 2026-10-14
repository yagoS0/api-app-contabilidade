import { situacaoDoPeriodo, registrarPendenciaDoPeriodo, processarAvisoDaEmissao, recuperarAvisosDeEmissao, mesFiscal } from '../pendenciasDoPeriodo.js';
function banco(circular = null, apuracao = null) {
  const registros = new Map();
  return { registros, companyMonthlyCircular: { findFirst: jest.fn(async () => circular) },
    apuracao: { findUnique: jest.fn(async () => null) },
    apuracaoSnapshot: { findUnique: jest.fn(async () => apuracao) },
    pendenciaPosFechamento: { upsert: jest.fn(async ({ where, create, update }) => {
      const row = registros.get(where.chaveEvento);
      if (row) { Object.assign(row, update); return row; }
      registros.set(where.chaveEvento, { id: String(registros.size), resolvida: false, ...create });
      return registros.get(where.chaveEvento);
    }) }, portalClient: { findUnique: jest.fn(async () => ({ id: 'empresa' })) },
    serviceInvoice: { updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []) } };
}
const nota = { portalClientId: 'empresa', competencia: '2026-09-10', chaveAcesso: 'chave', valor: 1 };
test.each([
  [null, null, 'ABERTA'], [{ estado: 'fechado' }, null, 'FECHADA'],
  [null, { dasCalculadoLocal: 0 }, 'APURADA'], [null, { dasSimuladoSerpro: 12 }, 'APURADA'],
  [null, { estado: 'transmitida' }, 'FECHADA'],
  [{ estado: 'aberto' }, { numeroDeclaracao: 'recibo' }, 'TRANSMITIDA'],
])('classifica sem confundir cálculo, fechamento e transmissão %#', async (c, a, estado) => {
  const db = banco(c, a); const r = await situacaoDoPeriodo(db, nota);
  expect(r.estado).toBe(estado); expect(r.provaTransmissao).toBe(estado === 'TRANSMITIDA');
  expect(db.apuracaoSnapshot.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId_competencia: { portalClientId: 'empresa', competencia: '2026-09' } } }));
});
test('indisponibilidade não significa período aberto', async () => {
  const db = banco(); db.apuracaoSnapshot.findUnique.mockRejectedValue(Error('offline'));
  await expect(situacaoDoPeriodo(db, nota)).rejects.toThrow('offline');
});
test('mesma nota emitida e capturada gera uma pendência, mesmo resolvida e em concorrência', async () => {
  const db = banco(null, { reciboNumero: 'r' });
  await Promise.all(Array.from({ length: 6 }, () => registrarPendenciaDoPeriodo(db, { ...nota, serviceInvoiceId: 'emissao' })));
  const row = [...db.registros.values()][0]; row.resolvida = true;
  await registrarPendenciaDoPeriodo(db, { ...nota, notaId: 'captura' });
  expect(db.registros.size).toBe(1); expect(row).toMatchObject({ notaId: 'captura', serviceInvoiceId: 'emissao', resolvida: true });
  expect(row.observacoes).toContain('poderá ser necessária retificação');
});
test('evento posterior é outra revisão, recebido não é receita e empresa não compartilha pendência', async () => {
  const db = banco({ estado: 'fechado' });
  await registrarPendenciaDoPeriodo(db, nota);
  const evento = await registrarPendenciaDoPeriodo(db, { ...nota, evento: 'evento_retroativo' });
  const recebida = await registrarPendenciaDoPeriodo(db, { ...nota, portalClientId: 'outra', papel: 'DEST' });
  expect(db.registros.size).toBe(3); expect(evento.motivo).toBe('evento_retroativo');
  expect(recebida.observacoes).toContain('não representa automaticamente receita');
});
test('aberto ou sem competência não cria pendência', async () => {
  const db = banco(); await registrarPendenciaDoPeriodo(db, nota);
  await registrarPendenciaDoPeriodo(db, { ...nota, competencia: null });
  expect(db.pendenciaPosFechamento.upsert).not.toHaveBeenCalled();
  expect(mesFiscal('2026-13')).toBeNull();
});
test('outbox preserva marcador ao falhar; recuperação só grava local e deduplica', async () => {
  const db = banco({ estado: 'fechado' });
  const invoice = { id: 's', companyId: 'legado', status: 'issued', revisaoPeriodoPendente: true, competencia: '2026-09-01', chaveAcesso: 'chave' };
  db.pendenciaPosFechamento.upsert.mockRejectedValueOnce(Error('falha'));
  await expect(processarAvisoDaEmissao(db, invoice)).rejects.toThrow('falha');
  expect(db.serviceInvoice.updateMany).not.toHaveBeenCalled();
  db.serviceInvoice.findMany.mockResolvedValue([invoice]);
  await recuperarAvisosDeEmissao(db); await recuperarAvisosDeEmissao(db);
  expect(db.registros.size).toBe(1); expect(db.serviceInvoice.updateMany).toHaveBeenCalledTimes(2);
});
test('pendente, recusada e homologação sem marcador não geram pendência de emissão', async () => {
  const db = banco();
  for (const status of ['pending', 'rejected', 'falha_envio']) await processarAvisoDaEmissao(db, { revisaoPeriodoPendente: true, status });
  await processarAvisoDaEmissao(db, { status: 'issued', revisaoPeriodoPendente: false });
  expect(db.portalClient.findUnique).not.toHaveBeenCalled();
});

test('apuração legada também exige revisão e recibo comprova transmissão', async () => {
 const db = banco(); db.apuracao.findUnique.mockResolvedValue({ estado: 'calculada' });
 expect((await situacaoDoPeriodo(db, nota)).estado).toBe('APURADA');
 db.apuracao.findUnique.mockResolvedValue({ estado: 'transmitida', reciboNumero: 'legado' });
 expect((await situacaoDoPeriodo(db, nota)).estado).toBe('TRANSMITIDA');
});
