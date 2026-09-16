import { agruparDestinatarios, validarAviso, modeloDoComunicado, conferirModelo, hashPrevia } from '../comunicados.js';
import { criarModelosMeta } from '../ModelosMetaService.js';

const contato = (id, empresa, extra = {}) => ({ id, nome: 'Liz', portalClientId: empresa, portalClient: { razao: empresa }, telefoneE164: '5521999998800', ativo: true, optInEm: new Date(), ...extra });
test('um aviso por número nas três empresas, independente de conta no portal', () => {
  const r = agruparDestinatarios([contato('a', 'Klaus'), contato('b', 'Lente'), contato('c', 'Alessandro')]);
  expect(r.destinatarios).toHaveLength(1);
  expect(r.destinatarios[0].empresasIds).toEqual(['Klaus', 'Lente', 'Alessandro']);
  expect(r.destinatarios[0].contatosIds).toEqual(['a', 'b', 'c']);
});
test('não deduz nono dígito e explica contatos sem autorização, número ou ativos', () => {
  const r = agruparDestinatarios([contato('a', 'A'), contato('b', 'B', { telefoneE164: '552199998800' }),
    contato('c', 'C', { optInEm: null }), contato('d', 'D', { telefoneE164: null }), contato('e', 'E', { ativo: false })]);
  expect(r.destinatarios).toHaveLength(2);
  expect(r.excluidos.map(e => e.motivo)).toEqual(['Sem autorização para receber WhatsApp', 'Sem WhatsApp válido', 'Contato inativo']);
});
test.each([{}, { titulo: {}, corpo: 'Aviso' }, { titulo: 'Aviso', corpo: '{{1}}' }, { titulo: 'Aviso', corpo: 'x'.repeat(901) }, { titulo: 'Aviso', corpo: 'Corpo', categoria: 'AUTHENTICATION' }])('recusa conteúdo inválido: %j', input => {
  expect(() => validarAviso(input)).toThrow();
});
test('aviso geral é marketing; o template tem todo o texto e nenhum campo genérico', () => {
  const c = { ...validarAviso({ titulo: ' Aviso ', corpo: 'Texto completo https://altan.company' }), nomeMeta: 'aviso_123' };
  const m = modeloDoComunicado(c);
  expect(c.categoria).toBe('MARKETING');
  expect(m.components[0].text).toBe(c.corpo);
  expect(conferirModelo(c, m)).toBe(true);
  for (const alterado of [null, { ...m, language: 'en_US' }, { ...m, components: [{ type: 'BODY', text: '{{1}}' }, m.components[1]] },
    { ...m, components: [...m.components, { type: 'BUTTONS' }] }]) expect(conferirModelo(c, alterado)).toBe(false);
});
test('mudança da autorização, destinatário ou categoria invalida a confirmação', () => {
  const c = { id: 'a', corpo: 'Aviso', categoria: 'UTILITY', statusMeta: 'APPROVED' };
  const ds = [{ id: 'b', telefone: '5521999998800', contatosIds: ['c'], status: 'PENDENTE', elegivel: true }];
  const h = hashPrevia(c, ds);
  expect(hashPrevia(c, ds)).toBe(h);
  expect(hashPrevia({ ...c, categoria: 'MARKETING' }, ds)).not.toBe(h);
  expect(hashPrevia(c, [{ ...ds[0], elegivel: false }])).not.toBe(h);
  expect(hashPrevia(c, [{ ...ds[0], telefone: '5521999998811' }])).not.toBe(h);
});
const meta = fetchImpl => criarModelosMeta({ token: 'segredo-sintetico', waba: '12345', version: 'v21.0', habilitada: true, fetchImpl });
test('gestão Meta usa credencial só no cabeçalho e filtra idioma/nome exatos', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ name: 'aviso', language: 'en_US' }, { id: 'certo', name: 'aviso', language: 'pt_BR' }] }) });
  expect((await meta(fetchImpl).consultar('aviso')).id).toBe('certo');
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url.origin).toBe('https://graph.facebook.com');
  expect(url.href).not.toContain('segredo');
  expect(options.headers.Authorization).toBe('Bearer segredo-sintetico');
});
test('timeout da submissão não faz retry e nunca devolve o erro bruto do provedor', async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new Error('segredo-sintetico'));
  await expect(meta(fetchImpl).criar({ name: 'aviso' })).rejects.toThrow('Não foi possível confirmar');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('rejeição Meta é sanitizada, sem conteúdo/credenciais', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'segredo-sintetico' } }) });
  await expect(meta(fetchImpl).criar({})).rejects.toThrow('código 100');
});
