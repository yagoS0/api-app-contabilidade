import { prisma } from '../../infrastructure/db/prisma.js';
import { encryptSecret, decryptSecret } from '../../utils/crypto.js';
import { consultarCnpjGratuito } from './consultaCnpj.js';
import { criarRepositorioConsultaCnpj } from './consultaCnpjRepository.js';
import { criarConsultaCnpjPersistente } from './consultaCnpjPersistente.js';

export const repositorioConsultaCnpj = criarRepositorioConsultaCnpj({ db: prisma, cifrar: encryptSecret, decifrar: decryptSecret });
// Bloqueio explícito nesta entrega, independente de env, payload ou configuração do banco.
// Ativação futura exige composição revisada com credenciais do produto Consulta CNPJ.
export const consultarCnpjComCache = criarConsultaCnpjPersistente({ gratuito: consultarCnpjGratuito,
  repositorio: repositorioConsultaCnpj, habilitarPago: false });
