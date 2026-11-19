const digits = value => String(value ?? '').replace(/\D/g, '');
const numero = value => ['string', 'number'].includes(typeof value) && String(value).trim() ? String(value).trim() : null;
const falha = (code, message) => Object.assign(new Error(message), { code, status: 409 });
const dadosDoEnvelope = raw => {
  let dados = raw?.dados ?? raw?.dadosSaida;
  if (typeof dados === 'string' && !dados.trim()) return null;
  if (typeof dados === 'string') { try { dados = JSON.parse(dados); } catch { throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'O serviço retornou dados documentais incompletos.'); } }
  return dados;
};

// Ecos são opcionais; quando presentes não podem contradizer o pedido autenticado.
export function validarIdentidadeDocumentalPgdas(dados, { cnpj, competencia, numeroDeclaracao } = {}) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'O serviço não identificou o documento solicitado.');
  for (const field of ['cnpjCompleto', 'cnpj', 'contribuinteCnpj']) {
    if (dados[field] != null && digits(dados[field]) !== digits(cnpj)) throw falha('PGDAS_IDENTIDADE_DIVERGENTE', 'O documento retornado pertence a outra empresa.');
  }
  for (const field of ['pa', 'periodoApuracao', 'competencia']) {
    if (dados[field] != null && String(dados[field]).replace('-', '') !== String(competencia).replace('-', '')) throw falha('PGDAS_IDENTIDADE_DIVERGENTE', 'O documento retornado pertence a outra competência.');
  }
  for (const field of ['numeroDeclaracao', 'idDeclaracao']) {
    if (numeroDeclaracao && dados[field] != null && numero(dados[field]) !== numeroDeclaracao) throw falha('PGDAS_DECLARACAO_DIVERGENTE', 'A declaração retornada mudou. Consulte novamente antes de recuperar os documentos.');
  }
  return dados;
}

export function identificarDeclaracaoDocumentalPgdas(raw, contexto) {
  const dados = dadosDoEnvelope(raw);
  const mensagens = Array.isArray(raw?.mensagens) ? raw.mensagens : [];
  const negativas = ['[EntradaIncorreta-PGDASD-MSG_ISN_005]', 'EntradaIncorreta-PGDASD-MSG_ISN_005', '[Aviso-PGDASD-MSG_ISN_027]'];
  if (mensagens.length && mensagens.every(m => negativas.includes(m?.codigo)) && (dados == null || dados === '')) return { confirmada: false, numeroDeclaracao: null };
  if (raw?.status != null && Number(raw.status) !== 200) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'A consulta oficial não confirmou a declaração.');
  if (mensagens.some(m => !['Sucesso-PGDASD', '[Sucesso-PGDASD]'].includes(m?.codigo))) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'A consulta oficial retornou uma ocorrência que precisa de conferência.');
  let candidatos;
  if (dados?.periodo != null || dados?.periodos != null) {
    validarIdentidadeDocumentalPgdas(dados, contexto);
    const periodos = dados.periodo != null ? [dados.periodo] : dados.periodos;
    if (!Array.isArray(periodos)) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'Índice de declarações incompleto.');
    const encontrados = periodos.filter(p => String(p?.periodoApuracao) === contexto.competencia.replace('-', ''));
    if (encontrados.length !== 1 || !Array.isArray(encontrados[0].operacoes)) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'O índice não identifica a competência solicitada.');
    candidatos = encontrados[0].operacoes.map(o => o?.indiceDeclaracao).filter(Boolean);
  } else candidatos = Array.isArray(dados) ? dados : dados?.declaracoes ?? dados?.listaDeclaracoes ?? [dados];
  if (!Array.isArray(candidatos) || !candidatos.length) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'Nenhuma declaração identificada na resposta oficial.');
  candidatos.forEach(c => validarIdentidadeDocumentalPgdas(c, contexto));
  const numeros = [...new Set(candidatos.map(c => numero(c?.numeroDeclaracao ?? c?.idDeclaracao)).filter(Boolean))];
  if (numeros.length !== 1) throw falha('PGDAS_DECLARACAO_AMBIGUA', 'O índice não identifica uma única declaração. Confira a revisão oficial antes de recuperar documentos.');
  return { confirmada: true, numeroDeclaracao: numeros[0] };
}

export function validarExtratoDocumentalPgdas(dados, contexto, envelope) {
  if (envelope?.status != null && Number(envelope.status) !== 200) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'O serviço não confirmou o extrato solicitado.');
  validarIdentidadeDocumentalPgdas(dados, contexto);
  if (numero(dados.numeroDeclaracao ?? dados.idDeclaracao) !== contexto.numeroDeclaracao) throw falha('PGDAS_DECLARACAO_DIVERGENTE', 'O extrato não identifica a declaração confirmada na consulta.');
}

// Apenas os nós documentais consumidos pelo contrato DAS; não varrer o envelope
// de contratante/autorPedidoDados, cujos números não identificam o contribuinte.
function nosDocumentaisDas(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw falha('PGDAS_DAS_INCOMPLETO', 'Dados documentais inválidos.'); } }
  if (Array.isArray(value)) return value.flatMap(nosDocumentaisDas);
  if (!value || typeof value !== 'object') return [];
  return [value, ...(['detalhamentoDas'].flatMap(key => value[key] == null ? [] : nosDocumentaisDas(value[key])))];
}
function dataDocumentalValida(value) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (raw.includes('T') && !Number.isFinite(new Date(raw).getTime())) return null;
  const partes = iso ? iso.slice(1, 4) : br ? [br[3], br[2], br[1]] : null;
  if (!partes) return null;
  const [y, m, d] = partes.map(Number);
  const data = new Date(Date.UTC(y, m - 1, d));
  return data.getUTCFullYear() === y && data.getUTCMonth() === m - 1 && data.getUTCDate() === d ? data.toISOString().slice(0, 10) : null;
}
export function validarDasDocumentalPgdas(raw, mapped, contexto) {
  if (raw?.status != null && Number(raw.status) !== 200) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'O serviço não confirmou o DAS solicitado.');
  if (Array.isArray(raw?.mensagens) && raw.mensagens.some(m => !['Sucesso-PGDASD', '[Sucesso-PGDASD]'].includes(m?.codigo))) throw falha('PGDAS_DOCUMENTO_INCONCLUSIVO', 'O provedor retornou ocorrência incompatível com a confirmação do DAS.');
  const nos = nosDocumentaisDas(dadosDoEnvelope(raw));
  const numeros = [];
  const datas = [];
  for (const no of nos) {
    validarIdentidadeDocumentalPgdas(no, contexto);
    for (const [key, value] of Object.entries(no)) {
      if (/^(numeroDocumento|numeroDas|numeroDar|numeroGuia|nossoNumero)$/i.test(key) && value != null) numeros.push(numero(value));
      if (/venc/i.test(key) && value != null) datas.push(dataDocumentalValida(value));
    }
  }
  const bytes = mapped?.pdfBuffer;
  const pdfValido = bytes?.length >= 5 && [37, 80, 68, 70, 45].every((byte, i) => bytes[i] === byte);
  const valor = mapped?.parsed?.valor;
  const valorValido = ['number', 'string'].includes(typeof valor) && String(valor).trim() !== '' && Number.isFinite(Number(valor)) && Number(valor) >= 0;
  const data = dataDocumentalValida(mapped?.parsed?.vencimento);
  const numeroCoerente = numeros.length > 0 && numeros.every(n => n && n === numero(mapped?.numeroDocumento));
  if (!pdfValido || !numeroCoerente || !valorValido || !data || datas.some(d => !d || d !== data)) {
    throw falha('PGDAS_DAS_INCOMPLETO', 'O DAS retornado não contém PDF, número, valor e vencimento suficientes e coerentes.');
  }
}

export function projetarEstadoDocumentalPgdas({ company, circular, guide, snapshot, entregaExterna, consulta } = {}) {
  const evidAltan = snapshot?.simulacaoSerpro?._portalTransmissao?.evidencia;
  const calculo = snapshot?.simulacaoSerpro?._portalCalculo;
  // Número, PDF e índice não demonstram autoria. Correlacionar o resultado
  // ao snapshot/cálculo reservado, empresa, competência e declaração.
  const evidenciaCorrelacionada = Boolean(evidAltan?.origem === 'ALTAN'
    && snapshot?.simulacaoSerpro?._portalTransmissao?.resultado === 'TRANSMITIDA'
    && company?.id && snapshot?.portalClientId === company.id && calculo?.portalClientId === company.id
    && digits(company.cnpj).length === 14 && digits(evidAltan.contribuinteCnpj) === digits(company.cnpj)
    && digits(calculo?.contribuinteCnpj) === digits(company.cnpj)
    && snapshot?.competencia && evidAltan.competencia === snapshot.competencia && calculo?.competencia === snapshot.competencia
    && (!circular?.competencia || circular.competencia === snapshot.competencia)
    && (!consulta?.competencia || consulta.competencia === snapshot.competencia)
    && calculo?.calculoId && calculo.calculoId === snapshot.idempotencyKey
    && numero(evidAltan.numeroDeclaracao) && numero(evidAltan.numeroDeclaracao) === numero(snapshot.numeroDeclaracao));
  const numeroDeclaracao = numero(consulta?.numeroDeclaracao) || numero(circular?.pgdasNumeroDeclaracao) || (evidenciaCorrelacionada ? numero(evidAltan.numeroDeclaracao) : null);
  const numeroHistorico = snapshot?.estado === 'transmitida' ? numero(snapshot.numeroDeclaracao) : null;
  const causalAltan = evidenciaCorrelacionada && numero(evidAltan.numeroDeclaracao) === numeroDeclaracao;
  const origem = numeroDeclaracao ? (causalAltan ? 'ALTAN' : 'DESCONHECIDA') : null;
  const mesmaDeclaracao = numeroDeclaracao && numero(circular?.pgdasNumeroDeclaracao) === numeroDeclaracao;
  const extratoOk = Boolean(mesmaDeclaracao && circular?.pgdasDeclaracaoFileId && circular?.pgdasReciboFileId);
  const total = circular?.dasTotal;
  const zeroComprovado = extratoOk && total != null && typeof total !== 'boolean' && String(total).trim() !== '' && Number(total) === 0 && !circular?.dasNumeroDocumento;
  const identidadeGuia = (!company?.id || !guide?.portalClientId || guide.portalClientId === company.id) && (!circular?.competencia || !guide?.competencia || guide.competencia === circular.competencia);
  const numeroDas = numero(circular?.dasNumeroDocumento);
  const documentoGuia = numeroDas ? String(guide?.sourceFileId || '').endsWith(`:${numeroDas}`) : Boolean(numeroDeclaracao && guide?.extracted?.pgdasNumeroDeclaracao === numeroDeclaracao);
  const guiaOk = Boolean(!zeroComprovado && guide?.pdfBytes?.length && identidadeGuia && documentoGuia && (!consulta || mesmaDeclaracao));
  const documentos = {
    extrato: { ok: extratoOk, estado: extratoOk ? 'DISPONIVEL' : 'PENDENTE', declaracaoFileId: mesmaDeclaracao ? circular?.pgdasDeclaracaoFileId || null : null, reciboFileId: mesmaDeclaracao ? circular?.pgdasReciboFileId || null : null },
    guia: { ok: guiaOk || zeroComprovado, estado: guiaOk ? 'DISPONIVEL' : zeroComprovado ? 'NAO_DEVIDO' : 'PENDENTE', guideId: guiaOk ? guide.id : null, valor: guiaOk && guide.valor != null ? String(guide.valor) : null, vencimento: guiaOk ? guide.vencimento || null : null },
  };
  return { ok: true, numeroDeclaracao, origem, completos: documentos.extrato.ok && documentos.guia.ok,
    partial: !numeroDeclaracao || !documentos.extrato.ok || !documentos.guia.ok,
    transmissao: { numeroHistorico, declaradaExternaManualmente: Boolean(entregaExterna?.transmitidaEm), confirmada: Boolean(numeroDeclaracao), estado: numeroDeclaracao ? 'CONFIRMADA' : 'VERIFICACAO_PENDENTE', numeroDeclaracao, origem,
      tentativaLocalIncerta: ['erro_transmissao', 'transmitindo'].includes(snapshot?.estado) },
    documentos, pagamento: { estado: guiaOk && guide?.paymentStatus === 'PAID' ? 'PAGO_REGISTRADO' : 'NAO_CONFIRMADO', origem: guiaOk ? guide?.paymentStatusSource || null : null, confirmadoEm: guiaOk ? guide?.paymentConfirmedAt || guide?.clienteConfirmouEm || null : null } };
}

export function identificarDeclaracaoNoIndice(indice, { competencia, contribuinteCnpj }) {
  const resultado = identificarDeclaracaoDocumentalPgdas(indice, { competencia, cnpj: contribuinteCnpj });
  return resultado.confirmada ? resultado : null;
}
