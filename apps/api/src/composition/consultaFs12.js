import { consultarFs12 } from '../modules/fiscal/publicFs12.js';
import { lerContextoFs12Consistente } from '../modules/fiscal/infrastructure/prisma/leituraContextoFs12.js';

export function consultarFs12DoFechamento(entrada) {
  return consultarFs12(entrada, {
    // Leitura consistente dos dois namespaces sem escrever ou reservar operação.
    lerContexto: lerContextoFs12Consistente,
    agora: () => new Date().toISOString(),
  });
}
