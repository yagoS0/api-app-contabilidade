import { prisma } from '../../infrastructure/db/prisma.js';
import { whereFaturamentoEmit } from '../notas/apuracao/v2/FechamentoService.js';
import { definirPeriodos, moverMes } from './analiseEmpresa.js';
import { montarClientes } from '../../../../../packages/shared/src/analise/clientes.js';

export async function obterClientesAnalise({portalClientId,de,ate,comparar,client=prisma,agora=new Date()}) {
  definirPeriodos({de,ate,comparar});
  // Histórico até o fim selecionado: primeira observação e acumulado não usam apenas a janela visível.
  // Cabeçalhos apenas, nunca XML/PDF. Limite explícito evita truncamento silencioso.
  const notas=await client.portalInvoice.findMany({where:{...whereFaturamentoEmit(),clientId:portalClientId,competencia:{lt:new Date(`${moverMes(ate,1)}-01T00:00:00Z`)}},select:{id:true,numero:true,competencia:true,total:true,tomadorDoc:true,tomadorNome:true},orderBy:[{competencia:'asc'},{id:'asc'}],take:20001});
  if(notas.length>20000)throw new Error('HISTORICO_EXTENSO');
  return {ok:true,demonstracao:false,...montarClientes({notas:notas.map(n=>({...n,competencia:n.competencia?.toISOString().slice(0,7)})),de,ate,comparar,hoje:agora.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})})};
}
