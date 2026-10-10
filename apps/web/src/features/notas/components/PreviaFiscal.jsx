import { CAMPOS_PERFIL_EMISSAO, textoDoValor } from '../../../lib/nfse/perfilEmissao';

export function linhasDaPreviaFiscal(dados) {
  if (!dados) return [];
  const c = dados.contextoFiscal;
  const r = dados.regimeVigente;
  return [
    `Ambiente: ${dados.demonstracao ? 'demonstração local' : dados.ambiente === 'homolog' ? 'homologação' : dados.ambiente === 'producao' ? 'produção' : 'não informado'}`,
    `Competência: ${dados.competencia}`,
    ...(r ? [`Regime: ${r.regime} — histórico de ${r.vigenciaInicio} até ${r.vigenciaFim || 'sem término informado'}`] : []),
    `Serviço: ${dados.codigoServico || 'pendente'} · Perfil: ${dados.perfil?.nome || 'cadastro da empresa'}`,
    `NBS: ${dados.perfil?.codigoNbs || 'não configurado'}`,
    ...(c?.local ? [`Local da prestação: ${c.local.codigo} · origem: ${c.local.fonte}`] : []),
    ...(c?.incidencia ? [`ISS — município indicado pela regra: ${c.incidencia.municipio || 'tratamento especial'} · conferência municipal necessária`] : []),
    ...(c?.obrigacao ? [`IBS/CBS: ${c.obrigacao.estado} — ${c.obrigacao.motivo}`] : []),
    ...(c?.ibscbs?.ok ? [`Grupo IBS/CBS na declaração: ${c.ibscbs.informar ? 'será informado' : 'não será informado'}`] : []),
    ...(dados.perfil ? [`IBS/CBS — operação: ${dados.perfil.ibscbsCIndOp || '—'} · CST: ${dados.perfil.ibscbsCst || '—'} · classificação: ${dados.perfil.ibscbsCClassTrib || '—'}`] : []),
    ...CAMPOS_PERFIL_EMISSAO.filter(campo => ['regApTribSN', 'tribISSQN', 'regEspTrib', 'retencaoFederalArt30', 'cstPisCofins'].includes(campo.id)
      && dados.configuracaoFiscal?.perfil?.[campo.id] != null).map(campo => `${campo.rotulo}: ${textoDoValor(campo.id, dados.configuracaoFiscal.perfil[campo.id])}`),
    ...(dados.iss ? [`ISS retido: ${dados.iss.retido ? 'sim' : 'não'}`] : []),
    ...(dados.iss?.ok ? [`Alíquota de ISS na DPS: ${dados.iss.informar ? `${dados.iss.pAliq}% · origem: ${dados.iss.fonteAliquota}` : 'não enviada nas condições desta operação'}`,
      ...(dados.iss.motivo ? [dados.iss.motivo] : [])] : []),
  ];
}

export function PreviaFiscal({ previa, companyId, destaque = false }) {
  if (!previa.habilitada) return null;
  return <section aria-labelledby="titulo-previa-fiscal" style={{ margin: '16px 0', overflowWrap: 'anywhere' }}>
    <h3 id="titulo-previa-fiscal">Prévia fiscal por competência</h3>
    {previa.carregando && <p role="status">Conferindo histórico e regras da operação…</p>}
    {previa.erro && <p role="alert">{previa.erro}</p>}
    {previa.erro && <button type="button" onClick={previa.tentar}>Atualizar prévia fiscal</button>}
    {previa.dados && <details open={destaque || undefined}>
      <summary>{previa.dados.competencia} · {previa.dados.regimeVigente?.regime || 'Regime pendente'} · {previa.dados.ok ? 'Ver contexto fiscal' : 'Há pendências'}</summary>
      <ul>{linhasDaPreviaFiscal(previa.dados).map(l => <li key={l}>{l}</li>)}</ul>
    </details>}
    {previa.dados?.pendencias.map(p => <p role="alert" key={p.codigo}>{p.mensagem} {p.correcao}</p>)}
    {previa.bloqueada && !previa.carregando && <p>Confira o histórico no <a href={`/companies/${encodeURIComponent(companyId)}/edit`} target="_blank" rel="noreferrer">cadastro da empresa</a> e os parâmetros em <a href={`/companies/${encodeURIComponent(companyId)}/emissao-nfse`} target="_blank" rel="noreferrer">configurações de emissão</a>. <button type="button" onClick={previa.tentar}>Rever prévia após correção</button></p>}
    <small>A prévia confere o contexto fiscal. A emissão revalida os dados completos; os valores definitivos de IBS/CBS vêm do XML autorizado.</small>
  </section>;
}
