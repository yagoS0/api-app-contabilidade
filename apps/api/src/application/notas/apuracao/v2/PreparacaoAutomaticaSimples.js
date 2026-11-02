import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { hashCalculo, erroCalculoObsoleto } from './CalculoConfirmado.js';
import { contextoOrigemCalculo } from './RecuperacaoCalculo.js';
import { prepararRetomada } from './PeriodosRecusadosService.js';
import { lerPeriodosAceitos } from './RbtExtratoService.js';

const scope = new AsyncLocalStorage();
const clone = value => JSON.parse(JSON.stringify(value));
// Ordem desses conjuntos não altera o fato fiscal; o payload original permanece intacto.
const conjunto = value => Array.isArray(value) ? [...value].sort((a, b) => hashCalculo(a).localeCompare(hashCalculo(b))) : value;
export const preparacaoAutomaticaAtual = () => scope.getStore() || null;
export const comPreparacaoAutomatica = (value, run) => scope.run(clone(value), run);

// Uma visão PostgreSQL, sem escrita/cache/rede. O DTO de tela e o estado do cálculo
// não são uma prova fiscal: projetamos somente os insumos efetivamente utilizados.
export async function prepararSimplesConsistente(args, { db = prisma, getDados, contexto = contextoOrigemCalculo, lerInputs, resolverIdentidade } = {}) {
  const identidade = await (resolverIdentidade || (await import('./FechamentoService.js')).resolverCnpjs)(args.portalClientId, db);
  const read = async tx => {
    const inputs = lerInputs ? await lerInputs(tx) : null;
    const dados = await (getDados || (await import('./FechamentoService.js')).getDadosFechamento)({ ...args, db: tx, preparacaoAutomatica: true });
    const origem = await contexto(args, tx);
    if (origem.contribuinteCnpj && origem.contribuinteCnpj !== identidade.contribuinteCnpj) throw erroCalculoObsoleto();
    const aceitos = await lerPeriodosAceitos({ ...args, db: tx });
    const rbt = dados.rbtPreparado;
    if (!rbt || !Array.isArray(rbt.detalhePorMes)) throw erroCalculoObsoleto();
    const prova = {
      versao: 1, portalClientId: args.portalClientId, competencia: args.competencia,
      contextoV1: origem,
      regimeApuracao: dados.regimeApuracao,
      faturamento: dados.faturamento, receitaPorTipo: dados.receitaPorTipo,
      semClassificacao: dados.semClassificacao, atividades: conjunto(dados.atividades),
      semMapeamento: conjunto(dados.atividades?._semMapeamento || []),
      origemAtividades: String(dados.origemAtividades || '').startsWith('memoria(') ? 'memoria' : dados.origemAtividades,
      prefillValor: dados.prefillValor, folhaMensal12: conjunto(dados.folhaMensal12),
      disparidades: conjunto(dados.disparidades),
      rbt: { rbt12: rbt.rbt12, origem: rbt.origem, detalhePorMes: conjunto(rbt.detalhePorMes) },
      entrega: { numeroDeclaracaoRfb: dados.entregaPgdas?.numeroDeclaracaoRfb || null, declaradaForaEm: dados.entregaPgdas?.declaradaForaEm || null },
    };
    const podar = (lista, pas) => Array.isArray(pas) ? lista.filter(item => pas.includes(String(item.pa))) : lista;
    const parametrosOriginais = { ...identidade, competencia: args.competencia, regimeApuracao: dados.regimeApuracao || 'COMPETENCIA',
      atividades: dados.atividades || [], receitasBrutasAnteriores: podar(rbt.detalhePorMes, aceitos?.receitas), folhasSalario: [], permitirSemMovimento: false };
    const retomada = await prepararRetomada(parametrosOriginais, { ...args, db: tx, persist: false });
    prova.parametrosPreparados = { ...retomada.params, atividades: conjunto(retomada.params.atividades),
      receitasBrutasAnteriores: conjunto(retomada.params.receitasBrutasAnteriores), folhasSalario: conjunto(retomada.params.folhasSalario) };
    return { dados, inputs, contexto: origem, prova: clone(prova), hash: hashCalculo(prova), identidade,
      rbt: clone(prova.rbt), receitasBrutasAnteriores: clone(retomada.params.receitasBrutasAnteriores), folhasSalario: clone(retomada.params.folhasSalario),
      parametrosOriginais: clone(parametrosOriginais), parametrosPreparados: clone(retomada.params),
      periodosAceitos: clone(aceitos ? { receitas: aceitos.receitas, folhas: aceitos.folhas } : null) };
  };
  if (typeof db.$transaction !== 'function') throw erroCalculoObsoleto();
  return db.$transaction(read, { isolationLevel: 'RepeatableRead' });
}

export async function conferirProvaAutomatica(snapshot, args, { db = prisma } = {}) {
  const vinculo = snapshot?.simulacaoSerpro?._portalCalculo;
  const automatico = vinculo?.origemCalculo === 'AUTOMATICO_SIMPLES' || String(snapshot?.idempotencyKey || '').startsWith('fech:auto:');
  if (!automatico) return null;
  const proof = vinculo?.preparacaoAutomatica;
  if (vinculo?.origemCalculo !== 'AUTOMATICO_SIMPLES' || proof?.versao !== 1 || !proof.attemptId || !proof.hash || !proof.prova || hashCalculo(proof.prova) !== proof.hash) throw erroCalculoObsoleto();
  const attempt = (await db.appSetting.findUnique({ where: { key: `ciclo_simples:${args.portalClientId}:${args.competencia}` } }))?.value;
  if (!attempt || attempt.token !== proof.attemptId || attempt.revision !== proof.revision || attempt.calculo?.calculoId !== snapshot.idempotencyKey) throw erroCalculoObsoleto();
  const atual = await prepararSimplesConsistente(args, { db });
  if (atual.hash !== proof.hash) throw erroCalculoObsoleto();
  return atual;
}
