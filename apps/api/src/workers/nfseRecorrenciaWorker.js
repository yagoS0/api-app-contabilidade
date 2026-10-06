import { prisma } from '../infrastructure/db/prisma.js';
import { NFSE_ENV } from '../config.js';
import { workerRecorrenciaHabilitado } from '../application/nfse/recorrenciaConfiguracao.js';
import { executarRecorrencia } from '../application/nfse/NfseRecorrenciaService.js';
import { hojeEmSaoPaulo } from '../application/nfse/recorrenciaMensal.js';
import { autorizarExecucaoRecorrente } from '../routes/nfseRecorrencias.js';

export function iniciarWorkerNfseRecorrencia(log) {
  if (!workerRecorrenciaHabilitado(process.env, NFSE_ENV)) return () => {};
  let parado = false;
  let timer;
  const tick = async () => {
    try {
      const items = await prisma.nfseRecorrencia.findMany({ where: { ativa: true, proximaData: { lte: hojeEmSaoPaulo() },
        execucoes: { none: { status: 'EXECUTANDO' } } }, orderBy: { proximaData: 'asc' }, take: 50 });
      for (const item of items) {
        if (parado) break;
        await executarRecorrencia(item, { autorizar: autorizarExecucaoRecorrente, log });
      }
    } catch (e) { log?.error?.({ code: e.code }, 'Falha no worker de notas recorrentes'); }
    finally { if (!parado) { timer = setTimeout(tick, 60000); timer.unref?.(); } }
  };
  timer = setTimeout(tick, 5000);
  timer.unref?.();
  return () => { parado = true; clearTimeout(timer); };
}
