import { SolicitacoesService } from '../../solicitacoes/SolicitacoesService.js';
import { registrarEncaminhamentoSuporte, listarEncaminhamentosSuporte } from '../EncaminhamentoSuporteService.js';
import { podeNotificarInscricao } from '../AtendimentoPushService.js';

function banco() {
  const fila = [], commands = [], links = [];
  const conversa = { id: 'cv', portalClientId: 'pc1', chaveEscopo: 'empresa:pc1' };
  const mensagem = { id: 'm1', conversaId: 'cv', direcao: 'in', corpo: 'Preciso de ajuda' };
  const client = {
    user: { findUnique: async () => ({ id: 'u1', role: 'contador', accountType: 'FIRM', status: 'active' }) },
    portalClient: { findMany: async () => [{id:'pc1',razao:'Sintética'}] },
    conversaWhatsapp: { findUnique: async () => conversa },
    mensagemWhatsapp: { findUnique: async () => mensagem, findMany: async () => [mensagem] },
    solicitacaoComando: { findUnique: async ({where}) => commands.find(c => c.sistemaId === where.sistemaId_chave.sistemaId && c.chave === where.sistemaId_chave.chave), create: async ({data}) => commands.push(data) },
    solicitacaoEvento: { create: jest.fn(async ({data}) => data) },
    solicitacaoMensagem: { findMany: async ({where}) => links.filter(l => l.solicitacaoId === where.solicitacaoId), create: async ({data}) => links.push(data) },
    encaminhamentoSuporte: {
      findUnique: jest.fn(async ({ where }) => fila.find(i => where.mensagemId ? i.mensagemId === where.mensagemId : i.id === where.id)),
      create: jest.fn(async ({ data }) => { const r = { estado: 'AGUARDANDO', ...data }; fila.push(r); return r; }),
      findMany: jest.fn(async () => fila.map(i => ({ ...i, conversa, mensagens: links.filter(m=>m.solicitacaoId===i.id) }))),
    }, eventoPushAtendimento: { create: jest.fn(async () => ({})) },
  };
  client.$transaction = async fn => fn(client);
  return { client, fila };
}

test('reentrega gera uma pendência e um evento próprio, sem depender de não lidas', async () => {
  const { client } = banco(), args = { conversa: { id: 'cv' }, mensagem: { id: 'm1', corpo: 'Preciso de ajuda' }, client };
  await registrarEncaminhamentoSuporte(args); await registrarEncaminhamentoSuporte(args);
  expect(client.encaminhamentoSuporte.create).toHaveBeenCalledTimes(1);
  expect(client.eventoPushAtendimento.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tipo: 'SUPORTE', id: expect.stringMatching(/^suporte:/) }) });
});
test('mesma mensagem já resolvida não reabre pendência', async () => {
  const { client, fila } = banco(), args = { conversa: { id: 'cv' }, mensagem: { id: 'm1' }, client };
  await registrarEncaminhamentoSuporte(args); fila[0].estado = 'RESOLVIDO'; await registrarEncaminhamentoSuporte(args);
  expect(fila).toHaveLength(1);
});
test('fila delega à fonte única com contexto autenticado e adapta estado/empresa', async () => {
  const {client}=banco(); const listar=jest.spyOn(SolicitacoesService.prototype,'listar').mockResolvedValue({total:1,porEmpresa:{pc1:1},itens:[{id:'s',portalClientId:'pc1',estadoLegado:'AGUARDANDO'}]});
  try {
    const r=await listarEncaminhamentosSuporte({contexto:{canal:'INTERNO',atorId:'u1'},companyId:'pc1',client});
    expect(listar).toHaveBeenCalledWith({contexto:{canal:'INTERNO',atorId:'u1'},filtros:{situacao:'ABERTAS',portalClientId:'pc1'},limite:100,cursor:null});
    expect(r.itens[0]).toMatchObject({empresaId:'pc1',empresa:'Sintética',estado:'AGUARDANDO'});
  } finally { listar.mockRestore(); }
});

test('push de encaminhamento continua autorizado depois da leitura e cessa ao resolver', async () => {
  const { client, fila } = banco();
  const r = await registrarEncaminhamentoSuporte({ conversa: { id: 'cv' }, mensagem: { id: 'm1' }, client });
  client.user = { findUnique: async () => ({ id: 'u1', role: 'contador', accountType: 'FIRM', status: 'active' }) };
  client.conversaWhatsapp = { findUnique: async () => ({ id: 'cv', portalClientId: 'pc1', chaveEscopo: 'empresa:pc1', lidaAteEm: new Date() }) };
  client.portalClient = { findMany: async () => [{ id: 'pc1' }] };
  const args = { inscricao: { ativa: true, userId: 'u1', fila: true }, evento: { id: `suporte:${r.id}`, tipo: 'SUPORTE', conversaId: 'cv', expiraEm: new Date(Date.now() + 60000) } };
  expect(await podeNotificarInscricao(args, { client })).toBe(true);
  fila[0].estado = 'RESOLVIDO'; expect(await podeNotificarInscricao(args, { client })).toBe(false);
});

test('resumo conserva total/porEmpresa completos sem contar apenas a página',async()=>{
 const {client}=banco();const listar=jest.spyOn(SolicitacoesService.prototype,'listar').mockResolvedValue({total:151,porEmpresa:{pc1:151},itens:Array.from({length:100},(_,n)=>({id:String(n),portalClientId:'pc1',estadoLegado:'AGUARDANDO'}))});
 try {const r=await listarEncaminhamentosSuporte({contexto:{canal:'INTERNO',atorId:'u1'},client});expect(r.total).toBe(151);expect(r.porEmpresa).toEqual({pc1:151});expect(r.itens).toHaveLength(100);} finally {listar.mockRestore();}
});
