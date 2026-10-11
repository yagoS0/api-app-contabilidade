import { conferirImoveisCondominios } from './imoveisNovembro2026.js';
import { conferirAjustesMunicipais } from './municipaisNovembro2026.js';
import { conferirComercioExterior } from './comercioExteriorNovembro2026.js';
// Preparação OFFLINE do contrato de novembro/2026. Não importar no emissor.
// Não assina, reserva numeração, consulta banco ou transmite. O XSD futuro ainda é pendente.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';
import { classificacaoNovembro, validarTributacaoNovembro, validarAjustesNovembro, validarEventoNovembro, validarEnderecosNovembro } from './regrasNovembro2026.js';
import { diaFiscal } from '../regimeDaCompetencia.js';

import { NS, falhar, unico, somente, ordenar } from './xmlEstruturaOffline.js';

/** Primeira etapa NT009: reposicionamento estrutural de nota regular nacional.
 * Restrito a 2026 e nota regular; regras locais não comprovam homologação.
 * Contrato explícito: não depende da competência para ativar a produção.
 */
export function prepararDpsNovembro2026Offline({ xmlBase, contrato, indFinal, contextoMunicipal, referenciaMoedas }) {
  if (contrato !== 'NT009_V1_01_NOVEMBRO_2026') falhar('CONTRATO_INVALIDO', 'Selecione explicitamente o contrato de novembro de 2026.');
  if (typeof xmlBase !== 'string' || xmlBase.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xmlBase) || XMLValidator.validate(xmlBase) !== true) {
    falhar('XML_BASE_INVALIDO', 'Informe XML bem formado, sem DTD ou entidades externas.');
  }
  const doc = new DOMParser().parseFromString(xmlBase, 'application/xml');
  const raiz = doc.documentElement;
  if (raiz.localName !== 'DPS' || raiz.namespaceURI !== NS || raiz.getAttribute('versao') !== '1.01') {
    falhar('XML_BASE_INVALIDO', 'Esperada uma DPS 1.01 nacional.');
  }
  for (const no of Array.from(doc.getElementsByTagName('*'))) {
    if (no.localName === 'Signature') falhar('XML_ASSINADO', 'Não adapte XML assinado. Use uma amostra local não assinada.');
    if (no.namespaceURI !== NS) falhar('XML_BASE_INVALIDO', 'Namespace inesperado.');
  }
  somente(raiz, ['infDPS']);
  const inf = unico(raiz, 'infDPS');
  if (unico(inf, 'tpAmb').textContent !== '2') falhar('PRODUCAO_PROIBIDA', 'O laboratório aceita somente tpAmb=2.');
  const competencia = unico(inf, 'dCompet').textContent;
  if (!diaFiscal(competencia) || !competencia.startsWith('2026-')) falhar('COMPETENCIA_INVALIDA', 'A preparação de novembro cobre apenas 2026. A emissão de 2027 permanece bloqueada.');
  const prest = unico(inf, 'prest');
  const reg = unico(prest, 'regTrib');
  somente(reg, ['opSimpNac', 'regApTribSN', 'regEspTrib']);
  const serv = unico(inf, 'serv');
  somente(serv, ['locPrest', 'cServ', 'comExt', 'atvEvento']);
  if (unico(inf, 'tpEmit').textContent !== '1') falhar('EMITENTE_NAO_SUPORTADO', 'Este preparador cobre a nota do prestador.');
  const cServ = unico(serv, 'cServ');
  // Deduções e demais grupos alterados pela NT009 exigem uma adaptação própria.
  somente(unico(inf, 'valores'), ['vServPrest', 'vDescCondIncond', 'vAjusteBC', 'trib']);
  const ibs = unico(inf, 'IBSCBS');
  somente(ibs, ['finNFSe', 'cIndOp', 'indDest', 'dest', 'imovel', 'condominios', 'valores']);
  const finalidade = unico(ibs, 'finNFSe');
  const indicador = unico(ibs, 'indDest');
  const dest = unico(ibs, 'dest', false);
  if (finalidade.textContent !== '0') falhar('CENARIO_NAO_PREPARADO', 'Notas de ajuste não são suportadas neste laboratório.');
  if (!['0', '1'].includes(indicador.textContent) || (indicador.textContent === '1') !== Boolean(dest)) {
    falhar('DESTINATARIO_INVALIDO', 'Confira indDest e o destinatário.');
  }
  somente(unico(ibs, 'valores'), ['trib']);
  const trib = unico(unico(ibs, 'valores'), 'trib');
  somente(trib, ['gIBSCBS']);
  const grupo = unico(trib, 'gIBSCBS');
  somente(grupo, ['CST', 'cClassTrib', 'cCredPres', 'gTribRegular', 'gDif']);
  const cst = unico(grupo, 'CST');
  const classe = unico(grupo, 'cClassTrib');
  const classificacao = classificacaoNovembro(cst.textContent, classe.textContent, competencia);
  const adicionar = (pai, nome, valor) => {
    const n = doc.createElementNS(NS, nome);
    n.appendChild(doc.createTextNode(valor));
    pai.appendChild(n);
  };
  ordenar(cServ, ['cTribNac', 'cTribMun', 'cNBS', 'cIntContrib', 'xDescServ']);
  inf.appendChild(finalidade);
  inf.appendChild(indicador);
  if (dest) inf.appendChild(dest);
  trib.appendChild(cst);
  trib.appendChild(classe);
  if (!classificacao.ind_gIBSCBS) {
    if (Array.from(grupo.childNodes).some(n => n.nodeType === 1)) falhar('E0961', 'Não informe tributação para esta classificação.');
    trib.removeChild(grupo);
  }
  ordenar(trib, ['CST', 'cClassTrib', 'gIBSCBS']);
  if (indFinal != null) {
    if (!['0', '1'].includes(indFinal)) falhar('IND_FINAL_INVALIDO', 'indFinal deve ser 0 ou 1, declarado explicitamente.');
    adicionar(ibs, 'indFinal', indFinal);
  }
  ordenar(ibs, ['indFinal', 'cIndOp', 'imovel', 'condominios', 'valores']);
  ordenar(inf, ['tpAmb', 'dhEmi', 'verAplic', 'serie', 'nDPS', 'dCompet', 'tpEmit', 'finNFSe', 'cLocEmi', 'prest', 'toma', 'indDest', 'dest', 'interm', 'serv', 'valores', 'IBSCBS']);
  const { operacao } = validarTributacaoNovembro(ibs, trib, competencia);
  const codigoServico = unico(cServ, 'cTribNac').textContent;
  validarAjustesNovembro(unico(inf, 'valores'), codigoServico, competencia);
  validarEventoNovembro(serv, codigoServico);
  const municipioIss1705 = validarEnderecosNovembro(inf, operacao, codigoServico);
  const municipal = conferirAjustesMunicipais({ inf, competencia, classificacao, contextoMunicipal, municipioIss1705 });
  const comercioExterior = conferirComercioExterior({ inf, competencia, referenciaMoedas });
  const imoveis = conferirImoveisCondominios(inf);
  return {
    municipal, comercioExterior, imoveis,
    municipioIss1705,
    xml: new XMLSerializer().serializeToString(doc),
    contrato, anexo: 'VI v1.04.01', producaoPrevista: '2026-11-03',
    somenteOffline: true, liberadoParaEmissao: false, validadoContraXsdFuturo: false,
    competencia,
    pendencias: [...new Set([...municipal.pendencias, ...comercioExterior.pendencias, ...imoveis.pendencias, 'XSD_OFICIAL_COMPATIVEL', 'CADASTROS_RFB_CEP_POR_COMPETENCIA', 'PARAMETROS_MUNICIPAIS_E_BASES', 'CALCULADORA_POR_COMPETENCIA', 'REGRAS_COMPLETAS_E_AUTORIZADOR', 'ACEITE_EM_HOMOLOGACAO'])],
  };
}
