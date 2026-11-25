import {coordenarEscopoFs12,serializacaoFs12} from './coordenacaoFs12.js';
import { createHash } from 'node:crypto';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { administradorGlobal, avaliarAcessoEmpresaEscritorio } from '../../../identity/public.js';
import { interpretarContextoMensalFs12 } from '../../domain/contextoMensalFs12.js';
import { erroFs12 } from '../../domain/serieManualFs12.js';
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const escopo = ({ portalClientId, companyId, competencia }) => ({ portalClientId, companyId, competencia });

export function criarPersistenciaFs12(db = prisma, {coordenacaoExterna=false} = {}) {
  return { transacionar: async (executar, { escrita }) => {
    // Retry local de serialização: sem transporte, somente transação de confirmação.
    // Replay relê autorização e idempotência; revisão antiga continua conflito.
    for (let tentativa = 0; ; tentativa++) {
      try {
        return await db.$transaction(async tx => {
          let escopoCoordenado=null;
          return executar({
          hash, agora: () => new Date().toISOString(),
          autorizar: async ({ autorId, portalClientId, competencia }) => {
            if(escrita && !coordenacaoExterna){
              const scope=JSON.stringify([portalClientId,competencia]);
              if(escopoCoordenado && escopoCoordenado!==scope)throw erroFs12('FS12_ESCOPO_TRANSACAO_INVALIDO','Confirme uma empresa e competência por operação.',409);
              if(!escopoCoordenado){await coordenarEscopoFs12(tx,{autorId,portalClientId,competencia});escopoCoordenado=scope;}
            }
            if (escrita) {
              await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${autorId} FOR SHARE`;
              await tx.$queryRaw`SELECT id FROM "CompanyFirmAccess" WHERE "userId" = ${autorId} AND "companyId" = ${portalClientId} FOR SHARE`;
            }
            const user = await tx.user.findUnique({ where: { id: autorId }, select: { role: true, status: true, accountType: true } });
            if (!user || user.status !== 'active' || (!administradorGlobal(user) && String(user.accountType || '').trim().toUpperCase() !== 'FIRM'))
              throw erroFs12('FS12_ACESSO_NEGADO', 'Acesso não autorizado.', 403);
            const link = administradorGlobal(user) ? null : await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId: portalClientId, userId: autorId } } });
            const acesso = avaliarAcessoEmpresaEscritorio({ user, link, minRole: 'ACCOUNTANT' });
            if (acesso.error) throw erroFs12(acesso.error, 'Acesso não autorizado.', acesso.status);
          },
          lerContexto: async ({ portalClientId, competencia }) => {
            if (escrita) await tx.$queryRaw`SELECT id FROM "PortalClient" WHERE id = ${portalClientId} FOR SHARE`;
            const portal = await tx.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
            if (!portal?.companyId) return null;
            if (escrita) {
              await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${portal.companyId} FOR SHARE`;
              await tx.$queryRaw`SELECT id FROM regime_historico WHERE "companyId" = ${portal.companyId} FOR SHARE`;
            }
            const company = await tx.company.findUnique({ where: { id: portal.companyId }, select: {
              id: true, dataAbertura: true, regimeHistorico: { orderBy: { id: 'asc' }, select: {
                id: true, companyId: true, regime: true, vigenciaInicio: true, vigenciaFim: true, updatedAt: true,
              } },
            } });
            if (!company) return null;
            return { ...interpretarContextoMensalFs12(company, competencia),
              cadastro: JSON.parse(JSON.stringify(company)) };
          },
          lerHistorico: entrada => tx.apuracaoFs12Revisao.findMany({ where: escopo(entrada), orderBy: { revisao: 'desc' }, include: { autor: { select: { name: true } } } }),
          lerUltima: entrada => tx.apuracaoFs12Revisao.findFirst({ where: escopo(entrada), orderBy: { revisao: 'desc' }, include: { autor: { select: { name: true } } } }),
          lerComando: entrada => tx.apuracaoFs12Revisao.findFirst({ where: { ...escopo(entrada), chaveIdempotencia: entrada.chaveIdempotencia }, include: { autor: { select: { name: true } } } }),
          inserir: data => tx.apuracaoFs12Revisao.create({ data, include: { autor: { select: { name: true } } } }),
        }); }, { isolationLevel: escrita ? 'Serializable' : 'RepeatableRead' });
      } catch (error) {
        if (serializacaoFs12(error) || error?.code==='P2002') {
          if (tentativa < 2) continue;
          throw erroFs12('FS12_REVISAO_CONFLITO', 'Confirmação concorrente. Recarregue antes de confirmar.', 409);
        }
        throw error;
      }
    }
  } };
}
