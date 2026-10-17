import { appendEventoTx, hashSnapshot } from '../AuditoriaContabilService.js';

test('evento cria snapshot independente e chave estável sem atualizar histórico', async () => {
  const create = jest.fn(async ({ data }) => data);
  const antes = { valor: 100 };
  const args = { tipo: 'TESTE', companyId: 'a', entidadeId: 'e', chaveEvento: 'evento1', autor: { id: 'u' }, antes };
  const evento = await appendEventoTx({ appSetting: { create } }, args);
  antes.valor = 500;
  expect(evento.antes.valor).toBe(100);
  expect(create).toHaveBeenCalledTimes(1);
  const outro = await appendEventoTx({ appSetting: { create } }, { ...args, companyId: 'b' });
  expect(outro.id).not.toBe(evento.id);
});
test('falha na persistência não é engolida', async () => {
  const tx = { appSetting: { create: jest.fn().mockRejectedValue(new Error('disco')) } };
  await expect(appendEventoTx(tx, { tipo: 'T', companyId: 'a', entidadeId: 'e', chaveEvento: 'x', autor: { id: 'u' } })).rejects.toThrow('disco');
});
test('hash não depende da ordem de propriedades e preserva valores', () => {
  expect(hashSnapshot({ a: 1, b: 2 })).toBe(hashSnapshot({ b: 2, a: 1 }));
  expect(hashSnapshot({ a: 1 })).not.toBe(hashSnapshot({ a: 2 }));
});
