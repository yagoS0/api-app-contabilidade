import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../application/solicitacoes/SolicitacoesService.js', () => ({ SolicitacoesService: jest.fn() }));
jest.mock('../../../application/solicitacoes/SolicitacaoTarefaService.js', () => ({ SolicitacaoTarefaService: jest.fn() }));
import { SolicitacoesService } from '../../../application/solicitacoes/SolicitacoesService.js';
import { SolicitacaoTarefaService } from '../../../application/solicitacoes/SolicitacaoTarefaService.js';
import { SolicitacaoError } from '../../../application/solicitacoes/solicitacoesPolicy.js';
import { createSolicitacoesRouter } from '../solicitacoes.js';

function fixture(auth = { user: { id: 'sessao' } }) {
  const service = Object.fromEntries(['listar', 'detalhar', 'criar', 'editar', 'concluir', 'reabrir', 'adotar'].map(name => [name, jest.fn(async () => ({ id: 's1' }))]));
  service.listar.mockResolvedValue({ itens: [], total: 0 });
  SolicitacoesService.mockImplementation(() => service);
  service.converter = jest.fn(async () => ({ id: 's1', tarefa: { id: 't1', podeAbrir: true, estado: 'ATIVA' } }));
  SolicitacaoTarefaService.mockImplementation(() => service);
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.auth = auth; next(); });
  app.use('/firm', createSolicitacoesRouter({ client: {} }));
  return { app, service };
}

test('conversion uses authenticated context, original version and a closed command envelope', async () => {
  const f = fixture(), dados = { titulo: 'Tarefa', responsavelId: null, empresasIds: [], config: { dataInicio: '2026-10-27' } };
  const body = { chave: 'k', versao: 'a'.repeat(64), dados };
  const response = await request(f.app).post('/firm/solicitacoes/s1/tarefa').send(body);
  expect(response.body).toMatchObject({ ok: true, item: { id: 's1', tarefa: { id: 't1' } } });
  expect(f.service.converter).toHaveBeenCalledWith({ ...body, id: 's1', contexto: { canal: 'INTERNO', atorId: 'sessao' } });
  expect((await request(f.app).post('/firm/solicitacoes/s1/tarefa').send({ ...body, atorId: 'outro' })).status).toBe(400);
  const unauthenticated = fixture(null);
  expect((await request(unauthenticated.app).post('/firm/solicitacoes/s1/tarefa').send(body)).status).toBe(401);
  expect(unauthenticated.service.converter).not.toHaveBeenCalled();
});

test('montagem com cliente parcial preserva outras rotas e recusa uso sem transação', async () => {
  const RealService = jest.requireActual('../../../application/solicitacoes/SolicitacoesService.js').SolicitacoesService;
  SolicitacoesService.mockClear();
  SolicitacoesService.mockImplementation(args => new RealService(args));
  const app = express();
  app.use((req, res, next) => { req.auth = { user: { id: 'sessao' } }; next(); });
  expect(() => app.use('/firm', createSolicitacoesRouter({ client: {} }))).not.toThrow();
  app.get('/firm/outra-rota', (_req, res) => res.json({ ok: true }));
  expect(SolicitacoesService).not.toHaveBeenCalled();
  expect((await request(app).get('/firm/outra-rota')).status).toBe(200);
  const response = await request(app).get('/firm/solicitacoes');
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ ok: false, code: 'cliente_transacional_obrigatorio' });
  expect(SolicitacoesService).toHaveBeenCalledTimes(1);
});
test('contexto sempre vem da sessão e corpo fechado recusa ator/sistema forjados', async () => {
  const f = fixture();
  for (const extra of [{ contexto: { canal: 'SISTEMA' } }, { atorId: 'outro' }, { sistemaId: 'WHATSAPP_SUPORTE' }]) {
    expect((await request(f.app).post('/firm/solicitacoes').send({ chave: 'k', dados: {}, ...extra })).status).toBe(400);
  }
  expect(f.service.criar).not.toHaveBeenCalled();
  expect((await request(f.app).post('/firm/solicitacoes').send({ chave: 'k', dados: { titulo: 'Pedido' } })).status).toBe(200);
  expect(f.service.criar).toHaveBeenCalledWith({ contexto: { canal: 'INTERNO', atorId: 'sessao' }, chave: 'k', dados: { titulo: 'Pedido' } });
  expect((await request(fixture(null).app).get('/firm/solicitacoes')).status).toBe(401);
});
test.each(['limite=0', 'limite=101', 'limite=1.5', 'limite=01', 'limite=1&limite=2', 'triagem=sim', 'desconhecido=x'])('query inválida não chega ao serviço: %s', async query => {
  const f = fixture(); expect((await request(f.app).get(`/firm/solicitacoes?${query}`)).status).toBe(400); expect(f.service.listar).not.toHaveBeenCalled();
});
test('filtros e cursor explícitos mantêm tipos do contrato', async () => {
  const f = fixture(); await request(f.app).get('/firm/solicitacoes?limite=100&triagem=false&prioridade=null&cursor=token');
  expect(f.service.listar).toHaveBeenCalledWith({ contexto: { canal: 'INTERNO', atorId: 'sessao' }, filtros: { triagem: false, prioridade: null }, limite: 100, cursor: 'token' });
});
test('comandos são individuais e assumir solicitação só edita atribuição/estado', async () => {
  const f = fixture(); const body = { chave: 'k', versao: 'a'.repeat(64) };
  await request(f.app).post('/firm/solicitacoes/s1/assumir').send(body);
  expect(f.service.editar).toHaveBeenCalledWith({ ...body, id: 's1', contexto: { canal: 'INTERNO', atorId: 'sessao' }, dados: { responsavelId: 'sessao', situacao: 'EM_ATENDIMENTO' } });
  await request(f.app).post('/firm/solicitacoes/s1/concluir').send(body);
  expect(f.service.concluir).toHaveBeenCalledWith({ ...body, id: 's1', contexto: { canal: 'INTERNO', atorId: 'sessao' } });
});
test('conflito/ausência preservam code/status/motivo sem sucesso parcial', async () => {
  const f = fixture();
  f.service.concluir.mockRejectedValue(new SolicitacaoError('versao_conflitante', 409));
  const response = await request(f.app).post('/firm/solicitacoes/s1/concluir').send({ chave: 'k', versao: 'a'.repeat(64) });
  expect(response.status).toBe(409); expect(response.body).toEqual({ ok: false, code: 'versao_conflitante', error: 'versao_conflitante', motivo: 'versao_conflitante' });
  f.service.detalhar.mockRejectedValue(new SolicitacaoError('solicitacao_nao_encontrada', 404));
  expect((await request(f.app).get('/firm/solicitacoes/fora')).status).toBe(404);
});
