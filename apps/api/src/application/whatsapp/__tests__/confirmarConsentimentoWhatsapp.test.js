import { confirmarConsentimentoWhatsapp, TEXTO_CONSENTIMENTO } from '../ConfirmarConsentimentoWhatsappService.js';

function fixture() {
  const conversa = { id: 'c', telefoneE164: '5521999998888', canalId: 'principal', vinculoNumeroId: 'v' };
  const mensagem = { id: 'm', registradaEm: new Date() };
  const consentimento = { status: 'AUTORIZADO', aplicado: true, mensagemId: 'm' };
  let saida = null, posterior = null;
  const cloud = { enviarTexto: jest.fn(async () => ({ wamid: 'teste' })) };
  const client = {
    conversaWhatsapp: { findUnique: jest.fn(async () => conversa) },
    mensagemWhatsapp: { findFirst: jest.fn(async ({ where }) => where.turnoIaId ? saida : posterior) },
  };
  let fila = Promise.resolve();
  const deps = { client, comLease: (_, fn) => { const r = fila.then(() => fn(async () => {})); fila = r.catch(() => {}); return r; },
    lerConsentimento: jest.fn(async () => consentimento), conferirIdentidade: jest.fn(async () => ({ interlocutor: {} })),
    conferirJanela: jest.fn(async () => ({ situacao: 'ABERTA' })), resolverCloud: jest.fn(async () => cloud),
    enviar: jest.fn(async args => { await args.antesDeEnviar(); saida = { statusEnvio: 'enviando' }; await args.antesDeEnviar(); return args.enviar(); }),
  };
  return { conversa, consentimento, client, deps, cloud, posterior: v => { posterior = v; }, run: () => confirmarConsentimentoWhatsapp({ conversa, mensagem, consentimento }, deps) };
}

test('autorização recebe Combinado no mesmo canal, uma única vez sob concorrência e reentrega', async () => {
  const f = fixture(); await Promise.all([f.run(), f.run()]); await f.run();
  expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(1);
  expect(f.cloud.enviarTexto).toHaveBeenCalledWith({ telefone: f.conversa.telefoneE164, texto: TEXTO_CONSENTIMENTO });
  expect(f.deps.enviar).toHaveBeenCalledWith(expect.objectContaining({ conversa: f.conversa, turnoIaId: 'consentimento:m' }));
});
test.each(['recusa','antiga','substituida','humano','identidade','janela','conversa_continuou'])('não envia confirmação para %s', async caso => {
  const f = fixture();
  if(caso==='recusa')f.consentimento.status='REVOGADO';
  if(caso==='antiga')f.consentimento.aplicado=false;
  if(caso==='substituida')f.deps.lerConsentimento.mockResolvedValue({status:'AUTORIZADO',mensagemId:'nova'});
  if(caso==='humano')f.conversa.atendidaPor='contador';
  if(caso==='identidade')f.deps.conferirIdentidade.mockResolvedValue({interlocutor:{atendidaDesde:new Date()}});
  if(caso==='janela')f.deps.conferirJanela.mockResolvedValue({situacao:'FECHADA'});
  if(caso==='conversa_continuou')f.posterior({id:'nova'});
  expect(await f.run()).toMatchObject({enviado:false});expect(f.cloud.enviarTexto).not.toHaveBeenCalled();
});
test('timeout preserva a tentativa e não duplica no retry', async () => {
  const f=fixture();f.cloud.enviarTexto.mockRejectedValue(Error('timeout'));
  await expect(f.run()).rejects.toThrow('timeout');await f.run();expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});
test('revogação entre preparação e transporte impede o envio',async()=>{
  const f=fixture();f.deps.lerConsentimento.mockResolvedValueOnce(f.consentimento).mockResolvedValue({status:'REVOGADO'});
  await expect(f.run()).rejects.toMatchObject({codigo:'CONSENTIMENTO_ALTERADO'});expect(f.cloud.enviarTexto).not.toHaveBeenCalled();
});
