// Preparação OFFLINE da NT009 v1.01 / Anexo VI v1.04.01. Não importar no emissor.
// Não assina, reserva numeração, consulta banco ou transmite. O XSD futuro ainda é pendente.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';
import { regimeDaCompetencia, diaFiscal } from '../regimeDaCompetencia.js';
import { apuracaoIbsCbsDaCompetencia } from '../apuracaoIbsCbsDaCompetencia.js';
import { erroAtividadeSimples } from '@contabilidade/shared/atividades-simples';

import { NS, falhar, unico, somente, ordenar } from './xmlEstruturaOffline.js';

export function validarAtividadeSimples({ cAtvSN, cTribNac }) {
  const motivo = erroAtividadeSimples(cAtvSN, cTribNac);
  if (motivo) falhar('ATIVIDADE_SIMPLES_INVALIDA', motivo);
}

/** Converte uma DPS de laboratório não assinada do contrato de julho para a estrutura proposta.
 * Escopo deliberado: ME/EPP, ano 2027, nota regular, CST 000 / classe 000001, sem operações especiais.
 * A competência já deve estar no XML; nenhuma data, alíquota ou enquadramento é inventado.
 */
export function prepararDpsSimples2027Offline({ xmlBase, company, perfil, indFinal }) {
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
  if (!diaFiscal(competencia) || !competencia.startsWith('2027-')) falhar('COMPETENCIA_INVALIDA', 'Este laboratório cobre somente competências válidas de 2027.');
  const vigente = regimeDaCompetencia({ historico: company?.regimeHistorico, competencia });
  if (!vigente.ok) falhar(vigente.codigo, vigente.message);
  if (vigente.regime !== 'SIMPLES') falhar('REGIME_NAO_SUPORTADO', 'O período deve ser Simples ME/EPP.');
  const opcao = apuracaoIbsCbsDaCompetencia({ company, competencia, regime: vigente.regime });
  if (!opcao.ok) falhar(opcao.codigo, opcao.message);
  const prest = unico(inf, 'prest');
  if (!company?.cnpj || unico(prest, 'CNPJ').textContent !== company.cnpj.replace(/\D/g, '')) {
    falhar('EMPRESA_DIVERGENTE', 'O histórico deve pertencer ao prestador do XML.');
  }
  const reg = unico(prest, 'regTrib');
  somente(reg, ['opSimpNac', 'regApTribSN', 'regEspTrib']);
  if (unico(reg, 'opSimpNac').textContent !== '3' || !['1', '2', '3'].includes(unico(reg, 'regApTribSN').textContent)) {
    falhar('REGIME_NAO_SUPORTADO', 'Esperado optante ME/EPP com regime do ISS declarado.');
  }
  const serv = unico(inf, 'serv');
  somente(serv, ['locPrest', 'cServ']);
  const cServ = unico(serv, 'cServ');
  if (!perfil || perfil.ativo === false || perfil.codigoServicoNacional !== unico(cServ, 'cTribNac').textContent) {
    falhar('PERFIL_INVALIDO', 'Selecione um perfil ativo correspondente ao serviço do XML.');
  }
  if (company.portalClientId && perfil.portalClientId !== company.portalClientId) {
    falhar('PERFIL_EMPRESA_DIVERGENTE', 'O perfil não pertence à empresa informada.');
  }
  const cAtvSN = perfil.cAtvSN;
  validarAtividadeSimples({ cAtvSN, cTribNac: unico(cServ, 'cTribNac').textContent });
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
  adicionar(reg, 'regApIBSCBSSN', opcao.regApIBSCBSSN);
  ordenar(reg, ['opSimpNac', 'regApTribSN', 'regApIBSCBSSN', 'regEspTrib']);
  adicionar(cServ, 'cAtvSN', cAtvSN);
  ordenar(cServ, ['cTribNac', 'cTribMun', 'cNBS', 'cAtvSN', 'cIntContrib', 'xDescServ']);
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
    contrato: 'preparacao-nt009-v1.01-anexoVI-v1.04.01',
    somenteOffline: true, liberadoParaEmissao: false, validadoContraXsdFuturo: false,
    competencia, apuracao: opcao.apuracao, vigenciaInicio: opcao.vigenciaInicio,
    atividadeSimples: { codigo: cAtvSN, fonte: 'PERFIL', perfilId: perfil.id || null },
    pendencias: ['XSD_OFICIAL_COMPATIVEL', 'REGRAS_COMPLETAS_E_AUTORIZADOR', 'ACEITE_EM_HOMOLOGACAO'],
  };
}
