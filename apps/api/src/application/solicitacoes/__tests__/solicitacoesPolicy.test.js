import { carregarEscopo, conversaPermitida, dataCivil, normalizarDados, validarVinculos } from '../solicitacoesPolicy.js';

const contexto = { canal: 'INTERNO', atorId: 'u' };
test.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-01', '0000-01-01', '', false, 0])('recusa data civil impossível ou não explícita: %s', value => {
  expect(() => dataCivil(value)).toThrow('prazo_invalido');
});
test('ano bissexto e ausência explícita permanecem distintos', () => {
  expect(dataCivil('2024-02-29')).toBe('2024-02-29'); expect(dataCivil(null)).toBeNull();
  expect(normalizarDados({ titulo: 'Pedido', resumo: 'Descrição' }, true)).toMatchObject({ prioridade: null, prazoCivil: null });
  expect(() => normalizarDados({ titulo: 'Pedido', resumo: 'Descrição', criadorId: 'forjado' }, true)).toThrow('campo_nao_permitido');
  expect(() => normalizarDados({ situacao: 'CONCLUIDA' })).toThrow('situacao_invalida');
});
test.each([
  { id: 'u', accountType: 'CLIENT', role: 'user', status: 'active' },
  { id: 'u', accountType: 'FIRM', role: 'contador', status: 'pending' },
  null,
])('perfil público, inativo ou ausente não entra', async user => {
  await expect(carregarEscopo({ user: { findUnique: async () => user } }, contexto)).rejects.toMatchObject({ status: 403 });
});
test('staff usa vínculos do banco; payload de escopo não concede acesso ou triagem', async () => {
  const links = jest.fn(async () => [{ companyId: 'pc1' }]);
  const tx = { user: { findUnique: async () => ({ id: 'u', accountType: 'FIRM', role: 'user', status: 'active' }) }, companyFirmAccess: { findMany: links } };
  expect(await carregarEscopo(tx, { ...contexto, empresas: ['pc2'], triagem: true })).toEqual({ atorId: 'u', empresas: ['pc1'], triagem: false });
  expect(links).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', userId: 'u' }) }));
  await expect(carregarEscopo(tx, { ...contexto, canal: 'PUBLICO' })).rejects.toMatchObject({ status: 403 });
});
test('triagem não expõe atendimento protegido, excluído ou identidade agrupada', () => {
  const c = { portalClientId: null, chaveEscopo: 'fila:1' };
  expect(conversaPermitida(c, null)).toBe(true);
  for (const patch of [{ atendimentoId: 'p' }, { vinculoNumeroId: 'v' }, { excluidaEm: new Date() }, { chaveEscopo: 'legado:1' }, { portalClientId: 'outra' }]) expect(conversaPermitida({ ...c, ...patch }, null)).toBe(false);
});
test('responsável pode ser o criador, mas deve estar ativo e autorizado na empresa', async () => {
  const user = { id: 'u', accountType: 'FIRM', role: 'user', status: 'active' };
  const tx = { user: { findUnique: async () => user }, companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'STAFF' })) } };
  await validarVinculos(tx, { empresas: ['pc1'], triagem: false }, { portalClientId: 'pc1', responsavelId: 'u' });
  tx.companyFirmAccess.findUnique.mockResolvedValue(null);
  await expect(validarVinculos(tx, { empresas: ['pc1'] }, { portalClientId: 'pc1', responsavelId: 'u' })).rejects.toThrow('responsavel_fora_escopo');
});
test('anotação é de PortalClient e mensagem deve pertencer à conversa', async () => {
  const tx = { companyNote: { findUnique: async () => ({ portalClientId: 'outra' }) },
    conversaWhatsapp: { findUnique: async () => ({ portalClientId: 'pc1', chaveEscopo: 'fila:1' }) },
    mensagemWhatsapp: { findUnique: async () => ({ conversaId: 'outra' }) } };
  await expect(validarVinculos(tx, { empresas: ['pc1'] }, { portalClientId: 'pc1', anotacaoId: 'nota' })).rejects.toThrow('vinculo_anotacao_invalido');
  await expect(validarVinculos(tx, { empresas: ['pc1'] }, { portalClientId: 'pc1', conversaId: 'cv', mensagemId: 'm' })).rejects.toThrow('vinculo_mensagem_invalido');
});
