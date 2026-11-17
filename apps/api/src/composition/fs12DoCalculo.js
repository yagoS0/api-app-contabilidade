import { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo as vincular,
  consultarVinculoFs12DoCalculo as consultar, validarUsoFs12DoCalculo as validar } from '../modules/fiscal/publicFs12.js';
import { registrarFatoCalculoFs12 as registrar } from '../modules/fiscal/publicFs12.js';
import { criarPersistenciaFs12DoCalculo } from '../modules/fiscal/infrastructure/prisma/fs12DoCalculo.js';
import { validarCalculoConfirmado } from '../application/notas/apuracao/v2/CalculoConfirmado.js';
const persistencia = opcoes => criarPersistenciaFs12DoCalculo({ ...opcoes, validarSnapshot: validarCalculoConfirmado });

// No dispatch, HTTP route, or state transition is introduced by this composition.
export const validarFs12ParaNovoCalculo = (entrada, opcoes) => prepararFs12ParaNovoCalculo(entrada, persistencia(opcoes));
export const vincularFs12AoCalculo = (entrada, opcoes) => vincular(entrada, persistencia(opcoes));
export const consultarVinculoFs12DoCalculo = (entrada, opcoes) => consultar(entrada, persistencia(opcoes));
export const validarUsoFs12DoCalculo = (entrada, opcoes) => validar(entrada, persistencia(opcoes));
export const registrarFatoCalculoFs12 = (entrada, opcoes) => registrar(entrada, persistencia(opcoes));
