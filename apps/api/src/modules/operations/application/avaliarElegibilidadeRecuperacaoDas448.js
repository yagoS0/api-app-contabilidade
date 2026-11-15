import { classificarElegibilidade448, fatosDaObservacao448, resumirObservacao448 } from '../domain/elegibilidadeRecuperacaoDas448.js';
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
function validar(input) {
  const keys = ['companyId','competencia','servico','documentoId','limit'];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(k => !keys.includes(k))
    || !id(input.companyId) || typeof input.competencia !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input.competencia)
    || !['GERARDAS12','GERARDASCOBRANCA17'].includes(input.servico)
    || ('documentoId' in input && !id(input.documentoId))
    || ('limit' in input && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
    throw Object.assign(new Error('Entrada inválida para prévia DAS.'), { code: 'ENTRADA_INVALIDA' });
  }
  return { ...input, limit: input.limit ?? 50 };
}
function canonico(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonico);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(k => k !== 'consultadoEm').sort().map(k => [k, canonico(value[k])]));
  return value;
}
export async function avaliarElegibilidadeRecuperacaoDas448(input, ports) {
  const args = validar(input);
  const { documentoId, ...universo } = args;
  const observacoes = [];
  for (let i = 0; i < 2; i += 1) {
    await ports.autorizar(args.companyId);
    // A fixed second observation, not a retry on error. Authorization errors stay fatal.
    const contexto = await ports.consultarContexto(universo);
    let historico;
    try { historico = { ...await ports.lerHistorico(universo), consulta: 'ok' }; }
    catch { historico = { consulta: 'falhou', items: null, truncated: null, lacunas: ['FONTE_INDISPONIVEL'] }; }
    observacoes.push({ contexto, historico });
  }
  const fatos = observacoes.map(o => fatosDaObservacao448(o.contexto, o.historico, documentoId));
  const alteradas = JSON.stringify(canonico(observacoes[0])) !== JSON.stringify(canonico(observacoes[1]));
  return { contrato: 'previa-recuperacao-das-4.4.8', ...args,
    ...classificarElegibilidade448({ bloqueios: fatos.flatMap(f => f.bloqueios),
      lacunas: [...fatos.flatMap(f => f.lacunas), ...(alteradas ? ['EVIDENCIAS_ALTERADAS_ENTRE_OBSERVACOES'] : [])] }),
    consistencia: 'DUAS_OBSERVACOES_LOCAIS_SEM_SNAPSHOT_GLOBAL',
    evidencias: observacoes.map(resumirObservacao448) };
}
