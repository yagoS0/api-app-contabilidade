import { sugerirPerfilIa, validarSugestaoPerfil } from '../sugerirPerfilIa.js';
const candidatos = [{ codigo: '171901', nbs: [{ codigo: '1.1302.21.00' }] }];
const proposta = { nome: 'Contabilidade', codigoServicoNacional: '171901', codigoNbs: '1.1302.21.00', justificativa: 'Confira o serviço efetivamente prestado.' };
const company = { codigoServicoNacional: '171901' };
it('aceita somente serviços e NBS correlacionados; não aceita campos de autorização ou alíquota', () => {
  expect(validarSugestaoPerfil(JSON.stringify(proposta), candidatos)?.campos.nome).toBe('Contabilidade');
  for (const extra of [{ codigoServicoNacional: '999999' }, { codigoNbs: 'inventado' }, { pAliq: 5 }, { liberada: true }, { codigoNbs: undefined }]) {
    expect(validarSugestaoPerfil(JSON.stringify({ ...proposta, ...extra }), candidatos)).toBeNull();
  }
  expect(validarSugestaoPerfil('null', candidatos)).toBeNull();
  expect(validarSugestaoPerfil('não sei', candidatos)).toBeNull();
});
it('não chama a IA sem candidatos ou quando a guarda recusa', async () => {
  const cliente = { responder: jest.fn() };
  const guarda = { autorizar: jest.fn(async () => ({ ok: false })), concluir: jest.fn() };
  expect((await sugerirPerfilIa({ portalClientId: 'p', company: {}, descricao: 'teste' }, { cliente, guarda })).ok).toBe(false);
  expect(guarda.autorizar).not.toHaveBeenCalled();
  expect((await sugerirPerfilIa({ portalClientId: 'p', company, descricao: 'teste' }, { cliente, guarda })).ok).toBe(false);
  expect(cliente.responder).not.toHaveBeenCalled();
});
it('registra consumo mesmo em falha e não escreve perfil ou liberação', async () => {
  const guarda = { autorizar: jest.fn(async () => ({ ok: true, contexto: { id: 'chamada' } })), concluir: jest.fn() };
  const cliente = { responder: jest.fn(async () => { throw new Error('erro privado'); }) };
  const r = await sugerirPerfilIa({ portalClientId: 'p', company, descricao: 'contabilidade' }, { cliente, guarda });
  expect(r.ok).toBe(false);
  expect(r.message).not.toContain('privado');
  expect(guarda.concluir).toHaveBeenCalledTimes(1);
  expect(guarda.autorizar).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: 'p', finalidade: 'preenchimento_perfil_nfse' }));
});
it('devolve rascunho revisável e registra uma única chamada', async () => {
  const guarda = { autorizar: jest.fn(async () => ({ ok: true, contexto: {} })), concluir: jest.fn() };
  const cliente = { responder: jest.fn(async () => ({ texto: JSON.stringify({ ...proposta, codigoNbs: null }), usage: {} })) };
  const r = await sugerirPerfilIa({ portalClientId: 'p', company, descricao: 'contabilidade' }, { cliente, guarda });
  expect(r).toMatchObject({ ok: true, revisaoObrigatoria: true, campos: { nome: 'Contabilidade', codigoServicoNacional: '171901' } });
  expect(cliente.responder.mock.calls[0][0].ferramentas).toEqual([]);
  expect(guarda.concluir).toHaveBeenCalledTimes(1);
});
