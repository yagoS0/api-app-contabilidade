// Preparação OFFLINE do contrato de novembro/2026. Não importar no emissor.
// Não assina, reserva numeração, consulta banco ou transmite. O XSD futuro ainda é pendente.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';
import { diaFiscal } from '../regimeDaCompetencia.js';

import { NS, falhar, unico, somente, ordenar } from './xmlEstruturaOffline.js';

/** Primeira etapa NT009: reposicionamento estrutural de nota regular nacional.
 * Restrito a 2026 e CST 000/classe 000001, sem deduções ou operações especiais.
 * Contrato explícito: não depende da competência para ativar a produção.
 */
export function prepararDpsNovembro2026Offline({ xmlBase, contrato, indFinal }) {
  if (contrato !== 'NT009_V1_01_NOVEMBRO_2026') falhar('CONTRATO_INVALIDO', 'Selecione explicitamente o contrato de novembro de 2026.');
  if (typeof xmlBase !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xmlBase) || XMLValidator.validate(xmlBase) !== true) {
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
  somente(serv, ['locPrest', 'cServ']);
  const cServ = unico(serv, 'cServ');
  // Deduções e demais grupos alterados pela NT009 exigem uma adaptação própria.
  somente(unico(inf, 'valores'), ['vServPrest', 'vDescCondIncond', 'trib']);
  const ibs = unico(inf, 'IBSCBS');
  somente(ibs, ['finNFSe', 'cIndOp', 'indDest', 'dest', 'valores']);
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
  somente(grupo, ['CST', 'cClassTrib']);
  const cst = unico(grupo, 'CST');
  const classe = unico(grupo, 'cClassTrib');
  if (cst.textContent !== '000' || classe.textContent !== '000001') falhar('CENARIO_NAO_PREPARADO', 'Este cenário cobre apenas CST 000 / classe 000001; demais ocorrências de gIBSCBS dependem de adaptação específica.');
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
  trib.removeChild(grupo); // Não emitir grupo vazio: CST/classificação agora pertencem a trib.
  if (indFinal != null) {
    if (!['0', '1'].includes(indFinal)) falhar('IND_FINAL_INVALIDO', 'indFinal deve ser 0 ou 1, declarado explicitamente.');
    adicionar(ibs, 'indFinal', indFinal);
  }
  ordenar(ibs, ['indFinal', 'cIndOp', 'valores']);
  ordenar(inf, ['tpAmb', 'dhEmi', 'verAplic', 'serie', 'nDPS', 'dCompet', 'tpEmit', 'finNFSe', 'cLocEmi', 'prest', 'toma', 'indDest', 'dest', 'interm', 'serv', 'valores', 'IBSCBS']);
  return {
    xml: new XMLSerializer().serializeToString(doc),
    contrato, anexo: 'VI v1.04.01', producaoPrevista: '2026-11-03',
    somenteOffline: true, liberadoParaEmissao: false, validadoContraXsdFuturo: false,
    competencia,
    pendencias: ['XSD_OFICIAL_COMPATIVEL', 'REGRAS_COMPLETAS_E_AUTORIZADOR', 'ACEITE_EM_HOMOLOGACAO'],
  };
}
