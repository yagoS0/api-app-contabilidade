import { operationsReadQueue } from '../operationsReadQueue';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('limita a três leituras, preserva ordem dos resultados e continua após recusa', async () => {
  const pending = Array.from({ length: 6 }, deferred);
  let running = 0, peak = 0;
  const read = jest.fn(async i => { running++; peak = Math.max(peak, running); await pending[i].promise; running--; if (i === 1) throw Error('recusa'); return i; });
  const done = operationsReadQueue([0, 1, 2, 3, 4, 5], read);
  expect(read.mock.calls.map(([i]) => i)).toEqual([0, 1, 2]);
  pending[2].resolve(); await Promise.resolve(); await Promise.resolve();
  expect(read.mock.calls.map(([i]) => i)).toEqual([0, 1, 2, 3]);
  pending.forEach(p => p.resolve());
  const result = await done;
  expect(peak).toBe(3);
  expect(result.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
  expect(result[5].value).toBe(5);
});
test('encerrar contexto impede despachar empresas restantes', async () => {
  let active = true; const pending = deferred(); const read = jest.fn(() => pending.promise);
  const done = operationsReadQueue([0, 1, 2, 3, 4], read, { isActive: () => active });
  active = false; pending.resolve(); await done;
  expect(read).toHaveBeenCalledTimes(3);
});
test.each([0, -1, 4, NaN])('recusa limite inválido %s sem ler', async concurrency => {
  const read = jest.fn(); await expect(operationsReadQueue([1], read, { concurrency })).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
});
