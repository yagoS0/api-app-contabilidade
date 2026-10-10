import { incidenciaMunicipal } from './incidenciaMunicipal.js';
import { resolverOpSimpNac } from './dpsCodigos.js';
import { obrigacaoIbscbs } from './obrigacaoIbscbs.js';
import { ibscbsDaDps, nbsDaDps } from './ibscbsDaDps.js';
import { localDaPrestacao } from './localDaPrestacao.js';
import { tributacaoMunicipalDoPerfil } from './tributacaoMunicipalDoPerfil.js';

// Núcleo das correções prioritárias; recebe somente dados já autorizados/carregados.
// As demais validações de ISS, retenção, certificado e payload continuam nos módulos existentes.
export function resolverContextoFiscalDaNota({ company, perfil, regime, competencia, codigoServico, servico, ibscbsLigado }) {
  const falha = (codigo, message, correcao = message) => ({ ok: false, codigo, message, correcao });
  let local;
  try {
    local = localDaPrestacao({ servico, perfil, municipioEmissor: company?.codigoMunicipioIbge });
    tributacaoMunicipalDoPerfil(perfil);
  } catch (err) { return falha(err.code, err.message); }
  if (company?.beneficioMunicipalNumero) return falha('NFSE_BENEFICIO_MUNICIPAL_PENDENTE',
    'Há benefício municipal cadastrado cuja aplicação nesta operação precisa ser conferida. O emissor ainda não envia o grupo de benefício.',
    'O escritório deve conferir a concessão e a operação. Se o benefício for aplicável, utilize o Emissor Nacional até a integração estar disponível; não apague o cadastro apenas para prosseguir.');
  const incidencia = incidenciaMunicipal({ codigoServico, servico, perfil, local, company, competencia });
  if (!incidencia.ok) return incidencia;
  const obrigacao = obrigacaoIbscbs({ competencia, opSimpNac: resolverOpSimpNac(regime).opSimpNac,
    codigoServico, categoria: perfil?.categoriaObrigacaoIbscbs });
  const nbs = nbsDaDps(perfil);
  if (!nbs.ok) return nbs;
  const ibscbs = ibscbsDaDps({ perfil, ligado: ibscbsLigado, cNBS: nbs.cNBS, competencia, obrigacao });
  if (!ibscbs.ok) return { ...ibscbs, obrigacao };
  return { ok: true, local, incidencia, obrigacao, nbs, ibscbs };
}
