import { atualizarGuiaComEvidencia } from '../atualizarGuiaComEvidencia.js';
import { Prisma } from '@prisma/client';
import { registrarRecalculoGuia, sinalizarRecalculosNosLancamentos } from '../RegistroRecalculoGuia.js';

// Integração entre serviços reais; persistência em memória. Não certifica PostgreSQL.
function fixture() {
  const rows = new Map(['selecionada', 'vizinha'].map(id => [id, {
    id, portalClientId: 'empresa', competencia: '2026-09', status: 'PROCESSED',
    tipo: 'OUTRA', valor: 100, valorOriginal: 100, paymentStatus: 'PAID',
    updatedAt: new Date('2026-10-01'), extracted: { comprovante: { total: 100 } },
  }]));
  const db = { guide: {
    findUnique: jest.fn(async ({ where }) => structuredClone(rows.get(where.id))),
    findFirst: jest.fn(async ({ where }) => {
      const row = rows.get(where.id);
      return row && Object.entries(where).every(([k, v]) => row[k] === v) ? structuredClone(row) : null;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const row = rows.get(where.id);
      if (+row.updatedAt !== +where.updatedAt) return { count: 0 };
      if ('valor' in where && row.valor !== where.valor) return { count: 0 };
      if (where.extracted && (where.extracted.equals === Prisma.AnyNull
        ? row.extracted != null : JSON.stringify(where.extracted.equals) !== JSON.stringify(row.extracted))) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(+row.updatedAt + 1) });
      return { count: 1 };
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(rows.get(where.id), data)),
    findMany: jest.fn(async () => [...rows.values()]),
  } };
  return { rows, db };
}

test('recaptura, registro e projeção conservam pagamento e não alteram guia vizinha ou razão', async () => {
  const { db, rows } = fixture();
  const anterior = structuredClone(rows.get('selecionada'));
  const vizinha = structuredClone(rows.get('vizinha'));
  await atualizarGuiaComEvidencia(db, anterior.id, atual => ({
    valor: 115, extracted: { ...atual.extracted, numeroDocumento: 'novo-documento' },
  }));
  await registrarRecalculoGuia(db, { guiaAnterior: anterior, guiaId: anterior.id, especie: 'DARF_PRESUMIDO' });
  const entries = [{ sourceGuideId: anterior.id, totalD: 100 }, { sourceGuideId: vizinha.id, totalD: 100 }];
  const result = await sinalizarRecalculosNosLancamentos(db, 'empresa', entries);
  expect(result[0].recalculoGuia).toMatchObject({ valorAnterior: 100, valorAtual: 115 });
  expect(result[1].recalculoGuia).toBeNull();
  expect(result.map(e => e.totalD)).toEqual([100, 100]);
  expect(entries[0]).not.toHaveProperty('recalculoGuia');
  expect(rows.get('selecionada')).toMatchObject({ paymentStatus: 'PAID', valorOriginal: 100, extracted: { comprovante: { total: 100 } } });
  expect(rows.get('vizinha')).toEqual(vizinha);
});

test('JSON nulo não sobrescreve comprovante concorrente mesmo com updatedAt idêntico', async () => {
  const { db, rows } = fixture();
  rows.get('selecionada').extracted = null;
  const anterior = structuredClone(rows.get('selecionada'));
  const read = db.guide.findFirst.getMockImplementation();
  db.guide.findFirst.mockImplementationOnce(async args => {
    const stale = await read(args);
    rows.get('selecionada').extracted = { comprovante: { total: 101, evento: 'mesmo-milissegundo' } };
    return stale;
  });
  await registrarRecalculoGuia(db, { guiaAnterior: anterior, guiaId: anterior.id });
  expect(db.guide.findFirst).toHaveBeenCalledTimes(2);
  expect(db.guide.updateMany).toHaveBeenCalledTimes(2);
  expect(db.guide.updateMany.mock.calls[0][0].where.extracted.equals).toBe(Prisma.AnyNull);
  expect(+db.guide.updateMany.mock.calls[0][0].where.updatedAt).toBe(+db.guide.updateMany.mock.calls[1][0].where.updatedAt);
  expect(rows.get('selecionada').extracted.comprovante).toEqual({ total: 101, evento: 'mesmo-milissegundo' });
});

test('mudança apenas do valor com timestamp idêntico força releitura antes do registro', async () => {
  const { db, rows } = fixture();
  const anterior = structuredClone(rows.get('selecionada'));
  const read = db.guide.findFirst.getMockImplementation();
  db.guide.findFirst.mockImplementationOnce(async args => {
    const stale = await read(args);
    rows.get(anterior.id).valor = 125;
    return stale;
  });
  const registro = await registrarRecalculoGuia(db, { guiaAnterior: anterior, guiaId: anterior.id });
  expect(await db.guide.updateMany.mock.results[0].value).toEqual({ count: 0 });
  expect(await db.guide.updateMany.mock.results[1].value).toEqual({ count: 1 });
  expect(db.guide.findFirst).toHaveBeenCalledTimes(2);
  expect(db.guide.updateMany.mock.calls.map(([args]) => args.where.valor)).toEqual([100, 125]);
  expect(+db.guide.updateMany.mock.calls[0][0].where.updatedAt).toBe(+db.guide.updateMany.mock.calls[1][0].where.updatedAt);
  expect(registro).toMatchObject({ valorAnterior: 100, valorAtual: 125 });
  expect(rows.get(anterior.id).extracted).toMatchObject({ comprovante: anterior.extracted.comprovante, recalculoGuia: { valorAtual: 125 } });
});

test.each([false, true])('callback antigo preserva recálculo vencedor, conflito durante escrita: %s', async durante => {
  const { db, rows } = fixture();
  const anterior = structuredClone(rows.get('selecionada'));
  const novo = { guiaId: anterior.id, recalculadoEm: '2026-10-18T15:00:00Z', valorAnterior: 100, valorAtual: 120, solicitadoPor: 'outro' };
  const gravarVencedor = () => {
    const row = rows.get(anterior.id);
    row.extracted = { ...row.extracted, recalculoGuia: novo, composicao: { principal: 100, juros: 15, multa: 5 } };
    row.updatedAt = new Date(+row.updatedAt + 1);
  };
  if (durante) {
    const read = db.guide.findFirst.getMockImplementation();
    db.guide.findFirst.mockImplementationOnce(async args => { const stale = await read(args); gravarVencedor(); return stale; });
  } else gravarVencedor();
  await expect(registrarRecalculoGuia(db, { guiaAnterior: anterior, guiaId: anterior.id, especie: 'DARF_PRESUMIDO' })).rejects.toMatchObject({ code: 'GUIA_ALTERADA' });
  expect(rows.get(anterior.id).extracted).toEqual({ comprovante: { total: 100 }, recalculoGuia: novo, composicao: { principal: 100, juros: 15, multa: 5 } });
  expect(db.guide.updateMany).toHaveBeenCalledTimes(durante ? 1 : 0);
});

test('disputa persistente esgota limite sem anunciar registro concluído', async () => {
  const { db, rows } = fixture();
  const anterior = structuredClone(rows.get('selecionada'));
  db.guide.updateMany.mockResolvedValue({ count: 0 });
  await expect(registrarRecalculoGuia(db, { guiaAnterior: anterior, guiaId: anterior.id })).rejects.toMatchObject({ code: 'GUIA_ALTERADA' });
  expect(db.guide.updateMany).toHaveBeenCalledTimes(4);
  expect(rows.get(anterior.id)).toEqual(anterior);
});

test('registro de recálculo relê e preserva evidência gravada entre sua leitura e escrita', async () => {
  const { db, rows } = fixture();
  const anterior = structuredClone(rows.get('selecionada'));
  const read = db.guide.findFirst.getMockImplementation();
  db.guide.findFirst.mockImplementationOnce(async args => {
    const stale = await read(args);
    await atualizarGuiaComEvidencia(db, anterior.id, atual => ({
      extracted: { ...atual.extracted, comprovante: { total: 99, evento: 'concorrente' } },
    }));
    expect(rows.get(anterior.id).extracted.comprovante.evento).toBe('concorrente');
    return stale;
  });
  await registrarRecalculoGuia(db, { guiaAnterior: anterior, guiaId: anterior.id, especie: 'DARF_PRESUMIDO' });
  expect(rows.get(anterior.id).extracted.comprovante).toEqual({ total: 99, evento: 'concorrente' });
  expect(db.guide.update).not.toHaveBeenCalled();
  const escrita = db.guide.updateMany.mock.calls.at(-1)[0];
  expect(escrita.where).toMatchObject({ id: anterior.id, portalClientId: 'empresa', competencia: '2026-09', status: 'PROCESSED' });
  expect(+escrita.where.updatedAt).toBe(+anterior.updatedAt + 1);
  expect(escrita.where.extracted.equals.comprovante.evento).toBe('concorrente');
  expect(rows.get(anterior.id).extracted.recalculoGuia.guiaId).toBe(anterior.id);
});
