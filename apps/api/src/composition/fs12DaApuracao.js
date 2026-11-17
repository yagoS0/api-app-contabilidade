import { consultarFs12DaApuracao, confirmarFs12DaApuracao } from '../modules/fiscal/publicFs12.js';
import { criarPersistenciaFs12 } from '../modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
const portas = criarPersistenciaFs12();
const publica = r => {
  if (!r) return null;
  const { comandoHash, chaveIdempotencia, autor, ...dados } = r;
  return { ...dados, autorNome: autor?.name || r.autorId, origem: 'MANUAL_APURACAO', totalCentavos: r.serie.reduce((total, m) => total + m.valorCentavos, 0) };
};
export async function consultarSerieFs12DaApuracao(entrada) {
  const out = await consultarFs12DaApuracao(entrada, portas);
  return { ...out, confirmacao: publica(out.confirmacao), historico: out.historico.map(publica) };
}
export async function confirmarSerieFs12DaApuracao(entrada) {
  const out = await confirmarFs12DaApuracao(entrada, portas);
  return { ...out, confirmacao: publica(out.confirmacao) };
}
