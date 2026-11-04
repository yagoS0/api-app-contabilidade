// Pure configuration only. Participation never grants execution or fiscal capability.
export const AGENDA_TRIBUTOS = Object.freeze(['SIMPLES', 'IRPJ', 'CSLL', 'PIS', 'COFINS', 'ISS', 'INSS', 'FGTS', 'PARCELAMENTO']);
// Technical candidate limit, not a fiscal deadline; requires review before application.
export const MAX_DIAS_UTEIS = 31;
const fields = {
  captura: { enabled: 'boolean', businessDaysBefore: 'days', hour: 'hour' },
  lembretes: {
    before: { enabled: 'boolean', businessDays: 'days', hour: 'hour' },
    onDue: { enabled: 'boolean', hour: 'hour' },
    after: { enabled: 'boolean', businessDays: 'days', hour: 'hour' },
  },
};
const schema = { defaults: fields, tributos: Object.fromEntries(AGENDA_TRIBUTOS.map(t => [t, fields])) };
const fail = path => { throw Object.assign(new Error(`Parâmetro de agenda inválido: ${path}`), { code: 'INVALID_EVENT_POLICY', status: 422 }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function validate(value, shape, path, patch) {
  if (!object(value)) fail(path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !Object.hasOwn(shape, key)) fail(path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`);
    const item = descriptor.value, type = shape[key];
    if (typeof type === 'object') validate(item, type, `${path}.${key}`, patch);
    else if (!(patch && item === null)) {
      if (type === 'boolean' ? typeof item !== 'boolean' : !Number.isInteger(item)
        || item < (type === 'days' ? 1 : 0) || item > (type === 'days' ? MAX_DIAS_UTEIS : 23)) fail(`${path}.${key}`);
    }
  }
}
export function validarParametrosAgenda(value, { patch = false } = {}) {
  validate(value, schema, 'agendaEventos', patch);
  return value;
}
export function validarPoliticaAgenda(value) {
  if (!object(value) || value.schemaVersion !== 1
    || Reflect.ownKeys(value).some(k => !['schemaVersion', 'defaults', 'tributos'].includes(k))) fail('schemaVersion');
  const { schemaVersion: _version, ...parameters } = value;
  validarParametrosAgenda(parameters);
  return value;
}
function merge(base, patch) {
  // Both inputs were validated before merging: JSON primitives and plain objects only.
  // Parse in this realm; do not relax the strict prototype guard for foreign objects.
  const result = JSON.parse(JSON.stringify(base));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (object(value)) {
      result[key] = merge(result[key] || {}, value);
      if (!Object.keys(result[key]).length) delete result[key];
    } else result[key] = value;
  }
  return result;
}
export function aplicarPatchAgenda(policy, patch) {
  validarPoliticaAgenda(policy);
  validarParametrosAgenda(patch, { patch: true });
  return validarPoliticaAgenda(merge(policy, patch));
}
function overlay(target, source, origins, label, prefix = '') {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (object(value)) overlay(target[key] ||= {}, value, origins, label, path);
    else { target[key] = value; origins[path] = label; }
  }
}
export function resolverAgendaTributo(globalPolicy, companyPolicy, tributo) {
  validarPoliticaAgenda(globalPolicy); validarPoliticaAgenda(companyPolicy);
  if (!AGENDA_TRIBUTOS.includes(tributo)) fail('tributo');
  const parameters = {}, origins = {};
  for (const [layer, label] of [
    [globalPolicy.defaults, 'GLOBAL_DEFAULT'], [globalPolicy.tributos?.[tributo], 'GLOBAL_TRIBUTO'],
    [companyPolicy.defaults, 'EMPRESA_DEFAULT'], [companyPolicy.tributos?.[tributo], 'EMPRESA_TRIBUTO'],
  ]) overlay(parameters, layer || {}, origins, label);
  const paths = ['captura', 'lembretes.before', 'lembretes.onDue', 'lembretes.after'];
  const participation = Object.fromEntries(paths.map(path => {
    const value = path.split('.').reduce((v, k) => v?.[k], parameters);
    const offset = path === 'captura' ? 'businessDaysBefore' : path === 'lembretes.onDue' ? null : 'businessDays';
    return [path, { enabled: value?.enabled === true,
      complete: Number.isInteger(value?.hour) && (!offset || Number.isInteger(value?.[offset])) }];
  }));
  return { tributo, parameters, origins, participation };
}
