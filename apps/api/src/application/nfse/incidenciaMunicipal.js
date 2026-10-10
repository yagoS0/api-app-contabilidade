// LC 116 art. 3º, II–XXII; LC 218/2025 (14.14). Não escreve cLocIncid na DPS:
// esse campo é apurado pela Sefin. Esta etapa exige os fatos das exceções suportadas.
// Fontes/limites em docs/nfse-historico-regras-municipais-2026-10-10.md.
import { diaFiscal } from './regimeDaCompetencia.js';
const LOCAIS = new Set(['0305','0702','0719','1414','0704','0705','0709','0710','0711','0712','0716','0717','0718','1101','1104','1710']);
const REVISAO = new Set(['0304','2201','1102','1705','0422','0423','0509','1501','1509']);
export function incidenciaMunicipal({ codigoServico, servico, perfil, local, company, competencia }) {
  const codigo = String(codigoServico || '');
  const subitem = codigo.slice(0, 4);
  const versao = 'lc116-lc218-triagem-2026-10-10';
  const pendencia = message => ({ ok: false, codigo: 'NFSE_INCIDENCIA_MUNICIPAL_PENDENTE', message,
    correcao: 'O escritório deve conferir o serviço e o local legalmente relevante. Use o canal oficial para hipóteses ainda não representadas no sistema.' });
  if (String(perfil?.tribISSQN || '1') !== '1') return { ok: true, versao, estado: 'TRIBUTACAO_ESPECIAL', municipio: null };
  const dia = diaFiscal(typeof competencia === 'string' && competencia.length === 7 ? `${competencia}-01` : competencia);
  if (dia && (dia < '2018-01-01' || (subitem === '1414' && dia < '2025-09-25'))) return pendencia('A competência exige revisão da legislação de localização do ISS vigente naquele período.');
  if (REVISAO.has(subitem)) return pendencia('Este serviço depende de contexto municipal específico ainda não representado: múltiplos municípios, local dos bens/tomador ou tratamento jurisprudencial.');
  const exigeLocal = LOCAIS.has(subitem) || codigo.startsWith('16') || codigo.startsWith('20') || (codigo.startsWith('12') && subitem !== '1213');
  if (exigeLocal && (!servico?.cLocPrestacao || local?.fonte !== 'OPERACAO')) return pendencia('Este serviço é exceção à regra geral do ISS. Informe na operação o município da obra, execução, evento ou bem, conforme o serviço; o padrão do perfil não confirma esse fato.');
  return { ok: true, versao, estado: exigeLocal ? 'EXCECAO_LOCAL_INFORMADO' : 'REGRA_GERAL_A_CONFERIR',
    municipio: exigeLocal ? local.codigo : company?.codigoMunicipioIbge || null,
    fonte: exigeLocal ? 'OPERACAO' : 'ESTABELECIMENTO_PRESTADOR',
    // Não atesta inexistência das hipóteses transversais dos §§ 3º/4º ou estabelecimento diverso.
    validacaoMunicipalCompleta: false };
}
