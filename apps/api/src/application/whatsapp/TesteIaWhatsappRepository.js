import { prisma } from '../../infrastructure/db/prisma.js';
import { createHash } from 'node:crypto';
import { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WABA_ID } from '../../config.js';

const prefixo = 'whatsapp:teste-ia:v1:';
export const chaveSessaoTeste = id => {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Sessão de teste inválida.');
  return `${prefixo}${id}`;
};

// Contexto do modelo nunca recebe dados operacionais. Leitura mínima de metadados
// serve somente à classificação de uma citação, sem conteúdo de conversa/guia.
export function criarRepositorioTesteIa(client = prisma) {
  const chaveSaida = wamid => 'whatsapp:teste-ia:saida:' + createHash('sha256').update(String(wamid)).digest('hex');
  const chaveEntrada = item => 'whatsapp:teste-ia:entrada:' + createHash('sha256').update(JSON.stringify([item.wabaProvedorId,item.canalProvedorId,item.providerMessageId])).digest('hex');
  return {
    async autorAtivo(id) { const u=await client.user.findUnique({where:{id},select:{role:true,status:true}});return u?.role==='admin'&&u.status==='active'; },
    async indexarSaida(wamid,id) { const key=chaveSaida(wamid);await client.appSetting.upsert({where:{key},create:{key,value:{id}},update:{}}); },
    async sessaoDaSaida(wamid) { return (await client.appSetting?.findUnique({where:{key:chaveSaida(wamid)}}))?.value?.id; },
    async sessaoComSaidaIncerta(item, somenteConhecida=false) {
      // Consulta também o evento conhecido: callback pode ter gravado wamid antes
      // do índice, ou ter concluído entre a leitura do índice e este fallback.
      // Enquanto há reserva sem wamid, citação desconhecida também falha fechada.
      const rows=await client.$queryRaw`SELECT "value"->>'id' AS id FROM "AppSetting"
        WHERE "key" LIKE ${prefixo+'%'}
          AND "value"->>'telefone'=${item.telefone}
          AND "value"->>'canalProvedorId'=${item.canalProvedorId}
          AND "value"->>'wabaProvedorId'=${item.wabaProvedorId}
          AND EXISTS (SELECT 1 FROM jsonb_array_elements("value"->'eventos') e
            WHERE e->>'wamid'=${item.respostaAProviderMessageId}
              OR (${!somenteConhecida} AND e->>'estado' IN ('enviando','incerto') AND e->>'tokenSaida' IS NOT NULL
                AND e->>'wamid' IS NULL))
        ORDER BY "createdAt" ASC LIMIT 1`;
      return rows[0]?.id||null;
    },
    async citacaoOperacional(item) {
      if(!item.respostaAProviderMessageId)return false;
      const conferirCanal=canal=>Boolean(item.canalProvedorId&&item.wabaProvedorId
        && (canal?canal.phoneNumberId:WHATSAPP_PHONE_NUMBER_ID)===item.canalProvedorId
        && (canal?canal.wabaId:WHATSAPP_WABA_ID)===item.wabaProvedorId);
      const m=await client.mensagemWhatsapp.findUnique({where:{providerMessageId:item.respostaAProviderMessageId},
        select:{direcao:true,conversa:{select:{telefoneE164:true,canalWhatsapp:{select:{phoneNumberId:true,wabaId:true}}}}}});
      if(m?.direcao==='out'&&m.conversa.telefoneE164===item.telefone&&conferirCanal(m.conversa.canalWhatsapp))return true;
      const t=await client.envioGuiaTentativa.findUnique({where:{providerMessageId:item.respostaAProviderMessageId},
        select:{canalWhatsapp:{select:{phoneNumberId:true,wabaId:true}},envioGuia:{select:{destino:true,canal:true}}}});
      if(t?.envioGuia.canal==='WHATSAPP'&&t.envioGuia.destino===item.telefone&&conferirCanal(t.canalWhatsapp))return true;
      // Envio legado sem tentativa guarda apenas o canal principal.
      return conferirCanal(null)&&Boolean(await client.envioGuia.findFirst({where:{providerMessageId:item.respostaAProviderMessageId,canal:'WHATSAPP',destino:item.telefone},select:{id:true}}));
    },
    async classificacao(item) { return (await client.appSetting?.findUnique({where:{key:chaveEntrada(item)}}))?.value || null; },
    async classificar(item, id) {
      const key=chaveEntrada(item);
      return (await client.appSetting.upsert({where:{key},create:{key,value:{isolado:true,id,recebidaEm:new Date().toISOString()}},update:{}})).value;
    },
    async desfechoEntrada(item, estado) {
      const key=chaveEntrada(item),row=await client.appSetting.findUnique({where:{key}});
      if(row)await client.appSetting.update({where:{key},data:{value:{...row.value,estado}}});
    },
    async quarentenar(item,id) {
      const key=chaveEntrada(item),row=await client.appSetting.findUnique({where:{key}});
      const texto=String(item.corpo||'');
      await client.appSetting.update({where:{key},data:{value:{...row.value,id,estado:'resposta_citada_isolada',
        quarentena:{providerMessageId:item.providerMessageId,telefone:item.telefone,canalProvedorId:item.canalProvedorId,wabaProvedorId:item.wabaProvedorId,
          respostaAProviderMessageId:item.respostaAProviderMessageId,tipo:item.tipo||null,texto:texto.slice(0,16000),textoTruncado:texto.length>16000,midiaProvedorId:item.midiaProvedorId||null}}}});
    },
    async listarQuarentenas(id) {return (await client.appSetting.findMany({where:{key:{startsWith:'whatsapp:teste-ia:entrada:'},AND:[{value:{path:['id'],equals:id}},{value:{path:['estado'],equals:'resposta_citada_isolada'}}]},orderBy:{createdAt:'desc'},take:100,select:{value:true}})).map(r=>r.value);},
    async listar(agora=new Date()) {
      const instante=agora.toISOString();
      const rows=await client.$queryRaw`SELECT "value" FROM "AppSetting"
        WHERE "key" LIKE ${prefixo+'%'} AND "value"->>'estado'='ativa' AND "value"->>'expiraEm'>${instante}
          AND EXISTS (SELECT 1 FROM jsonb_array_elements("value"->'eventos') e
            WHERE e->>'estado' IN ('pendente','pronto') OR (e->>'estado' IN ('processando','enviando') AND e->>'leaseAte'<=${instante}))
        ORDER BY "updatedAt" ASC, "key" ASC LIMIT 20`;
      return rows.map(r=>r.value);
    },
    async criar(sessao) {
      await client.appSetting.create({data:{key:chaveSessaoTeste(sessao.id),value:sessao}});
      return sessao;
    },
    async ler(id) { return (await client.appSetting.findUnique({where:{key:chaveSessaoTeste(id)}}))?.value || null; },
    async alterar(id, fn) {
      const key = chaveSessaoTeste(id);
      return client.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const sessao = (await tx.appSetting.findUnique({where:{key}}))?.value;
        if (!sessao) throw Object.assign(new Error('Sessão de teste não encontrada.'),{status:404});
        const antes=JSON.stringify(sessao);
        const resultado = await fn(sessao);
        if(JSON.stringify(sessao)!==antes)await tx.appSetting.update({where:{key},data:{value:sessao}});
        return resultado;
      });
    },
  };
}
