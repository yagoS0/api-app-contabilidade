import { consultarFs12 } from './consultarFs12.js';
import { validarIdentidadeFs12 } from '../domain/serieManualFs12.js';
export async function consultarFs12DaApuracao(entrada, { transacionar }) {
  validarIdentidadeFs12(entrada);
  return transacionar(async portas => {
    await portas.autorizar(entrada);
    const contexto = await portas.lerContexto(entrada);
    const base = await consultarFs12(entrada, { lerContexto: async () => contexto, agora: portas.agora });
    const historico = await portas.lerHistorico({ ...entrada, companyId: contexto.empresaId });
    return { ...base, contextoRevisao: portas.hash(contexto), confirmacao: historico[0] || null,
      historico, revisaoVigente: historico[0]?.revisao || 0 };
  }, { escrita: false });
}
