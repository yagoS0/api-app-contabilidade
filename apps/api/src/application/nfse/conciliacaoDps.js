import { gunzipSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';

const NS = 'http://www.sped.fazenda.gov.br/nfse';
const LIMITE = 5 * 1024 * 1024;
const ignorados = new Set(['dhEmi', 'verAplic']);
const filhos = n => Array.from(n.childNodes || []).filter(x => x.nodeType === 1);
function unico(n, nome) {
  const encontrados = filhos(n).filter(x => x.localName === nome && x.namespaceURI === NS);
  if (encontrados.length !== 1) throw new Error('ESTRUTURA_XML_INVALIDA');
  return encontrados[0];
}
function caminho(n, nomes) { return nomes.reduce((atual, nome) => unico(atual, nome), n); }
function texto(n, nomes) { return caminho(n, nomes).textContent.trim(); }
function ler(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > LIMITE || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('XML_INVALIDO');
  const erros = [];
  const doc = new DOMParser({ errorHandler: { warning: x => erros.push(x), error: x => erros.push(x), fatalError: x => erros.push(x) } }).parseFromString(xml, 'text/xml');
  if (erros.length || !doc.documentElement || doc.documentElement.namespaceURI !== NS) throw new Error('XML_INVALIDO');
  if (doc.getElementsByTagNameNS('*', 'DPS').length !== 1 || doc.getElementsByTagNameNS('*', 'infDPS').length !== 1) throw new Error('DPS_AMBIGUA');
  return doc.documentElement;
}
function canonico(n, raiz = false) {
  if (n.namespaceURI !== NS) throw new Error('NAMESPACE_INVALIDO');
  const atributos = Array.from(n.attributes || [])
    .filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !(raiz && a.name === 'Id'))
    .map(a => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const elementos = filhos(n).filter(x => !(raiz && ignorados.has(x.localName)));
  if (elementos.length && Array.from(n.childNodes).some(x => [3, 4].includes(x.nodeType) && x.nodeValue.trim())) throw new Error('CONTEUDO_MISTO_INVALIDO');
  const conteudo = elementos.length ? elementos.map(x => canonico(x)) : n.textContent.trim();
  return [n.localName, atributos, conteudo];
}
function identidade(inf, { idDps, ambiente, cnpjPrestador }) {
  if (inf.getAttribute('Id') !== idDps || texto(inf, ['tpAmb']) !== String(ambiente) || texto(inf, ['prest', 'CNPJ']) !== cnpjPrestador) throw new Error('IDENTIDADE_DIVERGENTE');
  const serie = texto(inf, ['serie']);
  const numero = texto(inf, ['nDPS']);
  if (!/^\d{1,5}$/.test(serie) || !/^\d{1,15}$/.test(numero) || idDps.slice(-20) !== serie.padStart(5, '0') + numero.padStart(15, '0') || idDps.slice(11, 25) !== cnpjPrestador || idDps[10] !== '2') throw new Error('NUMERACAO_DPS_DIVERGENTE');
}
function tomador(inf) {
  const toma = unico(inf, 'toma');
  const docs = filhos(toma).filter(n => ['CNPJ', 'CPF', 'NIF', 'cNaoNIF'].includes(n.localName));
  if (docs.length !== 1) throw new Error('TOMADOR_INCONCLUSIVO');
  return `${docs[0].localName}:${docs[0].textContent.trim()}`;
}
function cancelado(data, raiz) {
  if (data?.cancelada === true || /cancel|substitu/i.test(String(data?.status || data?.situacao || ''))) return true;
  return ['evento', 'pedRegEvento', 'infEvento'].some(nome => raiz.getElementsByTagNameNS(NS, nome).length > 0);
}
function ambienteEnvelope(data, ambiente) {
  for (const campo of ['tipoAmbiente', 'tpAmb']) if (data?.[campo] != null && String(data[campo]) !== String(ambiente)) throw new Error('AMBIENTE_ENVELOPE_DIVERGENTE');
}

// Apenas consulta, sem emissão, mutação local ou decisão de avançar numeração.
export async function conciliarDps({ client, clientEventos, idDps, xmlEnviado, ambiente, cnpjPrestador, dpsPath = '/dps', nfsePath = '/nfse' }) {
  const base = { estado: 'INCONCLUSIVA', idDps };
  try {
    if (!/^DPS\d{42}$/.test(idDps || '') || !['1', '2'].includes(String(ambiente)) || !/^\d{14}$/.test(cnpjPrestador || '')) throw new Error('CONTEXTO_INVALIDO');
    const enviada = ler(xmlEnviado);
    if (enviada.localName !== 'DPS') throw new Error('XML_ENVIADO_NAO_DPS');
    const original = unico(enviada, 'infDPS');
    identidade(original, { idDps, ambiente, cnpjPrestador });
    const options = { maxContentLength: LIMITE, maxBodyLength: LIMITE, maxRedirects: 0 };
    const respostaDps = await client.get(`${dpsPath.replace(/\/+$/, '')}/${encodeURIComponent(idDps)}`, options);
    if (respostaDps.status !== 200) throw new Error('CONSULTA_DPS_NAO_CONFIRMADA');
    ambienteEnvelope(respostaDps.data, ambiente);
    const chaveAcesso = respostaDps.data?.chaveAcesso;
    if (typeof chaveAcesso !== 'string' || !/^\d{50}$/.test(chaveAcesso)) throw new Error('CHAVE_INVALIDA');
    const resposta = await client.get(`${nfsePath.replace(/\/+$/, '')}/${chaveAcesso}`, options);
    if (resposta.status !== 200) throw new Error('CONSULTA_NFSE_NAO_CONFIRMADA');
    ambienteEnvelope(resposta.data, ambiente);
    const b64 = resposta.data?.nfseXmlGZipB64;
    if (typeof b64 !== 'string' || b64.length > Math.ceil(LIMITE * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('ENVELOPE_INVALIDO');
    const xml = gunzipSync(Buffer.from(b64, 'base64'), { maxOutputLength: LIMITE }).toString('utf8');
    const raiz = ler(xml);
    if (raiz.localName !== 'NFSe' || cancelado(resposta.data, raiz) || cancelado(respostaDps.data, raiz)) throw new Error('DOCUMENTO_NAO_CONCILIAVEL');
    const inf = unico(raiz, 'infNFSe');
    // TStat do XSD oficial: 100 = NFS-e gerada; demais modalidades fora deste conciliador.
    if (texto(inf, ['cStat']) !== '100') throw new Error('STATUS_NFSE_NAO_SUPORTADO');
    if (inf.getAttribute('Id') !== `NFS${chaveAcesso}`) throw new Error('CHAVE_XML_DIVERGENTE');
    const oficial = caminho(inf, ['DPS', 'infDPS']);
    identidade(oficial, { idDps, ambiente, cnpjPrestador });
    const numeroNfse = texto(inf, ['nNFSe']);
    if (!/^\d{1,13}$/.test(numeroNfse) || /^0+$/.test(numeroNfse)) throw new Error('NUMERO_NFSE_INVALIDO');
    const evidencias = { idDps, chaveAcesso, numeroNfse, xml, origem: 'CONSULTA_DPS_NFSE' };
    const campos = [
      ['tomador', tomador(original), tomador(oficial)],
      ['competencia', texto(original, ['dCompet']), texto(oficial, ['dCompet'])],
      ['valor', texto(original, ['valores', 'vServPrest', 'vServ']), texto(oficial, ['valores', 'vServPrest', 'vServ'])],
      ['descricao', texto(original, ['serv', 'cServ', 'xDescServ']), texto(oficial, ['serv', 'cServ', 'xDescServ'])],
    ];
    if (campos.some(([, a, b]) => !a || !b)) throw new Error('CAMPOS_FISCAIS_AUSENTES');
    if (JSON.stringify(canonico(original, true)) === JSON.stringify(canonico(oficial, true))) {
      // O XML original não comprova a situação atual: cancelamento é um evento separado.
      // Swagger oficial ADN contribuintes, consultado em 13/10/2026:
      // https://adn.nfse.gov.br/contribuintes/swagger/v1/swagger.json
      // GET /NFSe/{ChaveAcesso}/Eventos -> LoteDistribuicaoNSUResponse.
      // Apenas ausência explícita libera recuperação. Eventos existentes exigem conferência.
      if (!clientEventos?.get) return { ...evidencias, estado: 'INCONCLUSIVA', motivo: 'CONSULTA_EVENTOS_INDISPONIVEL' };
      let eventos;
      try {
        eventos = await clientEventos.get(`/NFSe/${chaveAcesso}/Eventos`, { ...options, timeout: 15000 });
      } catch (err) {
        // O contrato também documenta 404 com o mesmo envelope. 404 sem envelope não prova ausência.
        if (err?.response?.status === 404) eventos = err.response;
        else return { ...evidencias, estado: 'INCONCLUSIVA', motivo: 'CONSULTA_EVENTOS_NAO_CONFIRMADA' };
      }
      const lote = eventos?.data;
      const vazioExplicito = campo => Object.prototype.hasOwnProperty.call(lote || {}, campo)
        && (lote[campo] === null || (Array.isArray(lote[campo]) && lote[campo].length === 0));
      if (![200, 404].includes(eventos?.status) || !lote || typeof lote !== 'object'
        || String(lote.TipoAmbiente) !== String(ambiente)
        || lote.StatusProcessamento !== 'NENHUM_DOCUMENTO_LOCALIZADO'
        || !vazioExplicito('LoteDFe') || !vazioExplicito('Erros')
        || (lote.Alertas != null && (!Array.isArray(lote.Alertas) || lote.Alertas.length))) {
        return { ...evidencias, estado: 'INCONCLUSIVA', motivo: 'SITUACAO_EVENTOS_NAO_COMPROVADA' };
      }
      return { ...evidencias, estado: 'MESMA', motivo: 'DPS_FISCALMENTE_EQUIVALENTE', eventosConferidos: true };
    }
    const diferentes = campos.filter(([campo, a, b]) => campo === 'valor' ? (/^\d+(\.\d{1,2})?$/.test(a) && /^\d+(\.\d{1,2})?$/.test(b) && Number(a) !== Number(b)) : a !== b).map(([campo]) => campo);
    return { ...evidencias, estado: diferentes.length ? 'OUTRA' : 'INCONCLUSIVA', motivo: diferentes.length ? 'OPERACAO_DIVERGENTE' : 'DIFERENCA_FISCAL_NAO_RESOLVIDA', camposDivergentes: diferentes };
  } catch (err) {
    return { ...base, motivo: err?.response?.status === 404 ? 'DOCUMENTO_NAO_LOCALIZADO' : err?.message || 'CONSULTA_INCONCLUSIVA' };
  }
}
