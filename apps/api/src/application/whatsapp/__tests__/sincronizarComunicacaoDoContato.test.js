import { sincronizarComunicacaoDoContato } from '../sincronizarComunicacaoDoContato.js';

function cenario() {
  const conversa = { id: 'ca', portalClientId: 'a', telefoneE164: '5521999990000', chaveEscopo: 'empresa:a:5521999990000' };
  const vinculo = { situacao: 'AMBIGUO', leitura: 'ESTRITA', e164: conversa.telefoneE164,
    empresas: ['a', 'b'].map(portalClientId => ({ portalClientId, contatos: [{ contatoId: `contato-${portalClientId}`, userId: null }] })) };
  return { conversa, telefone: conversa.telefoneE164, resolverVinculo: jest.fn(async () => vinculo),
    client: { conversaWhatsapp: { findMany: jest.fn(async () => [conversa]) } },
    garantirAtendimento: jest.fn(async () => ({ id: 'at' })), garantirSegmento: jest.fn() };
}

test('abrir chat existente inclui segunda empresa cadastrada sem criar acesso no portal', async () => {
  const c = cenario();
  const resultado = await sincronizarComunicacaoDoContato(c);
  expect(resultado.atendimentoId).toBe('at');
  expect(c.garantirAtendimento).toHaveBeenCalledWith(expect.objectContaining({ userId: null,
    empresas: expect.arrayContaining([expect.objectContaining({ portalClientId: 'a' }), expect.objectContaining({ portalClientId: 'b' })]) }));
  expect(c.garantirSegmento).not.toHaveBeenCalled();
});

test('polling de grupo completo não regrava segmentos ou muda sua ordem', async () => {
  const c = cenario(); c.conversa.atendimentoId = 'at';
  c.client.conversaWhatsapp.findMany.mockResolvedValue(['a', 'b'].map(portalClientId => ({ portalClientId, atendimentoId: 'at' })));
  expect(await sincronizarComunicacaoDoContato(c)).toBe(c.conversa);
  expect(c.garantirAtendimento).not.toHaveBeenCalled();
});

test('uma só empresa mantém o chat simples, sem exigir selecionar a única opção', async () => {
  const c = cenario();
  const vinculo = await c.resolverVinculo(); vinculo.empresas = vinculo.empresas.slice(0, 1);
  c.resolverVinculo.mockResolvedValue(vinculo);
  expect(await sincronizarComunicacaoDoContato(c)).toBe(c.conversa);
  expect(c.garantirAtendimento).not.toHaveBeenCalled();
});

test.each([{ excluidaEm: new Date() }, { chaveEscopo: 'legado:a:5521999990000' }])('não reabre histórico ou lixeira ao consultar %j', async extra => {
  const c = cenario(); Object.assign(c.conversa, extra);
  await sincronizarComunicacaoDoContato(c);
  expect(c.resolverVinculo).not.toHaveBeenCalled();
  expect(c.garantirAtendimento).not.toHaveBeenCalled();
});

test('contato removido desta empresa não reassocia o histórico pelo número', async () => {
  const c = cenario(); c.conversa.portalClientId = 'removida';
  await sincronizarComunicacaoDoContato(c);
  expect(c.garantirAtendimento).not.toHaveBeenCalled();
});
