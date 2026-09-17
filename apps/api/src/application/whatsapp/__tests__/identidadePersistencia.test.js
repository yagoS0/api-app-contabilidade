jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import { garantirIdentidadeWhatsapp, conferirIdentidadeVigente } from '../IdentidadeComunicacaoService.js';

const pessoa={id:'p1',estado:'ATIVO',versao:1};
const v={id:'v1',interlocutorId:'p1',telefoneE164:'5521999998888',geracao:1,encerrouEm:null,interlocutor:pessoa};
const db=()=>({
  vinculoNumeroInterlocutor:{findFirst:jest.fn().mockResolvedValue(v),findUnique:jest.fn().mockResolvedValue(v),create:jest.fn().mockResolvedValue(v)},
  contatoWhatsapp:{findMany:jest.fn().mockResolvedValue([]),findFirst:jest.fn().mockResolvedValue(null),updateMany:jest.fn().mockResolvedValue({count:0})},
  interlocutorComunicacao:{updateMany:jest.fn().mockResolvedValue({count:1})},
});
test('duas entradas do mesmo número reutilizam a vigência',async()=>{
  const client=db();const r=await garantirIdentidadeWhatsapp({telefone:v.telefoneE164,client});
  expect(r.vinculoNumero.id).toBe('v1');expect(client.vinculoNumeroInterlocutor.create).not.toHaveBeenCalled();
});
test('nono dígito não é inventado para localizar identidade',async()=>{
  const client=db();await garantirIdentidadeWhatsapp({telefone:'5521999998888',client});
  expect(client.vinculoNumeroInterlocutor.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{telefoneE164:'5521999998888',encerrouEm:null}}));
});
test('nova geração não incorpora contatos antigos sem FK',async()=>{
  const client=db();client.vinculoNumeroInterlocutor.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({...v,encerrouEm:new Date()});
  client.vinculoNumeroInterlocutor.create.mockResolvedValue({...v,id:'v2',geracao:2});
  await garantirIdentidadeWhatsapp({telefone:v.telefoneE164,client});
  expect(client.contatoWhatsapp.updateMany).not.toHaveBeenCalled();
  expect(client.vinculoNumeroInterlocutor.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({geracao:2})}));
});
test('alias do provedor reutiliza apenas vínculo observado sem heurística',async()=>{
  const client=db();client.vinculoNumeroInterlocutor.findFirst.mockResolvedValue(null);
  client.contatoWhatsapp.findMany.mockResolvedValue([{vinculoNumero:v}]);
  expect((await garantirIdentidadeWhatsapp({telefone:'552188888888',client})).vinculoNumero.id).toBe('v1');
});
test('colisão de alias preserva entrada em revisão e não autoriza pessoa',async()=>{
  const client=db();client.contatoWhatsapp.findMany.mockResolvedValue([{vinculoNumero:{...v,id:'v2',interlocutorId:'p2'}}]);
  const r=await garantirIdentidadeWhatsapp({telefone:v.telefoneE164,client});
  expect(r.interlocutor.estado).toBe('EM_REVISAO');expect(client.interlocutorComunicacao.updateMany).toHaveBeenCalled();
});
test('vigência encerrada bloqueia nova operação',async()=>{
  const client=db();client.vinculoNumeroInterlocutor.findUnique.mockResolvedValue({...v,encerrouEm:new Date()});
  await expect(conferirIdentidadeVigente({vinculoNumeroId:'v1',client})).rejects.toMatchObject({code:'IDENTIDADE_ALTERADA'});
});
test('revisão permite guardar mensagem quando explícito, mas bloqueia efeito',async()=>{
  const client=db();client.vinculoNumeroInterlocutor.findUnique.mockResolvedValue({...v,interlocutor:{...pessoa,estado:'EM_REVISAO'}});
  await expect(conferirIdentidadeVigente({vinculoNumeroId:'v1',client})).rejects.toMatchObject({code:'IDENTIDADE_EM_REVISAO'});
  await expect(conferirIdentidadeVigente({vinculoNumeroId:'v1',permitirRevisao:true,client})).resolves.toHaveProperty('vinculoNumero.id','v1');
});
test('telefone divergente sem alias verificado não reutiliza identidade',async()=>{
  const client=db();await expect(conferirIdentidadeVigente({vinculoNumeroId:'v1',telefone:'5521999997777',client})).rejects.toMatchObject({code:'IDENTIDADE_ALTERADA'});
});
