import { decodificarArquivoEvento, LIMITE_XML_EVENTO } from './decodificarRespostaSefinCancelamento.js';

const TIPOS = Object.freeze({ CANCELAMENTO: '101101', SOLICITACAO_CANCELAMENTO_ANALISE_FISCAL: '101103', CANCELAMENTO_DEFERIDO_ANALISE_FISCAL: '105104', CANCELAMENTO_INDEFERIDO_ANALISE_FISCAL: '105105' });
const mensagensValidas = lista => lista == null || (Array.isArray(lista) && lista.length <= 100 && lista.every(m =>
  m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).every(k => ['Codigo', 'Descricao', 'Complemento'].includes(k))
  && ['Codigo', 'Descricao', 'Complemento'].every(k => m[k] == null || typeof m[k] === 'string')));

// ADN Contribuinte v1, SHA256 b2d8d5aec4b621db552bfca4d7b39ec2403c0aa552b8fe4b9b2f02a02b64a342.
// https://adn.producaorestrita.nfse.gov.br/contribuintes/swagger/v1/swagger.json — 24/11/2026.
// Campos opcionais não são obrigatórios por inferência; confirmação exige fatos documentais.
export function decodificarRespostaAdnCancelamento(corpo, contexto, status = 200) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)
    || corpo.TipoAmbiente !== (contexto.ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO')
    || !mensagensValidas(corpo.Erros) || !mensagensValidas(corpo.Alertas)
    || (corpo.VersaoAplicativo != null && typeof corpo.VersaoAplicativo !== 'string')
    || (corpo.DataHoraProcessamento != null && (typeof corpo.DataHoraProcessamento !== 'string' || !Number.isFinite(Date.parse(corpo.DataHoraProcessamento)))))
    throw Error('ENVELOPE_ADN_INVALIDO');
  const documentos = [], problemas = [];
  const erros = corpo.Erros || [];
  const esperado = { 200: 'DOCUMENTOS_LOCALIZADOS', 400: 'REJEICAO', 404: 'NENHUM_DOCUMENTO_LOCALIZADO' }[status];
  if (!esperado || corpo.StatusProcessamento !== esperado) throw Error('STATUS_ADN_INCOMPATIVEL');
  if (status !== 200) {
    if (corpo.LoteDFe != null && (!Array.isArray(corpo.LoteDFe) || corpo.LoteDFe.length)) throw Error('ERRO_ADN_COM_DOCUMENTOS');
    if (status === 404 && erros.some(e => e.Codigo === 'E2241')) return { documentos, problemas: ['RESTRICAO_VINCULO_E2241'], completa: false };
    if (status === 404 && erros.length === 1 && erros[0].Codigo === 'E2240' && !(corpo.Alertas || []).length)
      return { documentos, problemas: ['AUSENCIA_EVENTOS'], completa: true };
    return { documentos, problemas: ['REJEICAO_OU_AUSENCIA_NAO_COMPROVADA'], completa: false };
  }
  if (erros.length || (corpo.Alertas || []).length) problemas.push('RESPOSTA_PARCIAL');
  const lote = corpo.LoteDFe;
  if (!Array.isArray(lote) || !lote.length || lote.length > 100) throw Error('LIMITE_COLECAO_ADN');
  let volume = 0;
  for (let indice = 0; indice < lote.length; indice++) {
    const item = lote[indice];
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some(k => !['NSU', 'ChaveAcesso', 'TipoDocumento', 'TipoEvento', 'ArquivoXml', 'DataHoraGeracao'].includes(k))
        || item.TipoDocumento !== 'EVENTO' || !Object.hasOwn(TIPOS, item.TipoEvento)
        || typeof item.ChaveAcesso !== 'string' || !/^\d{50}$/.test(item.ChaveAcesso)
        || item.ChaveAcesso !== contexto.chaveAcesso
        || (item.NSU != null && (!Number.isSafeInteger(item.NSU) || item.NSU < 0))
        || (item.DataHoraGeracao != null && (typeof item.DataHoraGeracao !== 'string' || !Number.isFinite(Date.parse(item.DataHoraGeracao)))))
        throw Error('METADATA_ADN_INVALIDA');
      if (volume >= 8_000_000) throw Error('VOLUME_ADN_EXCESSIVO');
      const aberto = decodificarArquivoEvento(item.ArquivoXml, { limite: Math.min(LIMITE_XML_EVENTO, 8_000_000 - volume) });
      volume += aberto.bytes;
      documentos.push({ xml: aberto.xml, tipoEvento: TIPOS[item.TipoEvento], chaveAcesso: item.ChaveAcesso, indice });
    } catch { problemas.push(`DOCUMENTO_ADN_INVALIDO:${indice}`); }
  }
  return { documentos, problemas, completa: problemas.length === 0 };
}
