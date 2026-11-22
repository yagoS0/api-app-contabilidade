jest.mock('../prisma.js', () => ({ prisma: { adnDocument: { findMany: jest.fn() } } }));
import { prisma } from '../prisma.js';
import { AdnRepository } from '../AdnRepository.js';

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (key === 'AND') return value.every(part => matches(row, part));
    if (value instanceof Date) return +row[key] === +value;
    if (value && typeof value === 'object') return Object.entries(value).every(([op, bound]) =>
      op === 'lt' ? row[key] < bound : op === 'lte' ? row[key] <= bound : row[key] >= bound);
    return row[key] === value;
  });
}
const A = '11111111000191', B = '22222222000191';
const rows = [
  ['z', A, B], ['y', B, '33333333000191'], ['x', B, A], ['w', A, B],
].map(([id, cnpjPrestador, cnpjTomador]) => ({ id, nsu: 1n, cnpjPrestador, cnpjTomador,
  updatedAt: new Date('2026-11-20T10:00:00Z'), competencia: new Date('2026-11-01T00:00:00Z'),
  dataEmissao: new Date('2026-11-10T00:00:00Z'), status: 'authorized' }));
beforeEach(() => prisma.adnDocument.findMany.mockImplementation(async ({ where, take }) =>
  rows.filter(row => matches(row, where)).slice(0, take)));

test.each(['todas', 'emitidas', 'recebidas'])('paginação %s conserva empresa em cada página', async direcao => {
  const ids = []; let cursor;
  do {
    const page = await AdnRepository.listNotas({ cnpj: A, direcao, limit: 1, cursor });
    ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toEqual(direcao === 'emitidas' ? ['z', 'w'] : direcao === 'recebidas' ? ['x'] : ['z', 'x', 'w']);
});
test.each(['invalid!', Buffer.from('{"id":"y","updatedAt":"bad"}').toString('base64')])('cursor inválido mantém primeira página', async cursor => {
  const page = await AdnRepository.listNotas({ cnpj: A, cursor });
  expect(page.cursor).toBeNull(); expect(page.items.map(item => item.id)).toEqual(['z', 'x', 'w']);
});
test('cursor forjado não concede titularidade; chamadas concorrentes e vazio', async () => {
  const cursor = Buffer.from(JSON.stringify({ id: 'zz', updatedAt: '2027-01-01T00:00:00Z' })).toString('base64');
  const [a, b, empty] = await Promise.all([
    AdnRepository.listNotas({ cnpj: A, cursor, competencia: '2026-11', status: 'AUTORIZADA', dateFrom: '2026-11-01', dateTo: '2026-11-30' }),
    AdnRepository.listNotas({ cnpj: B, cursor, direcao: 'emitidas' }),
    AdnRepository.listNotas({ cnpj: A, cursor, competencia: '2026-10' }),
  ]);
  expect(a.items.map(item => item.id)).toEqual(['z', 'x', 'w']);
  expect(b.items.map(item => item.id)).toEqual(['y', 'x']);
  expect(empty.items).toEqual([]); expect(empty.nextCursor).toBeNull();
});
