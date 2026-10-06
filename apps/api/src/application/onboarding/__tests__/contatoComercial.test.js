import { validarContatoComercial, salvarRetornoComercial } from '../ContatoComercialService.js';
test('primeiro contato exige autorização, evidência e telefone válidos', () => {
  const body = { nome: 'Contato sintético', telefone: '5521999991234', autorizado: true, evidencia: 'Solicitação no formulário', canalId: 'vendas' };
  expect(validarContatoComercial(body)).toMatchObject({ telefone: '5521999991234', canalId: 'vendas' });
  expect(() => validarContatoComercial({ ...body, autorizado: false })).toThrow();
  expect(() => validarContatoComercial({ ...body, evidencia: '' })).toThrow();
  expect(() => validarContatoComercial({ ...body, telefone: '123' })).toThrow();
});
test('retorno usa versão da ficha e não produz envio', async () => {
  const db = { onboarding: { findUnique: jest.fn(async () => ({ id: 'f', status: 'RASCUNHO' })), updateMany: jest.fn(async () => ({ count: 1 })) }, onboardingEvento: { create: jest.fn(async ({ data }) => data) } };
  db.$transaction = fn => fn(db);
  const args = { onboardingId: 'f', user: { id: 'u', role: 'admin' }, body: { acao: 'Revisar proposta', quando: '2026-10-10T12:00:00Z', versao: 3 }, db };
  expect(await salvarRetornoComercial(args)).toMatchObject({ versao: 4, retorno: { tipo: 'RETORNO_COMERCIAL' } });
  db.onboarding.updateMany.mockResolvedValue({ count: 0 });
  await expect(salvarRetornoComercial(args)).rejects.toMatchObject({ code: 'ficha_alterada' });
  expect(db.onboardingEvento.create).toHaveBeenCalledTimes(1);
});
