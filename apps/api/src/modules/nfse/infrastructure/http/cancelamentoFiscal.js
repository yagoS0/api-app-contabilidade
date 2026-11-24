import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { createHash, X509Certificate } from 'node:crypto';
import { decodificarRespostaSefinCancelamento } from './decodificarRespostaSefinCancelamento.js';
import { decodificarRespostaAdnCancelamento } from './decodificarRespostaAdnCancelamento.js';

const NS = 'http://www.sped.fazenda.gov.br/nfse';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const elementos = (node) => Array.from(node.childNodes || []).filter((n) => n.nodeType === 1);
function unico(node, nome, ns = NS) {
  const encontrados = elementos(node).filter((n) => n.localName === nome && n.namespaceURI === ns);
  if (encontrados.length !== 1) throw new Error('estrutura_evento_invalida');
  return encontrados[0];
}
const texto = (node, nome) => unico(node, nome).textContent.trim();

// Somente o adaptador interno produz este recibo opaco. Um corpo ou booleano
// fornecido pelo chamador não comprova transporte oficial. Não é validação de PKI.
const respostasOficiais = new WeakMap();
const opcoesTransporte = () => ({ proxy: false, timeout: 15000, maxRedirects: 0,
  maxContentLength: 12_000_000, headers: { Accept: 'application/json' } });

function contextoDoTransporte(contexto) {
  const snapshot = { companyId: String(contexto?.companyId || ''), cnpj: String(contexto?.cnpj || '').replace(/\D/g, ''), chaveAcesso: String(contexto?.chaveAcesso || ''), ambiente: contexto?.ambiente };
  if (!snapshot.companyId || !/^\d{14}$/.test(snapshot.cnpj) || !/^\d{50}$/.test(snapshot.chaveAcesso) || !['producao', 'homologacao'].includes(snapshot.ambiente)) throw new Error('NFSE_CONTEXTO_TRANSPORTE_INVALIDO');
  return Object.freeze(snapshot);
}
function destinoOficial(destino, contexto, operacao) {
  const url = new URL(destino);
  const producao = contexto.ambiente === 'producao';
  const host = operacao !== 'CONSULTAR' ? (producao ? 'sefin.nfse.gov.br' : 'sefin.producaorestrita.nfse.gov.br') : (producao ? 'adn.nfse.gov.br' : 'adn.producaorestrita.nfse.gov.br');
  const pathValido = operacao === 'SOLICITAR'
    ? [`/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`, `/API/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`].includes(url.pathname)
    : operacao === 'CONSULTAR_INDIVIDUAL'
      ? new RegExp(`^/(?:API/)?SefinNacional/nfse/${contexto.chaveAcesso}/eventos/(101101|101103|105104|105105)/1$`).test(url.pathname)
      : url.pathname === `/contribuintes/NFSe/${contexto.chaveAcesso}/Eventos`;
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash || !pathValido) throw new Error('NFSE_DESTINO_CANCELAMENTO_INVALIDO');
  return url.href;
}
export function criarTransporteCancelamento({ client, caminho, requestBody, contexto }) {
  const identidade = contextoDoTransporte(contexto);
  if (caminho !== `/nfse/${identidade.chaveAcesso}/eventos`) throw new Error('NFSE_DESTINO_CANCELAMENTO_INVALIDO');
  const envio = destinoOficial(`${String(client.defaults?.baseURL || '').replace(/\/+$/, '')}${caminho}`, identidade, 'SOLICITAR');
  const consulta = destinoOficial(`https://${identidade.ambiente === 'producao' ? 'adn.nfse.gov.br' : 'adn.producaorestrita.nfse.gov.br'}/contribuintes/NFSe/${identidade.chaveAcesso}/Eventos`, identidade, 'CONSULTAR');
  const receber = (resposta, operacao, destino) => {
    const recibo = Object.freeze({});
    // Congela o conteúdo observado; mutação posterior do objeto Axios não altera o recibo.
    const corpo = typeof resposta.data === 'string' ? resposta.data : JSON.parse(JSON.stringify(resposta.data ?? null));
    respostasOficiais.set(recibo, Object.freeze({ corpo, status: resposta.status, contexto: identidade, operacao, destino }));
    return recibo;
  };
  const consultarOficial = async (destino, operacao) => {
    try { return receber(await client.get(destino, opcoesTransporte()), operacao, destino); }
    catch (erro) {
      // Rejeições HTTP recebidas do mesmo despacho podem explicar ausência/restrição.
      // Timeout/TLS/redirecionamento continuam erros, sem recibo de sucesso fabricado.
      if ((operacao === 'CONSULTAR' ? [400, 404] : [401, 404, 422]).includes(erro.response?.status)) return receber(erro.response, operacao, destino);
      throw erro;
    }
  };
  return {
    enviar: async () => receber(await client.post(envio, requestBody, opcoesTransporte()), 'SOLICITAR', envio),
    consultar: async () => consultarOficial(consulta, 'CONSULTAR'),
    consultarIndividual: async (tipoEvento, sequencia = 1) => {
      const destino = destinoOficial(`${envio}/${tipoEvento}/${sequencia}`, identidade, 'CONSULTAR_INDIVIDUAL');
      return consultarOficial(destino, 'CONSULTAR_INDIVIDUAL');
    },
  };
}

export function verificarRespostaCancelamento(resposta, contexto) {
  if (!resposta || !respostasOficiais.has(resposta)) return null;
  try {
    const recibo = respostasOficiais.get(resposta);
    const esperado = contextoDoTransporte(contexto);
    if (Object.keys(esperado).some(campo => esperado[campo] !== recibo.contexto[campo]) || !['SOLICITAR', 'CONSULTAR', 'CONSULTAR_INDIVIDUAL'].includes(recibo.operacao)) return null;
    destinoOficial(recibo.destino, recibo.contexto, recibo.operacao);
    const statusEsperado = recibo.operacao === 'SOLICITAR' ? 201 : 200;
    // Somente envelopes documentados; XML avulso não substitui o contrato JSON.
    if (!recibo.corpo || typeof recibo.corpo !== 'object' || Array.isArray(recibo.corpo)) return null;
    if (recibo.operacao !== 'CONSULTAR' && recibo.status !== statusEsperado) return null;
    const decodificado = recibo.operacao === 'CONSULTAR'
      ? decodificarRespostaAdnCancelamento(recibo.corpo, esperado, recibo.status)
      : { documentos: [decodificarRespostaSefinCancelamento(recibo.corpo, esperado)], problemas: [], completa: true };
    const evidencias = [], problemas = [...decodificado.problemas];
    for (const documento of decodificado.documentos) {
      const evidencia = verificarXmlEventoOficial(documento.xml, esperado);
      const individual = recibo.operacao === 'CONSULTAR_INDIVIDUAL' ? new URL(recibo.destino).pathname.split('/').slice(-2) : null;
      if (!evidencia || (documento.tipoEvento && documento.tipoEvento !== evidencia.tipoEvento)
        || (individual && (individual[0] !== evidencia.tipoEvento || Number(individual[1]) !== Number(evidencia.sequencia)))) {
        problemas.push('XML_OU_METADATA_INCOMPATIVEL');
        continue;
      }
      evidencias.push({ ...evidencia, origemVerificada: true });
    }
    return { evidencias, problemas, completa: decodificado.completa && problemas.length === 0 };
  } catch { return null; }
}


// Certificado embutido comprova apenas integridade, nunca procedência oficial.
// Decoders extraem conteúdo; somente este verificador atesta sua integridade/contexto.
export function verificarXmlEventoOficial(corpo, contexto) {
  try {
    if (typeof corpo !== 'string' || corpo.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(corpo)) return null;
    let erroParse = false;
    const doc = new DOMParser({ errorHandler: { warning() { erroParse = true; }, error() { erroParse = true; }, fatalError() { erroParse = true; } } }).parseFromString(corpo, 'application/xml');
    const raiz = doc.documentElement;
    if (erroParse || raiz.localName !== 'evento' || raiz.namespaceURI !== NS) return null;
    const info = unico(raiz, 'infEvento');
    const assinatura = unico(raiz, 'Signature', DS);
    const ids = new Set();
    for (const elemento of Array.from(doc.getElementsByTagName('*'))) {
      for (const atributo of Array.from(elemento.attributes || [])) {
        if (atributo.localName.toLowerCase() === 'id') {
          if (ids.has(atributo.value)) return null;
          ids.add(atributo.value);
        }
      }
    }
    if (doc.getElementsByTagNameNS(NS, 'infEvento').length !== 1) return null;
    const signedInfo = unico(assinatura, 'SignedInfo', DS);
    const referencias = elementos(signedInfo).filter((n) => n.localName === 'Reference' && n.namespaceURI === DS);
    if (referencias.length !== 1 || referencias[0].getAttribute('URI') !== `#${info.getAttribute('Id')}`) return null;
    const transforms = unico(referencias[0], 'Transforms', DS);
    const permitidos = new Set(['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315']);
    if (elementos(transforms).some((n) => !permitidos.has(n.getAttribute('Algorithm')))) return null;
    const certificados = assinatura.getElementsByTagNameNS(DS, 'X509Certificate');
    if (certificados.length !== 1) return null;
    const pem = `-----BEGIN CERTIFICATE-----\n${certificados[0].textContent.replace(/\s/g, '')}\n-----END CERTIFICATE-----`;
    const certificado = new X509Certificate(pem);
    const verificador = new SignedXml();
    verificador.keyInfoProvider = { getKey: () => certificado.publicKey.export({ type: 'spki', format: 'pem' }) };
    verificador.loadSignature(assinatura);
    if (!verificador.checkSignature(corpo)) return null;
    const pedido = unico(unico(info, 'pedRegEvento'), 'infPedReg');
    if (!texto(pedido, 'verAplic') || !Number.isFinite(Date.parse(texto(pedido, 'dhEvento')))) return null;
    const tipos = elementos(pedido).filter((n) => /^e\d{6}$/.test(n.localName) && n.namespaceURI === NS);
    if (tipos.length !== 1) return null;
    const tipoEvento = tipos[0].localName.slice(1);
    const descricoes = { '101101': 'Cancelamento de NFS-e', '101103': 'Solicitação de Análise Fiscal para Cancelamento de NFS-e', '105104': 'Cancelamento de NFS-e Deferido por Análise Fiscal', '105105': 'Cancelamento de NFS-e Indeferido por Análise Fiscal' };
    if (raiz.getAttribute('versao') !== '1.01' || unico(info, 'pedRegEvento').getAttribute('versao') !== '1.01') return null;
    if (!['1', '2', '3'].includes(texto(info, 'ambGer')) || !texto(info, 'verAplic') || !/^\d{1,13}$/.test(texto(info, 'nDFSe')) || !Number.isFinite(Date.parse(texto(info, 'dhProc')))) return null;
    const evento = tipos[0];
    if (texto(evento, 'xDesc') !== descricoes[tipoEvento]) return null;
    const motivos = tipoEvento === '105104' ? ['1'] : tipoEvento === '105105' ? ['1', '2'] : ['1', '2', '9'];
    if (!motivos.includes(texto(evento, 'cMotivo'))) return null;
    const motivo = texto(evento, 'xMotivo');
    if (motivo.length < 15 || motivo.length > 255) return null;
    if (['105104', '105105'].includes(tipoEvento) && !/^\d{11}$/.test(texto(evento, 'CPFAgTrib'))) return null;
    const autores = elementos(pedido).filter(n => ['CNPJAutor', 'CPFAutor'].includes(n.localName));
    if (autores.length !== 1 || autores[0].namespaceURI !== NS || !(autores[0].localName === 'CNPJAutor' ? /^\d{14}$/ : /^\d{11}$/).test(autores[0].textContent.trim())) return null;
    const processos = elementos(evento).filter(n => n.localName === 'nProcAdm');
    if (processos.length > 1 || processos.some(n => n.namespaceURI !== NS || !/^\d{1,30}$/.test(n.textContent.trim()))) return null;
    if (Number(texto(info, 'nSeqEvento')) !== 1) return null;
    const chaveAcesso = texto(pedido, 'chNFSe');
    const tpAmb = texto(pedido, 'tpAmb');
    const ambiente = tpAmb === '1' ? 'producao' : tpAmb === '2' ? 'homologacao' : null;
    if (chaveAcesso !== contexto.chaveAcesso || ambiente !== contexto.ambiente) return null;
    if (info.getAttribute('Id') !== `EVT${chaveAcesso}${tipoEvento}001` || pedido.getAttribute('Id') !== `PRE${chaveAcesso}${tipoEvento}`) return null;
    if (tipoEvento === '101101' || tipoEvento === '101103') {
      if (texto(pedido, 'CNPJAutor') !== String(contexto.cnpj).replace(/\D/g, '')) return null;
    }
    return { companyId: contexto.companyId, chaveAcesso, ambiente, tipoEvento, sequencia: texto(info, 'nSeqEvento'), id: info.getAttribute('Id'), pedidoId: pedido.getAttribute('Id'), integridadeVerificada: true, origemVerificada: false, hash: createHash('sha256').update(corpo).digest('hex'), xml: corpo };
  } catch { return null; }
}
