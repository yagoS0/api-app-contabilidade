import { WhatsappCloudClient } from './WhatsappCloudClient.js';

// Adaptador exclusivo: não usa SaidaWhatsappService nem MensagemWhatsapp.
// Destino só vem da sessão persistida; nenhuma URL/ferramenta é aceita do modelo.
export async function enviarSaidaTesteIa({sessao,texto,correlacao,revalidar,resolverCanal,criarCloud=cfg=>new WhatsappCloudClient({config:cfg})}) {
  if(!sessao?.envioReal||!texto?.startsWith('[TESTE ALTAN — SEM EFEITO REAL]')||!correlacao?.startsWith(`altan-teste:${sessao.id}:`))throw new Error('Saída fora da sessão isolada.');
  const canal=await resolverCanal(sessao.canalId);
  if(canal.phoneNumberId!==sessao.canalProvedorId||canal.wabaId!==sessao.wabaProvedorId)throw new Error('Canal de teste alterado.');
  const cloud=criarCloud({phoneNumberId:canal.phoneNumberId,token:canal.token,timeoutMs:15000});
  const atual=await revalidar(); // Última leitura antes da rede.
  if(atual.telefone!==sessao.telefone||atual.canalId!==sessao.canalId)throw new Error('Destino de teste alterado.');
  const json=await cloud.chamar({recurso:'messages',corpo:{messaging_product:'whatsapp',recipient_type:'individual',to:atual.telefone,
    type:'text',text:{body:texto,preview_url:false},biz_opaque_callback_data:correlacao}});
  return {wamid:WhatsappCloudClient.exigirWamid(json,{})};
}
