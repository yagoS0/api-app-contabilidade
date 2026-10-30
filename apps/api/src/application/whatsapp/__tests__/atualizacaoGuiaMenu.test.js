import { atenderConsultaCliente } from '../ConsultasClienteWhatsappService.js';
function cenario() {
 const encaminhar=jest.fn(async()=>{}), enviar=jest.fn(async()=>{});
 return { pedido:{acao:'OPCAO',opcao:'g1',anterior:{tipo:'GUIAS',recalculo:true,guias:[{guideId:'g1'}]}},
 registro:{conversa:{id:'cv',portalClientId:'pc'},mensagem:{id:'m'}},sessao:{},agora:new Date(),client:{},cloud:{},
 executar:jest.fn(async()=>({ok:false,encaminharEscritorio:true,motivoEncaminhamento:'Atualizar guia DAS g1',mensagem:'Solicitei ao contador a atualização desta guia.'})),
 antesDeEnviar:jest.fn(async()=>{}),permitida:()=>true,vincularOpcoes:x=>x,rotular:x=>x,encaminhar,enviar };
}
test('menu registra pedido antes de responder ao cliente',async()=>{const c=cenario();await atenderConsultaCliente(c);
 expect(c.encaminhar).toHaveBeenCalledWith('Atualizar guia DAS g1', {origem:{tipo:'HANDOFF_MENSAGEM',ferramenta:'preparar_recalculo'}});
 expect(c.encaminhar.mock.invocationCallOrder[0]).toBeLessThan(c.enviar.mock.invocationCallOrder[0]);
 expect(c.enviar).toHaveBeenCalledWith(expect.objectContaining({corpo:expect.stringContaining('Solicitei ao contador')}));});
test('falha ao registrar pedido não confirma encaminhamento',async()=>{const c=cenario();c.encaminhar.mockRejectedValue(Error('banco'));
 await expect(atenderConsultaCliente(c)).rejects.toThrow('banco');expect(c.enviar).not.toHaveBeenCalled();});

test('documento indisponível passa identidade estruturada, sem usar o nome como assunto', async () => {
 const c=cenario();c.pedido={acao:'OPCAO',opcao:'d1',anterior:{tipo:'DOCUMENTOS',documentos:[{documentId:'doc-1',nome:'Nome mutável'}]}};
 c.executar.mockResolvedValue({ok:false,motivo:'DOCUMENTO_INDISPONIVEL'});
 await atenderConsultaCliente(c);
 expect(c.encaminhar).toHaveBeenCalledWith(expect.stringContaining('Nome mutável'),{origem:{tipo:'DOCUMENTO_INDISPONIVEL',documentId:'doc-1'}});
 expect(c.encaminhar.mock.invocationCallOrder[0]).toBeLessThan(c.enviar.mock.invocationCallOrder[0]);
});
