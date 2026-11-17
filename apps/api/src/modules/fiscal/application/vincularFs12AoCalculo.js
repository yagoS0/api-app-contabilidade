import { erroFs12, validarIdentidadeFs12, validarSerieManualFs12 } from '../domain/serieManualFs12.js';
const conflito = () => erroFs12('FS12_CALCULO_CONFLITO', 'O cálculo ou a revisão da folha mudou. Confira a apuração.', 409);
const copia = v => JSON.parse(JSON.stringify(v));

// Called with ports already bound to the coordinator's transaction when a snapshot is written.
export async function prepararFs12ParaNovoCalculo(entrada, { transacionar }) {
  validarIdentidadeFs12(entrada);
  return transacionar(async p => {
    await p.autorizar(entrada);
    return lerProvaAtual(entrada, p);
  }, { escrita: false });
}
async function lerProvaAtual(entrada, p) {
  const contexto = await p.lerContexto(entrada);
  if (!contexto) throw erroFs12('EMPRESA_NAO_ENCONTRADA', 'Empresa não encontrada.', 404);
  const escopo = { portalClientId: entrada.portalClientId, companyId: contexto.empresaId, competencia: entrada.competencia };
  const revisao = await p.lerUltima(escopo);
  if (!revisao) throw erroFs12('FS12_CONFIRMACAO_AUSENTE', 'Confirme a folha mensal desta apuração antes de continuar.', 409);
  const { politica, serie } = validarSerieManualFs12(contexto, revisao.serie);
  if (p.hash(contexto) !== revisao.contextoRevisao || p.hash(serie) !== revisao.serieHash || politica.versao !== revisao.politicaVersao) throw conflito();
  return { ...escopo, revisaoFs12Id: revisao.id, revisaoFs12: revisao.revisao,
    contextoHash: revisao.contextoRevisao, politicaVersao: revisao.politicaVersao, serie: copia(serie), autorizaEfeitoFiscal: false };
}
function validarEntrada(entrada) {
  validarIdentidadeFs12(entrada);
  if (typeof entrada.calculoId !== 'string' || !entrada.calculoId.trim()) throw conflito();
}
function validarReferencia(calculo, prova) {
  const r = calculo?.fs12;
  if (!r || r.revisaoId !== prova.revisaoFs12Id || r.revisao !== prova.revisaoFs12
    || r.contextoHash !== prova.contextoHash || r.politicaVersao !== prova.politicaVersao) throw conflito();
}
export async function vincularFs12AoCalculo(entrada, { transacionar }) {
  validarEntrada(entrada);
  if (!Number.isSafeInteger(entrada.revisaoEsperada) || entrada.revisaoEsperada < 1 || !/^[a-f0-9]{64}$/.test(entrada.contextoHash || '')) throw conflito();
  return transacionar(async p => {
    await p.autorizar(entrada);
    const prova = await lerProvaAtual(entrada, p);
    if (entrada.revisaoEsperada !== prova.revisaoFs12 || entrada.contextoHash !== prova.contextoHash) throw conflito();
    // Integrity is established against the server snapshot, never a client supplied SHA.
    const calculo = await p.lerCalculoConfirmado(entrada);
    validarReferencia(calculo, prova);
    const data = { portalClientId: prova.portalClientId, companyId: prova.companyId, competencia: prova.competencia,
      calculoId: entrada.calculoId, revisaoFs12: prova.revisaoFs12, contextoHash: prova.contextoHash,
      politicaVersao: prova.politicaVersao, calculoConfirmado: copia(calculo), calculoHash: p.hash(calculo) };
    const anterior = await p.lerVinculo(data);
    if (anterior) {
      if (Object.keys(data).some(k => p.hash(anterior[k]) !== p.hash(data[k]))) throw conflito();
      return { vinculo: anterior, replay: true, autorizaEfeitoFiscal: false };
    }
    return { vinculo: await p.inserirVinculo(data), replay: false, autorizaEfeitoFiscal: false };
  }, { escrita: true });
}
export async function consultarVinculoFs12DoCalculo(entrada, { transacionar }) {
  validarEntrada(entrada);
  return transacionar(async p => {
    await p.autorizar(entrada);
    // Historical lookup deliberately does not require the current snapshot or latest revision.
    const contexto = await p.lerContexto(entrada);
    if (!contexto) throw erroFs12('EMPRESA_NAO_ENCONTRADA', 'Empresa não encontrada.', 404);
    return p.lerVinculo({ ...entrada, companyId: contexto.empresaId });
  }, { escrita: false });
}
export async function validarUsoFs12DoCalculo(entrada, { transacionar }) {
  validarEntrada(entrada);
  return transacionar(async p => {
    await p.autorizar(entrada);
    const prova = await lerProvaAtual(entrada, p);
    const vinculo = await p.lerVinculo({ ...entrada, companyId: prova.companyId });
    if (!vinculo || vinculo.revisaoFs12 !== prova.revisaoFs12 || vinculo.contextoHash !== prova.contextoHash
      || vinculo.politicaVersao !== prova.politicaVersao || p.hash(vinculo.calculoConfirmado) !== vinculo.calculoHash) throw conflito();
    const calculo = await p.lerCalculoConfirmado(entrada);
    validarReferencia(calculo, prova);
    if (p.hash(calculo) !== vinculo.calculoHash) throw conflito();
    return { vinculo, autorizaEfeitoFiscal: false };
  }, { escrita: false });
}
