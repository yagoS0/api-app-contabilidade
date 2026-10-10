import { lerEnvelopeXml, raizDoXml } from './lerEnvelopeXml.js';
import { lerNfse } from './danfse/danfseDados.js';
import { apresentarValor } from './danfse/danfseApresentacao.js';

// Só lê o documento recebido. Não calcula tributos nem reclassifica nota autorizada.
export function destaqueIbscbs(xmlArmazenado) {
  try {
    const { xml } = lerEnvelopeXml(xmlArmazenado);
    if (!xml || xml.length > 1_000_000 || raizDoXml(xml) !== 'NFSe') return { estado: 'XML_AUTORIZADO_INDISPONIVEL' };
    const { valores: v, meta } = lerNfse(xml);
    const estado = !meta.ibscbsRetornadoNaNfse
      ? (meta.ibscbsDeclaradoNaDps ? 'DECLARADO_SEM_VALORES_RETORNADOS' : 'NAO_INFORMADO')
      : v.totalIbsCbs == null ? 'VALORES_PARCIAIS' : 'VALORES_PRESENTES';
    return { estado, fonte: 'XML_NFSE', versaoCalculadora: meta.versaoCalculadoraIBSCBS,
      classificacao: v.cstCClassTrib, baseCalculo: v.bcAposExclusoes, aliquotasIbs: v.aliqIbs,
      aliquotaCbs: v.pCBS == null ? null : apresentarValor('pCBS', v.pCBS),
      aliquotaEfetivaCbs: v.pAliqEfetCBS == null ? null : apresentarValor('pAliqEfetCBS', v.pAliqEfetCBS),
      ibsMunicipal: v.vIBSMun, ibsEstadual: v.vIBSUF, ibsTotal: v.vIBSTot, cbs: v.vCBS,
      total: v.totalIbsCbs, valorTotalNota: v.vTotNF };
  } catch { return { estado: 'XML_AUTORIZADO_INDISPONIVEL' }; }
}
