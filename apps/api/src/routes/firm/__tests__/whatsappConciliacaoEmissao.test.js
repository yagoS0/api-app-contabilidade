import express from 'express';
import request from 'supertest';
import { createWhatsappConversasRouter } from '../whatsappConversas.js';
import { empresasVisiveis } from '../empresasVisiveis.js';
import { carregarGrupoIdentidade } from '../../../application/whatsapp/InboxWhatsappService.js';
import { listarEmissoesInterrompidas, conferirEmissaoInterrompida } from '../../../application/whatsapp/ConciliacaoEmissaoWhatsappService.js';

jest.mock('../empresasVisiveis.js', () => ({ empresasVisiveis: jest.fn() }));
jest.mock('../../../application/whatsapp/InboxWhatsappService.js', () => ({ carregarGrupoIdentidade: jest.fn() }));
jest.mock('../../../application/whatsapp/ConciliacaoEmissaoWhatsappService.js', () => ({ listarEmissoesInterrompidas: jest.fn(), conferirEmissaoInterrompida: jest.fn() }));

const a = { id: 'c1', portalClientId: 'p1', escopoVerificado: true, vinculoNumeroId: 'v1' };
const b = { id: 'c2', portalClientId: 'p2', escopoVerificado: true, vinculoNumeroId: 'v2', atendimentoId: 'historico' };
function app(role = 'contador') {
  const client = { conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => [a, b].find(c => c.id === where.id)) },
    acaoPendenteWhatsapp: { findFirst: jest.fn(async ({ where }) => where.id === 'acao2' && where.conversaId.in.includes('c2') && where.portalClientId.in.includes('p2') ? { id: 'acao2', conversaId: 'c2', portalClientId: 'p2' } : null) } };
  const x = express(); x.use(express.json()); x.use((req, _res, next) => { req.auth = { user: { id: 'contador', role } }; next(); });
  x.use('/firm', createWhatsappConversasRouter({ client })); return x;
}
beforeEach(() => {
  jest.clearAllMocks(); empresasVisiveis.mockResolvedValue(['p1', 'p2']);
  carregarGrupoIdentidade.mockImplementation(async ({ conversaId, visiveis }) => ({ origem: conversaId === 'c2' ? b : a, segmentos: [a, b].filter(c => visiveis.includes(c.portalClientId)), completo: true }));
  listarEmissoesInterrompidas.mockImplementation(async ({ conversaId, conferirEscopo }) => { await conferirEscopo(); return { itens: [{ acaoId: conversaId === 'c2' ? 'acao2' : 'acao1', conversaId }] }; });
  conferirEmissaoInterrompida.mockImplementation(async ({ conferirEscopo }) => { await conferirEscopo(); return { estado: 'INCONCLUSIVA', recuperada: false }; });
});
test('grupo multicanal lista segmentos autorizados sem ativar empresa atual', async () => {
  const r = await request(app()).get('/firm/whatsapp/conversas/c1/emissoes-interrompidas');
  expect(r.status).toBe(200); expect(r.body.itens.map(i => i.conversaId)).toEqual(['c1', 'c2']);
});
test('POST resolve ação histórica dentro do grupo; body não escolhe empresa', async () => {
  const r = await request(app()).post('/firm/whatsapp/conversas/c1/emissoes-interrompidas/acao2/conferir').send({ versao: 'v', motivo: 'Conferência manual', companyId: 'p9' });
  expect(r.status).toBe(200); expect(conferirEmissaoInterrompida).toHaveBeenCalledWith(expect.objectContaining({ conversaId: 'c2', acaoId: 'acao2', autorId: 'contador' }));
});
test('carteira parcial não lista nem aceita ID forjado do outro segmento', async () => {
  empresasVisiveis.mockResolvedValue(['p1']);
  const x = app(); const r = await request(x).get('/firm/whatsapp/conversas/c1/emissoes-interrompidas');
  expect(r.body.itens).toEqual([{ acaoId: 'acao1', conversaId: 'c1' }]);
  expect((await request(x).post('/firm/whatsapp/conversas/c1/emissoes-interrompidas/acao2/conferir').send({ versao: 'v', motivo: 'Conferência manual' })).status).toBe(404);
  expect(conferirEmissaoInterrompida).not.toHaveBeenCalled();
});
test('usuário sem papel fiscal não lista nem confere', async () => {
  const x = app('cliente');
  expect((await request(x).get('/firm/whatsapp/conversas/c1/emissoes-interrompidas')).status).toBe(403);
  expect((await request(x).post('/firm/whatsapp/conversas/c1/emissoes-interrompidas/acao2/conferir').send({})).status).toBe(403);
  expect(listarEmissoesInterrompidas).not.toHaveBeenCalled(); expect(conferirEmissaoInterrompida).not.toHaveBeenCalled();
});
