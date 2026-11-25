// Internal composition/transport facade. Never bind these capabilities to HTTP input.
export {criarContextoComandoFs12,comComandoFs12,resultadoComandoFs12,
  exigirDespachoComandoFs12,prepararTransporteComandoFs12,identidadeComandoFs12Atual,
  associarReservaFs12NaTx,registrarReservaFs12,revalidarFs12NaTx,
  registrarMarcadorFs12,custodiarRespostaComandoFs12} from './infrastructure/context/comandoFs12Context.js';
