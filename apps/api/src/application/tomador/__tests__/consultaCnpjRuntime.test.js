// Executa a composição real; somente infraestrutura e consulta gratuita são simuladas.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../utils/crypto.js', () => ({ encryptSecret: jest.fn(), decryptSecret: jest.fn() }));
jest.mock('../consultaCnpj.js', () => ({ consultarCnpjGratuito: jest.fn() }));
jest.mock('../consultaCnpjRepository.js', () => ({ criarRepositorioConsultaCnpj: jest.fn() }));
import { consultarCnpjGratuito } from '../consultaCnpj.js';
import { criarRepositorioConsultaCnpj } from '../consultaCnpjRepository.js';

const CNPJ = '11222333000181';
test.each(['EMISSOR', 'CADASTRO', 'PUBLICO'])('runtime não reserva pagamento para %s mesmo com pedido malicioso e orçamento disponível', async finalidade => {
  const repositorio = { precosPersistidos: true,
    adquirir: jest.fn().mockResolvedValue({ chave: 'teste', lease: 'teste' }),
    salvar: jest.fn().mockResolvedValue(), liberar: jest.fn().mockResolvedValue(),
    reservar: jest.fn().mockResolvedValue({ autorizada: true, id: 'reserva' }), concluir: jest.fn() };
  criarRepositorioConsultaCnpj.mockReturnValue(repositorio);
  consultarCnpjGratuito.mockResolvedValue({ ok: false, motivo: 'timeout' });
  // resetModules não é usado: a instância do runtime fica isolada junto das dependências.
  let consultar;
  jest.isolateModules(() => { consultar = require('../consultaCnpjRuntime.js').consultarCnpjComCache; });
  const resultado = await consultar(CNPJ, { escopo: 'empresa:homologacao', finalidade,
    habilitarPago: true, modalidade: 'EMPRESA', consumerKey: 'sintetica', consumerSecret: 'sintetica' });
  expect(resultado).toMatchObject({ ok: false, motivo: 'timeout' });
  expect(consultarCnpjGratuito).toHaveBeenCalled();
  expect(repositorio.reservar).not.toHaveBeenCalled();
  expect(repositorio.concluir).not.toHaveBeenCalled();
});
