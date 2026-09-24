import { Router } from 'express';
import { prisma } from '../../infrastructure/db/prisma.js';
import { requireClientCompanyAccess } from '../../middlewares/requireClientCompanyAccess.js';
import { obterAnaliseEmpresa } from '../../application/planejamento/AnaliseEmpresaService.js';
import { obterClientesAnalise } from '../../application/planejamento/ClientesAnaliseService.js';
import { disponibilidadeRelatorios, validarPeriodoPortal } from '../../../../../packages/shared/src/analise/portalCliente.js';

export function createRelatoriosClienteRouter({ client = prisma, acesso = requireClientCompanyAccess, agora = () => new Date(), analise = obterAnaliseEmpresa, clientes = obterClientesAnalise } = {}) {
  const router = Router({ mergeParams: true });
  for (const [path, tipo] of [['/fechamentos','fechamentos'],['/analise','analise'],['/clientes','clientes']]) {
    router.get(path, acesso(), async (req,res) => {
      try {
        const resultado = await client.$transaction(async tx => {
          const portalClientId = String(req.params.companyId);
          const data = agora();
          const referencia = data.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,7);
          const circulares = await tx.companyMonthlyCircular.findMany({where:{portalClientId,fechadoContabilEm:{not:null}},select:{competencia:true}});
          const disponibilidade = disponibilidadeRelatorios(circulares.map(c=>c.competencia),referencia);
          if (tipo === 'fechamentos') return { ok:true, ...disponibilidade };
          if (!disponibilidade.liberado) return { ok:false,error:'FECHAMENTOS_PENDENTES',message:'Os relatórios estarão disponíveis após o fechamento contábil dos três meses anteriores.',...disponibilidade };
          const filtros = validarPeriodoPortal(req.query,disponibilidade);
          const dados = await (tipo === 'clientes' ? clientes : analise)({portalClientId,...filtros,client:tx,agora:data,permitirLacunas:true});
          // Relatórios não concedem acesso a guias que o escritório ainda não liberou.
          if (dados.guias) dados.guias = dados.guias.filter(g=>g.liberadaCliente).map(({id,tipo,competencia,valor,vencimento,paymentStatus,parcelamentoId,numeroParcela})=>({id,tipo,competencia,valor,vencimento,paymentStatus,parcelamentoId,numeroParcela,liberadaCliente:true}));
          return {...dados,disponibilidade};
        }, {isolationLevel:'RepeatableRead',timeout:20000});
        return res.status(resultado.ok ? 200 : 409).json(resultado);
      } catch (err) {
        if (err.message === 'SEM_MESES_FECHADOS') return res.status(409).json({ok:false,error:'SEM_MESES_FECHADOS',message:'Não há meses com fechamento contábil no período selecionado.'});
        const invalido = err.message === 'PERIODO_INVALIDO';
        return res.status(invalido ? 400 : 500).json({ok:false,error:invalido?'PERIODO_INVALIDO':'RELATORIO_INDISPONIVEL',message:invalido?'Escolha um intervalo dentro dos últimos 12 meses concluídos.':'Não foi possível carregar o relatório. Tente novamente.'});
      }
    });
  }
  return router;
}
