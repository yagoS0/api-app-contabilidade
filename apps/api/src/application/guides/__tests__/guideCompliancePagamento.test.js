import { resolveNode } from '../resolveGuideNode.js';
test.each([['gerada', false, null], ['enviada', true, null], ['falhou', false, 'falhou']])('pagamento é aditivo ao estado documental/envio %s', (state, enviada, envioStatus) => {
  const node = resolveNode({ required: true }, { guideId: 'g', enviada, envioStatus, paymentStatus: 'PAID' });
  expect(node).toMatchObject({ state, guideId: 'g', paymentStatus: 'PAID', ok: true });
});
test('sem evidência de pagamento não inventa confirmação', () => {
  expect(resolveNode({ required: true }, { guideId: 'g', enviada: true }).paymentStatus).toBeNull();
  expect(resolveNode({ required: true }, null, null).state).toBe('missing');
});
