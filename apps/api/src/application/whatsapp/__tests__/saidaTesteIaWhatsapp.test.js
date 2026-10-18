import { enviarSaidaTesteIa } from '../SaidaTesteIaWhatsappService.js';
const sessao={id:'sessao',envioReal:true,canalId:'comercial',telefone:'5500000000000',canalProvedorId:'123',wabaProvedorId:'456'};
const opcoes=()=>({sessao,texto:'[TESTE ALTAN — SEM EFEITO REAL]\nResposta fictícia',correlacao:'altan-teste:sessao:token',revalidar:jest.fn(async()=>sessao),resolverCanal:async()=>({phoneNumberId:'123',wabaId:'456',token:'sintetico'})});
test('transporte usa destinatário persistido e correlação própria; não registra mensagem real',async()=>{
 const chamar=jest.fn(async()=>({messages:[{id:'wamid'}]})),o=opcoes();
 expect(await enviarSaidaTesteIa({...o,criarCloud:()=>({chamar})})).toEqual({wamid:'wamid'});
 expect(chamar).toHaveBeenCalledWith(expect.objectContaining({corpo:expect.objectContaining({to:sessao.telefone,biz_opaque_callback_data:o.correlacao})}));expect(o.revalidar).toHaveBeenCalledTimes(1);
});
test('canal alterado e revogação imediatamente antes da rede bloqueiam envio',async()=>{
 const chamar=jest.fn();
 await expect(enviarSaidaTesteIa({...opcoes(),resolverCanal:async()=>({phoneNumberId:'outro'}),criarCloud:()=>({chamar})})).rejects.toThrow('Canal');
 await expect(enviarSaidaTesteIa({...opcoes(),revalidar:async()=>{throw Error('revogado');},criarCloud:()=>({chamar})})).rejects.toThrow('revogado');expect(chamar).not.toHaveBeenCalled();
});
