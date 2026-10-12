import { criarClienteCadastroPublico } from '../cadastroPublicoClient.js';
test.each(['BRASILAPI','MINHA_RECEITA'])('preserva fonte pública %s sem promover a RFB', async fonte => {
 const consultar = jest.fn(async () => ({ ok: true, fonte, bruto: { municipio: 'Rio de Janeiro', uf: 'RJ', email: 'privado', socios: ['privado'] } }));
 const r = await criarClienteCadastroPublico({ consultar }).consultar('11222333000181', { municipios: [] });
 expect(r).toMatchObject({ ok: true, fonte, vigenciaComprovada: false });
 expect(r).not.toHaveProperty('vigenciaInicio'); expect(JSON.stringify(r)).not.toContain('privado');
 expect(consultar).toHaveBeenCalledWith('11222333000181', { municipios: [], log: null });
});
test('indisponibilidade permite conferência manual sem forjar inexistência', async () => {
 const r = await criarClienteCadastroPublico({ consultar: async () => ({ ok: false, motivo: 'timeout' }) }).consultar('11222333000181');
 expect(r).toMatchObject({ ok: false, motivo: 'timeout', vigenciaComprovada: false });
 expect(r).not.toHaveProperty('existe');
});
test.each(['12345678909','11222333000182','../cnpj'])('não transmite documento inválido %s', async documento => {
 const consultar = jest.fn(); await criarClienteCadastroPublico({ consultar }).consultar(documento); expect(consultar).not.toHaveBeenCalled();
});
