import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const VERSAO_EXTRATOR_IBSCBS = '1.0.0';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false,
  parseAttributeValue: false, trimValues: true, removeNSPrefix: true, processEntities: false });
const lista = v => v == null ? [] : Array.isArray(v) ? v : [v];
const texto = v => typeof v === 'string' && v.trim() ? v.trim() : null;

// Valores são copiados do documento, nunca calculados nem tratados como crédito
// apropriável. Autorização/cancelamento continuam pertencendo ao ciclo da nota.
export function extrairIbscbsXml(xml, modeloEsperado) {
  const fonte = typeof xml === 'string' ? xml : '';
  const base = { versaoExtrator: VERSAO_EXTRATOR_IBSCBS, modelo: modeloEsperado ?? null,
    xmlSha256: fonte ? createHash('sha256').update(fonte).digest('hex') : null,
    situacao: 'XML_AUSENTE', declaracao: null, valores: null, itens: [], avisos: [] };
  if (!fonte.trim()) return base;
  try {
    if (/<!DOCTYPE|<!ENTITY/i.test(fonte) || XMLValidator.validate(fonte) !== true) return { ...base, situacao: 'XML_INVALIDO' };
    const doc = parser.parse(fonte);
    const nfse = doc.NFSe?.infNFSe;
    const nfe = (doc.nfeProc || doc.procNFe || doc)?.NFe?.infNFe;
    if ((modeloEsperado === 'NFSE' && !nfse) || (modeloEsperado === 'NFE' && !nfe) || (!nfse && !nfe)) return { ...base, situacao: 'DOCUMENTO_INCOMPATIVEL' };
    const avisos = [];
    const decimal = (v, campo) => {
      if (v === undefined || v === null || v === '') return null;
      if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v)) { avisos.push(`VALOR_INVALIDO:${campo}`); return null; }
      return v;
    };
    const jurisdicao = (g, total, prefixo) => ({
      aliquota: decimal(g?.[`p${prefixo}`], `p${prefixo}`),
      reducao: decimal(g?.gRed?.pRedAliq, `${prefixo}.pRedAliq`),
      aliquotaEfetiva: decimal(g?.gRed?.pAliqEfet, `${prefixo}.pAliqEfet`),
      valor: decimal(total, `v${prefixo}`),
    });
    if (nfse) {
      const d = nfse.DPS?.infDPS?.IBSCBS;
      const g = nfse.IBSCBS;
      const v = g?.valores;
      const tot = g?.totCIBS;
      const declaracao = d ? { finalidade: texto(nfse.DPS?.infDPS?.finNFSe ?? d.finNFSe),
        cIndOp: texto(d.cIndOp), indDest: texto(d.indDest),
        cst: texto(d.valores?.trib?.gIBSCBS?.CST), cClassTrib: texto(d.valores?.trib?.gIBSCBS?.cClassTrib),
        codigoNbs: texto(nfse.DPS?.infDPS?.serv?.cServ?.cNBS) } : null;
      return { ...base, modelo: 'NFSE', situacao: g ? 'VALORES_DOCUMENTO' : d ? 'SOMENTE_DECLARACAO' : 'GRUPO_AUSENTE', declaracao,
        valores: g ? { baseCalculo: decimal(v?.vBC, 'vBC'),
          ibsUf: { aliquota: decimal(v?.uf?.pIBSUF, 'pIBSUF'), reducao: decimal(v?.uf?.pRedAliqUF, 'pRedAliqUF'), aliquotaEfetiva: decimal(v?.uf?.pAliqEfetUF, 'pAliqEfetUF'), valor: decimal(tot?.gIBS?.gIBSUFTot?.vIBSUF, 'vIBSUF') },
          ibsMunicipio: { aliquota: decimal(v?.mun?.pIBSMun, 'pIBSMun'), reducao: decimal(v?.mun?.pRedAliqMun, 'pRedAliqMun'), aliquotaEfetiva: decimal(v?.mun?.pAliqEfetMun, 'pAliqEfetMun'), valor: decimal(tot?.gIBS?.gIBSMunTot?.vIBSMun, 'vIBSMun') },
          cbs: { aliquota: decimal(v?.fed?.pCBS, 'pCBS'), reducao: decimal(v?.fed?.pRedAliqCBS, 'pRedAliqCBS'), aliquotaEfetiva: decimal(v?.fed?.pAliqEfetCBS, 'pAliqEfetCBS'), valor: decimal(tot?.gCBS?.vCBS, 'vCBS') },
          ibsTotal: decimal(tot?.gIBS?.vIBSTot, 'vIBSTot'), totalNota: decimal(tot?.vTotNF, 'vTotNF') } : null,
        gruposOriginais: { declarados: d ?? null, documento: g ?? null }, avisos };
    }
    const tot = nfe.total?.IBSCBSTot;
    const itens = lista(nfe.det).map(det => {
      const trib = det.imposto?.IBSCBS;
      const g = trib?.gIBSCBS;
      return { numero: texto(det['@_nItem']), cst: texto(trib?.CST), cClassTrib: texto(trib?.cClassTrib),
        presente: trib != null, baseCalculo: decimal(g?.vBC, 'item.vBC'),
        ibsUf: jurisdicao(g?.gIBSUF, g?.gIBSUF?.vIBSUF, 'IBSUF'),
        ibsMunicipio: jurisdicao(g?.gIBSMun, g?.gIBSMun?.vIBSMun, 'IBSMun'),
        cbs: jurisdicao(g?.gCBS, g?.gCBS?.vCBS, 'CBS'), ibsTotal: decimal(g?.vIBS, 'item.vIBS'),
        gruposOriginais: trib ?? null };
    });
    return { ...base, modelo: 'NFE', situacao: tot || itens.some(i => i.presente) ? 'VALORES_DOCUMENTO' : 'GRUPO_AUSENTE',
      valores: tot ? { baseCalculo: decimal(tot.vBCIBSCBS, 'vBCIBSCBS'),
        ibsUf: { valor: decimal(tot.gIBS?.gIBSUF?.vIBSUF, 'vIBSUF') },
        ibsMunicipio: { valor: decimal(tot.gIBS?.gIBSMun?.vIBSMun, 'vIBSMun') },
        cbs: { valor: decimal(tot.gCBS?.vCBS, 'vCBS') }, ibsTotal: decimal(tot.gIBS?.vIBS, 'vIBS'),
        totalNota: decimal(nfe.total?.vNFTot, 'vNFTot') } : null,
      gruposOriginais: tot ?? null, itens, avisos };
  } catch { return { ...base, situacao: 'EXTRACAO_FALHOU' }; }
}
