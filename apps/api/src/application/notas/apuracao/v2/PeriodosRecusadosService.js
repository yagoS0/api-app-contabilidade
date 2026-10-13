import { prisma } from '../../../../infrastructure/db/prisma.js';
import { hashCalculo } from './CalculoConfirmado.js';
import { buildDeclaracaoPayload } from '../../../fiscal/serpro/PgdasSimulacaoService.js';
import { SerproPgdasdService } from '../../../fiscal/serpro/SerproPgdasdService.js';
import { chaveResposta } from '../../../fiscal/serpro/SerproRespostaCache.js';
import { createHash } from 'node:crypto';

const PA = /^\d{4}-(0[1-9]|1[0-2])$/;
const RECUSA = /foi enviada\s+(folha|receita bruta)[^:]*per[íi]odo desnecess[áa]rio:?\s*(\d{2})\/(\d{4})/i;
const erroRegistro = () => Object.assign(new Error('Não foi possível conferir ou guardar os períodos recusados na simulação. Nenhuma nova tentativa foi iniciada após essa falha. Restabeleça o registro antes de simular novamente.'), { code: 'PERIODOS_RECUSADOS_REGISTRO_INDISPONIVEL' });

export async function assinaturaSimulacao(params) {
  return (await assinaturasSimulacao(params))[0];
}

export async function assinaturasSimulacao(params) {
  // Reutiliza o construtor real do envelope com transporte substituído por função local.
  // Não instancia SerproHttpClient, não autentica e não envia declaração.
  const local = new SerproPgdasdService({ client: { post: (rota, payload) => [
    chaveResposta(payload, rota), createHash('sha256').update(`${rota}|${JSON.stringify(payload)}`).digest('hex'),
  ] } });
  return local.transmitirDeclaracao({
    contratanteCnpj: params.contratanteCnpj, contribuinteCnpj: params.contribuinteCnpj,
    periodoApuracao: params.competencia,
    declaracao: buildDeclaracaoPayload({ ...params, indicadorTransmissao: false }),
  });
}

/** Simulação somente. O callback do ajuste deve ser aguardado após cada recusa explícita,
 * antes da próxima chamada. Não altera receitas/folhas salvas nem confirma lista aceita.
 * Insumos diferentes geram outro vínculo; não importa ledger sem prova do payload original. */
export async function executarComRetomada(executar, params, {
  portalClientId, competencia, ajustarPeriodos, db = prisma,
}) {
  if (typeof executar !== 'function' || typeof ajustarPeriodos !== 'function') throw new TypeError('Executores da simulação são obrigatórios.');
  const preparado = await prepararRetomada(params, { portalClientId, competencia, db });
  const resultado = await ajustarPeriodos(executar, preparado.params, { onPeriodoRemovido: preparado.onPeriodoRemovido });
  return { ...resultado, periodosReaproveitados: preparado.periodosReaproveitados };
}

/** persist:false é inspeção somente leitura; devolve payload preparado sem chamar provedor. */
export async function prepararRetomada(params, { portalClientId, competencia, db = prisma, persist = true }) {
  if (!portalClientId || !PA.test(String(competencia)) || params?.competencia !== competencia
    || !Array.isArray(params.receitasBrutasAnteriores || []) || !Array.isArray(params.folhasSalario || [])) {
    throw Object.assign(new Error('Contexto inválido para retomar a simulação.'), { code: 'PERIODOS_RECUSADOS_CONTEXTO_INVALIDO' });
  }
  const contexto = { portalClientId, competencia, insumosHash: hashCalculo({ versao: 1, operacao: 'SIMULACAO_PGDASD', params }) };
  const originais = { receitas: params.receitasBrutasAnteriores || [], folhas: params.folhasSalario || [] };
  const validaRecusa = r => ['receitas', 'folhas'].includes(r?.lista) && PA.test(String(r?.pa))
    && originais[r.lista].some(p => String(p.pa) === r.pa);
  let recusas;
  try {
    recusas = await db.apuracaoPeriodoRecusado.findMany({ where: contexto, select: { lista: true, pa: true } });
    if (!Array.isArray(recusas) || recusas.some(r => !validaRecusa(r))) throw erroRegistro();
  } catch { throw erroRegistro(); }

  const retomados = { receitas: [], folhas: [] };
  for (const r of recusas) if (!retomados[r.lista].includes(r.pa)) retomados[r.lista].push(r.pa);
  const guardar = async (recusa, serproChamadaId = null) => {
    if (!validaRecusa(recusa)) throw erroRegistro();
    if (!persist) return;
    const evidencia = { ...contexto, lista: recusa.lista, pa: recusa.pa };
    const id = hashCalculo(evidencia);
    try {
      await db.apuracaoPeriodoRecusado.upsert({ where: { id }, create: { id, ...evidencia,
        fonte: serproChamadaId ? 'LEDGER_ASSINATURA_EXATA' : 'RESPOSTA_SIMULACAO', serproChamadaId }, update: {} });
    } catch { throw erroRegistro(); }
  };
  const podados = () => ({
    ...params,
    receitasBrutasAnteriores: originais.receitas.filter(p => !retomados.receitas.includes(String(p.pa))),
    folhasSalario: originais.folhas.filter(p => !retomados.folhas.includes(String(p.pa))),
  });
  // Ledger antigo não guardava PA da simulação. Só o hash integral recomposto prova vínculo.
  // Cada passagem elimina um PA comprovado, sem rede e sem aumentar o teto de novas chamadas.
  const limite = originais.receitas.length + originais.folhas.length;
  const evidenciasLedger = [];
  for (let i = 0; i < limite; i += 1) {
    const atuais = podados();
    let anterior;
    try {
      const assinaturas = await assinaturasSimulacao(atuais);
      anterior = await db.serproChamada.findFirst({ where: {
        portalClientId, cnpj: String(params.contribuinteCnpj).replace(/\D/g, ''),
        idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', rota: '/Declarar', assinatura: { in: assinaturas },
        status: { in: ['ok', 'erro', 'incerta', 'reservada'] },
      }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, httpStatus: true, erroCodigo: true, erroMensagem: true } });
    } catch { throw erroRegistro(); }
    if (anterior?.status !== 'erro' || anterior.erroCodigo !== 'SERPRO_BUSINESS_ERROR' || ![400, 422].includes(anterior.httpStatus)) break;
    const match = String(anterior.erroMensagem || '').match(RECUSA);
    if (!match) break;
    const recusa = { lista: /folha/i.test(match[1]) ? 'folhas' : 'receitas', pa: `${match[3]}-${match[2]}` };
    if (!validaRecusa(recusa) || retomados[recusa.lista].includes(recusa.pa)) break;
    await guardar(recusa, anterior.id);
    retomados[recusa.lista].push(recusa.pa);
    evidenciasLedger.push({ id: anterior.id, ...recusa });
  }
  return { params: podados(), periodosReaproveitados: retomados, evidenciasLedger,
    onPeriodoRemovido: recusa => guardar(recusa) };
}
