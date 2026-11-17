// Porta específica de FS12. B2 conecta somente a consulta; sem autorização fiscal.
export { avaliarExigenciaFs12 } from "./application/avaliarExigenciaFs12.js";
export { determinarPoliticaDeclaratoriaFs12 } from "./domain/politicaDeclaratoriaFs12.js";
export { consultarFs12 } from './application/consultarFs12.js';

export { consultarFs12DaApuracao } from './application/consultarFs12DaApuracao.js';
export { confirmarFs12DaApuracao } from './application/confirmarFs12DaApuracao.js';
export { exigirDespachoPgdasFs12Permitido, exigirEnvelopePgdasFs12Permitido } from './domain/guardaPgdasFs12.js';
export { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo, consultarVinculoFs12DoCalculo, validarUsoFs12DoCalculo } from './application/vincularFs12AoCalculo.js';
export { registrarFatoCalculoFs12 } from './application/registrarFatoCalculoFs12.js';
