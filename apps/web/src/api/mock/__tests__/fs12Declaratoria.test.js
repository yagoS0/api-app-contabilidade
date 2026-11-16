import { createMockApi } from '../mockApi';
import { respostaFs12Valida } from '../../../features/apuracao/lib/fs12Formulario';
test('demo mantém identidade e pendência sem replicar política ou fabricar conferência', async () => {
  const api = createMockApi({ delay: async () => {} });
  for (const empresa of ['a', 'b']) {
    const out = await api.getFs12Fechamento(empresa, '2026-11');
    expect(respostaFs12Valida(out, empresa, '2026-11')).toBe(true);
    expect(out.fs12.politica.janela).toBeNull();
    expect(out.fs12.evidenciaSuficiente).toBe(false);
    expect(out.fs12.qualidade.totalCentavos).toBeNull();
  }
});
