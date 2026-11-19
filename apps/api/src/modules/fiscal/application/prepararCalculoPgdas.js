import { erroFs12, validarIdentidadeFs12 } from '../domain/serieManualFs12.js';

const conflito = () => erroFs12('FS12_CALCULO_CONFLITO', 'A empresa ou a revisão da folha mudou. Confira a apuração.', 409);
const copiar = value => JSON.parse(JSON.stringify(value));
const referencias = ['portalClientId', 'companyId', 'competencia', 'revisaoFs12Id', 'revisaoFs12', 'contextoHash', 'politicaVersao'];

/** Preparação sem transporte ou escrita. Ainda não composta nas rotas produtivas.
 * A política B3.3a real conserva mesesPropostos:null. A seleção sintética usada
 * nos ensaios pertence exclusivamente ao harness de testes, não à requisição HTTP.
 * As portas autenticam e leem no servidor; este resultado não autoriza despacho.
 * O futuro salvamento deve revalidar a prova e vincular B3.2 na mesma transação
 * do snapshot. Nenhuma transação de banco deve permanecer aberta durante rede.
 */
export async function prepararCalculoPgdas(entrada, { prepararFs12, planejarRemessa, lerParametrosCalculo, construirPayload }) {
  validarIdentidadeFs12(entrada);
  const identidade = { portalClientId: entrada.portalClientId, competencia: entrada.competencia, autorId: entrada.autorId };
  const prova = copiar(await prepararFs12(identidade));
  if (prova.portalClientId !== identidade.portalClientId || prova.competencia !== identidade.competencia
    || !prova.companyId || !prova.revisaoFs12Id || prova.revisaoFs12 !== entrada.revisaoEsperada
    || prova.contextoHash !== entrada.contextoHash || !Array.isArray(prova.serie)) throw conflito();
  const planejamento = await planejarRemessa({ identidade, prova: copiar(prova) });
  if (!Array.isArray(planejamento?.mesesPropostos) || !planejamento.mesesPropostos.length
    || !Array.isArray(planejamento.impedimentos) || planejamento.impedimentos.length
    || !planejamento.versaoPolitica || identidade.competencia >= '2027-01') {
    return { estado: 'BLOQUEADO', prova, planejamento: planejamento == null ? null : copiar(planejamento),
      payload: null, autorizaEfeitoFiscal: false };
  }
  // A seleção indica meses, nunca fornece valores substitutos da confirmação.
  const meses = planejamento.mesesPropostos;
  const serie = new Map(prova.serie.map(item => [item.mes, item.valorCentavos]));
  if (serie.size !== prova.serie.length || new Set(meses).size !== meses.length
    || meses.some(mes => !serie.has(mes) || !Number.isSafeInteger(serie.get(mes)) || serie.get(mes) < 0)) throw conflito();
  const parametros = await lerParametrosCalculo(identidade);
  if (parametros?.portalClientId !== prova.portalClientId || parametros.companyId !== prova.companyId
    || parametros.competencia !== prova.competencia || !/^\d{14}$/.test(parametros.contribuinteCnpj || '')) throw conflito();
  const atual = await prepararFs12(identidade);
  if (referencias.some(campo => atual?.[campo] !== prova[campo]) || JSON.stringify(atual.serie) !== JSON.stringify(prova.serie)) throw conflito();
  const folhasSalario = meses.map(mes => ({ pa: mes, valor: serie.get(mes) / 100 }));
  const payload = construirPayload({ ...copiar(parametros), folhasSalario, indicadorTransmissao: false });
  return { estado: 'PREPARADO', prova, planejamento: copiar(planejamento), folhasSalario,
    payload, autorizaEfeitoFiscal: false };
}
