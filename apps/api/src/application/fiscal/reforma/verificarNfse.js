import { DOMParser } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';
import { periodoNaData, diaValido } from '@contabilidade/shared/reforma-cadastro';
import { obrigacaoIbscbs, VERSAO_OBRIGACAO_IBSCBS } from '../../nfse/obrigacaoIbscbs.js';
import { ibscbsDaDps, nbsDaDps } from '../../nfse/ibscbsDaDps.js';
import { resolverOpSimpNac } from '../../nfse/dpsCodigos.js';

export const VERSAO_VERIFICADOR = `nfse-conferencia-v1-2026-10-10:${VERSAO_OBRIGACAO_IBSCBS}`;
export const ESCOPO_VERIFICADOR = 'XML nacional: integridade, competência, regime declarado e códigos IBS/CBS/NBS. Não certifica assinatura, autorização, cálculo integral dos tributos, benefícios ou direito a crédito. Notas municipais de outros leiautes exigem revisão.';
function filho(no, nome) {
  return Array.from(no?.childNodes || []).find(n => n.nodeType === 1 && (n.localName || n.nodeName) === nome) || null;
}
function caminho(no, path) { return path.split('/').reduce((n, part) => filho(n, part), no); }
function valor(no, path) { return caminho(no, path)?.textContent?.trim() || null; }
const documento = v => String(v || '').replace(/\D/g, '');

// Somente leitura: o resultado nunca altera XML, situação da nota, apuração ou emissão.
export function verificarNfse(nota, { cadastro, cnpj, configuracaoFiscal } = {}) {
  const achados = [];
  const add = (nivel, codigo, mensagem, providencia, campo = null) => achados.push({ nivel, codigo, mensagem, providencia, campo });
  const terminar = () => ({ id: nota.id, numero: nota.numero || null, papel: nota.papel || null,
    status: achados.some(a => a.nivel === 'ERRO') ? 'ERRO' : achados.some(a => a.nivel === 'REVISAO') ? 'REVISAO' : achados.some(a => a.nivel === 'ALERTA') ? 'ALERTA' : 'SEM_ACHADOS', achados });
  if (nota.statusEfetivo === 'cancelada' || ['CANCELADA', 'SUBSTITUIDA', 'REJEITADA'].includes(nota.status)) return { ...terminar(), status: 'EXCLUIDA', motivo: 'Documento cancelado, substituído ou rejeitado na base; fora da conferência de notas ativas.' };
  if (nota.statusEfetivo !== 'autorizada') add('REVISAO', 'SITUACAO_NAO_CONFIRMADA', 'A base não confirma a situação autorizada deste documento.', 'Confira o ciclo fiscal da nota.');
  const xml = nota.xmlRaw;
  if (!xml?.trim()) { add('REVISAO', 'XML_AUSENTE', 'XML não disponível.', 'Importe o XML completo na aba Notas.'); return terminar(); }
  if (Buffer.byteLength(xml, 'utf8') > 2 * 1024 * 1024) { add('REVISAO', 'XML_LIMITE', 'XML acima do limite de 2 MB desta conferência.', 'Confira o documento individualmente.'); return terminar(); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) { add('ERRO', 'XML_INVALIDO', 'O arquivo não é um XML íntegro aceito pelo verificador.', 'Confira a origem e importe novamente o documento.'); return terminar(); }
  let doc;
  try { doc = new DOMParser().parseFromString(xml, 'text/xml'); } catch { add('ERRO', 'XML_INVALIDO', 'Não foi possível ler o XML.', 'Confira o arquivo original.'); return terminar(); }
  const raiz = doc.documentElement;
  const inf = raiz?.localName === 'NFSe' ? filho(raiz, 'infNFSe') : null;
  const dps = caminho(inf, 'DPS/infDPS');
  if (!inf || !dps) { add('REVISAO', 'LEIAUTE_NAO_COBERTO', 'Este arquivo não contém a estrutura nacional NFSe/infNFSe/DPS/infDPS.', 'Confira o leiaute municipal ou importe a NFS-e nacional completa.'); return terminar(); }
  if (raiz.getAttribute('versao') !== '1.01' || raiz.namespaceURI !== 'http://www.sped.fazenda.gov.br/nfse') {
    add('REVISAO', 'VERSAO_NAO_COBERTA', 'Versão ou namespace do XML fora do contrato nacional 1.01 coberto.', 'Confira o leiaute oficial antes de aplicar as regras desta versão.');
    return terminar();
  }
  const competencia = valor(dps, 'dCompet');
  if (!diaValido(competencia)) add('REVISAO', 'COMPETENCIA_AUSENTE', 'Competência válida não encontrada no XML.', 'Confira dCompet na origem; não use a data de emissão como substituta.', 'DPS/infDPS/dCompet');
  const compBase = nota.competencia instanceof Date ? nota.competencia.toISOString().slice(0, 10) : String(nota.competencia || '').slice(0, 10);
  if (!compBase || (competencia && compBase.slice(0, 7) !== competencia.slice(0, 7))) add('REVISAO', 'COMPETENCIA_BASE', 'Competência do XML e competência disponível na base precisam de conferência.', 'Confira a origem e reimporte a nota.');
  const emitente = valor(dps, 'prest/CNPJ') || valor(dps, 'prest/CPF');
  const opSimpNac = valor(dps, 'prest/regTrib/opSimpNac');
  const codigoServico = valor(dps, 'serv/cServ/cTribNac');
  const periodo = periodoNaData(cadastro, competencia);
  const emitida = nota.papel === 'EMIT' && documento(emitente) === documento(cnpj) && Boolean(documento(cnpj));
  if (nota.papel === 'EMIT' && !emitida) add('REVISAO', 'EMITENTE_DIVERGENTE', 'O emitente do XML não corresponde ao CNPJ desta empresa.', 'Confira a titularidade do documento.');
  if (!['EMIT', 'DEST'].includes(nota.papel)) add('REVISAO', 'PAPEL_AUSENTE', 'O papel da empresa neste documento não está confirmado.', 'Confira emitente e tomador na origem.');
  let regimeDivergente = false;
  if (emitida) {
    if (!periodo || periodo.situacao !== 'CONFIRMADA') add('REVISAO', 'HISTORICO_PENDENTE', 'Não há enquadramento confirmado para a competência da nota.', 'Complete a vigência e a evidência no Perfil fiscal.');
    else {
      const esperado = resolverOpSimpNac(periodo.regime).opSimpNac;
      if (esperado && esperado !== opSimpNac) {
        regimeDivergente = true;
        add('ERRO', 'REGIME_DIVERGENTE', 'O regime declarado no XML diverge do histórico confirmado.', 'Confira a vigência e o documento antes de corrigir a origem.', 'DPS/infDPS/prest/regTrib/opSimpNac');
      }
    }
  }
  // Somente o snapshot da própria emissão pode completar a categoria. O perfil atual não
  // reescreve a classificação das notas antigas, e o cadastro do tomador não rege recebidas.
  const categoria = emitida ? configuracaoFiscal?.categoriaObrigacaoIbscbs || null : null;
  const obrigacao = obrigacaoIbscbs({ competencia, opSimpNac, codigoServico, categoria });
  if (regimeDivergente) add('REVISAO', 'OBRIGACAO_EM_REVISAO', 'A obrigatoriedade depende da resolução da divergência de regime.', 'Confira o enquadramento histórico.');
  else if (obrigacao.estado === 'INDETERMINADO') add('REVISAO', 'OBRIGACAO_INDETERMINADA', obrigacao.motivo, 'Confira o enquadramento da operação e a regra vigente.');
  const bloco = caminho(dps, 'IBSCBS');
  const perfil = { codigoNbs: valor(dps, 'serv/cServ/cNBS'), ibscbsCIndOp: valor(bloco, 'cIndOp'),
    ibscbsCst: valor(bloco, 'valores/trib/gIBSCBS/CST'), ibscbsCClassTrib: valor(bloco, 'valores/trib/gIBSCBS/cClassTrib') };
  const nbs = nbsDaDps(perfil);
  if (!nbs.ok) add('ERRO', nbs.codigo, nbs.message, nbs.correcao, 'DPS/infDPS/serv/cServ/cNBS');
  if (bloco && !perfil.ibscbsCIndOp && !perfil.ibscbsCst && !perfil.ibscbsCClassTrib) add('ERRO', 'IBSCBS_VAZIO', 'O grupo IBS/CBS está presente sem os códigos obrigatórios.', 'Confira o preenchimento do grupo IBS/CBS.');
  // Indeterminação fiscal não impede conferir a estrutura de um bloco já presente.
  const cheque = ibscbsDaDps({ perfil, ligado: true, cNBS: nbs.cNBS, competencia,
    obrigacao: obrigacao.estado === 'INDETERMINADO' || regimeDivergente ? { estado: 'FACULTATIVO' } : obrigacao });
  if (!cheque.ok) add('ERRO', cheque.codigo, cheque.message, cheque.correcao, 'DPS/infDPS/IBSCBS');
  if (!codigoServico) add('ERRO', 'SERVICO_AUSENTE', 'Código de tributação nacional ausente.', 'Confira o código do serviço no XML.', 'DPS/infDPS/serv/cServ/cTribNac');
  return terminar();
}
