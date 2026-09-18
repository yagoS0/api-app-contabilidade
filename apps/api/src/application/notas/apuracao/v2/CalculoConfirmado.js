import crypto from 'node:crypto';

const ordenar = (v) => Array.isArray(v) ? v.map(ordenar) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, ordenar(v[k])])) : v;
export const hashCalculo = (v) => crypto.createHash('sha256').update(JSON.stringify(ordenar(v))).digest('hex');
export function insumosFormulario({ atividades, folhaMensal12, regimeApuracao = 'COMPETENCIA' }) {
  return { atividades: atividades || [], folhaMensal12: folhaMensal12 || [], regimeApuracao: regimeApuracao || 'COMPETENCIA' };
}
export function erroCalculoObsoleto() {
  return Object.assign(new Error('Os dados ou a simulação mudaram. Calcule novamente e confira o resultado antes de fechar ou transmitir.'), { code: 'CALCULO_DESATUALIZADO' });
}
export function exigirRegimeSuportado(regime = 'COMPETENCIA') {
  if ((regime || 'COMPETENCIA') !== 'COMPETENCIA') throw Object.assign(new Error('Apuração por regime de caixa ainda não tem suporte integral neste fluxo. Não foi enviada consulta nem declaração; utilize o fluxo oficial para esta empresa.'), { code: 'REGIME_APURACAO_NAO_SUPORTADO' });
}
export function criarVinculoCalculo({ portalClientId, competencia, formulario, receitasBrutasAnteriores, folhasSalario, contribuinteCnpj, contratanteCnpj }) {
  const dados = { portalClientId, competencia, formulario, receitasBrutasAnteriores, folhasSalario, ...(contribuinteCnpj ? { contribuinteCnpj, contratanteCnpj } : {}) };
  return { ...dados, calculoId: `fech:v1:${crypto.randomUUID()}:${hashCalculo(dados)}` };
}
export function validarCalculoConfirmado(snapshot, { portalClientId, competencia, calculoId, formulario }) {
  const v = snapshot?.simulacaoSerpro?._portalCalculo;
  if (!calculoId || !v || snapshot.idempotencyKey !== calculoId || v.calculoId !== calculoId
    || v.portalClientId !== portalClientId || v.competencia !== competencia) throw erroCalculoObsoleto();
  const { calculoId: _, ...dados } = v;
  if (!calculoId.endsWith(`:${hashCalculo(dados)}`)) throw erroCalculoObsoleto();
  exigirRegimeSuportado(v.formulario?.regimeApuracao);
  const atual = insumosFormulario({ atividades: snapshot.atividadesEscolhidas, folhaMensal12: snapshot.folhaMensal12, regimeApuracao: v.formulario.regimeApuracao });
  if (hashCalculo(atual) !== hashCalculo(v.formulario) || (formulario && hashCalculo(formulario) !== hashCalculo(v.formulario))) throw erroCalculoObsoleto();
  return v;
}
export function exigirEstadoLivre(snapshot) {
  if (['transmitindo', 'erro_transmissao'].includes(snapshot?.estado)) throw Object.assign(new Error('Há uma transmissão em andamento ou sem confirmação. Confira a entrega antes de iniciar outra operação.'), { code: 'TRANSMISSAO_PENDENTE_CONFERENCIA' });
}
