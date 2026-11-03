// Fila local à montagem: sem cache ou reutilização de evidência entre contextos.
// O consumidor também verifica isActive após cada await, antes da próxima leitura.
export async function operationsReadQueue(items, read, { isActive = () => true, concurrency = 3 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw Error('Limite de leitura inválido');
  let cursor = 0;
  const results = new Array(items.length);
  async function worker() {
    while (isActive() && cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await read(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
