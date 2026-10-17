import { linhasDaPreviaFiscal } from "./PreviaFiscal.shared.js";
import { AvisoPeriodo } from "@contabilidade/shared/aviso-periodo";






export function PreviaFiscal({ previa, companyId, destaque = false }) {
  if (!previa.habilitada) return null;
  return <section className="emissor-previa" aria-labelledby="titulo-previa-fiscal" style={{ margin: '16px 0', overflowWrap: 'anywhere' }}>
    <h3 id="titulo-previa-fiscal">Prévia fiscal por competência</h3>
    {previa.carregando && <p role="status">Conferindo histórico e regras da operação…</p>}
    {previa.erro && <p role="alert">{previa.erro}</p>}
    {previa.erro && <button type="button" onClick={previa.tentar}>Atualizar prévia fiscal</button>}
    {!previa.carregando && !previa.erro && <AvisoPeriodo periodo={previa.dados?.periodo} />}
    {previa.dados && <details open={destaque || undefined}>
      <summary>{previa.dados.competencia} · {previa.dados.regimeVigente?.regime || 'Regime pendente'} · {previa.dados.ok ? 'Ver contexto fiscal' : 'Há pendências'}</summary>
      <ul>{linhasDaPreviaFiscal(previa.dados).map(l => <li key={l}>{l}</li>)}</ul>
    </details>}
    {previa.dados?.pendencias.map(p => <p role="alert" key={p.codigo}>{p.mensagem} {p.correcao}</p>)}
    {previa.bloqueada && !previa.carregando && <p>Confira o histórico no <a href={`/companies/${encodeURIComponent(companyId)}/edit`} target="_blank" rel="noreferrer">cadastro da empresa</a> e os parâmetros em <a href={`/companies/${encodeURIComponent(companyId)}/emissao-nfse`} target="_blank" rel="noreferrer">configurações de emissão</a>. <button type="button" onClick={previa.tentar}>Rever prévia após correção</button></p>}
    <small>A prévia confere o contexto fiscal. A emissão revalida os dados completos; os valores definitivos de IBS/CBS vêm do XML autorizado.</small>
  </section>;
}
