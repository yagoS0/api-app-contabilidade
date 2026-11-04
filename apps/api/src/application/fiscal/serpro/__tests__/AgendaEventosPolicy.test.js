import { aplicarPatchAgenda, resolverAgendaTributo, validarPoliticaAgenda, validarParametrosAgenda } from '../AgendaEventosPolicy.js';
const empty = () => ({ schemaVersion: 1 });
test('herança por campo conserva false e origem, sem ativação implícita', () => {
  const global = { schemaVersion: 1, defaults: { captura: { enabled: true, hour: 7, businessDaysBefore: 3 } }, tributos: { IRPJ: { captura: { hour: 8 } } } };
  const empresa = { schemaVersion: 1, defaults: { captura: { businessDaysBefore: 4 } }, tributos: { IRPJ: { captura: { enabled: false, hour: 9 } } } };
  const snapshot = structuredClone([global, empresa]);
  const r = resolverAgendaTributo(global, empresa, 'IRPJ');
  expect(r.parameters.captura).toEqual({ enabled: false, hour: 9, businessDaysBefore: 4 });
  expect(r.origins['captura.enabled']).toBe('EMPRESA_TRIBUTO');
  expect(r.origins['captura.businessDaysBefore']).toBe('EMPRESA_DEFAULT');
  expect(r.participation.captura).toEqual({ enabled: false, complete: true });
  expect(r).not.toHaveProperty('executionMode'); expect(r).not.toHaveProperty('mayExecute');
  expect([global, empresa]).toEqual(snapshot);
});
test('null remove override e false permanece escolha; parâmetros ausentes não ativam', () => {
  const empresa = { schemaVersion: 1, tributos: { IRPJ: { captura: { enabled: false, hour: 9 } } } };
  const next = aplicarPatchAgenda(empresa, { tributos: { IRPJ: { captura: { hour: null } } } });
  expect(next.tributos.IRPJ.captura).toEqual({ enabled: false });
  expect(empresa.tributos.IRPJ.captura.hour).toBe(9);
  expect(resolverAgendaTributo(empty(), empty(), 'ISS').participation.captura).toEqual({ enabled: false, complete: false });
});
test('marcos e captura independentes; true sem horário/offset não está completo', () => {
  const p = aplicarPatchAgenda(empty(), { defaults: { captura: { enabled: false }, lembretes: { before: { enabled: true }, onDue: { enabled: true, hour: 0 }, after: { enabled: false } } } });
  const r = resolverAgendaTributo(p, empty(), 'CSLL');
  expect(r.participation['lembretes.before']).toEqual({ enabled: true, complete: false });
  expect(r.participation['lembretes.onDue']).toEqual({ enabled: true, complete: true });
  expect(r.participation['lembretes.after'].enabled).toBe(false);
});
test.each([null, [], { enabled: true }, { executionMode: 'RELATIVO_V1' }, { defaults: { imposto: {} } }, { tributos: { OUTRA: {} } }, { defaults: { lembretes: { enabled: true } } }, { defaults: { captura: { hour: '8' } } }, { defaults: { captura: { hour: 24 } } }, { defaults: { captura: { hour: NaN } } }, { defaults: { captura: { businessDaysBefore: 0 } } }, { defaults: { captura: { businessDaysBefore: 32 } } }, { defaults: { captura: { enabled: 1 } } }, { defaults: { captura: null } }])('rejeita contrato inválido %j', p => expect(() => validarParametrosAgenda(p, { patch: true })).toThrow());
test('schema estrito, null somente patch e proteção de chaves', () => {
  expect(() => validarPoliticaAgenda({ schemaVersion: 2 })).toThrow();
  expect(() => validarPoliticaAgenda({ schemaVersion: 1, defaults: { captura: { hour: null } } })).toThrow();
  expect(() => validarParametrosAgenda(JSON.parse('{"__proto__":{"enabled":true}}'))).toThrow();
  expect(() => resolverAgendaTributo(empty(), empty(), 'DESCONHECIDO')).toThrow();
  expect(() => validarParametrosAgenda({ defaults: { captura: { hour: undefined } } })).toThrow();
});

test('patch conserva protótipos locais e cópias independentes sem aceitar classes ou getters', () => {
  const original = { schemaVersion: 1, defaults: { captura: { enabled: false, hour: 8 } } };
  const next = aplicarPatchAgenda(original, { defaults: { captura: { hour: 9 } } });
  expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(next.defaults.captura)).toBe(Object.prototype);
  expect(validarPoliticaAgenda(next)).toBe(next);
  next.defaults.captura.hour = 10;
  expect(original.defaults.captura.hour).toBe(8);
  class Captura { constructor() { this.hour = 8; } }
  expect(() => aplicarPatchAgenda(original, { defaults: { captura: new Captura() } })).toThrow();
  const getter = jest.fn(() => 8);
  const captura = Object.defineProperty({}, 'hour', { enumerable: true, get: getter });
  expect(() => aplicarPatchAgenda(original, { defaults: { captura } })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => aplicarPatchAgenda(original, { defaults: { captura: { hour: undefined } } })).toThrow();
});
