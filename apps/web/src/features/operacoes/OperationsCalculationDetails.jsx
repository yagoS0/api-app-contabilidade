import { useEffect, useState } from 'react';
import { operationMoney as money, operationInstant, readCalculationDetails } from './operationsDetails';

export function CalculationEvidence({ details }) {
  if (!details) return <p role="status">Lendo cálculo e auditoria salvos…</p>;
  const snapshot = details.snapshot?.value, audit = details.auditoria?.value;
  // The history DTO has no calculation revision key. Do not join by declaration
  // number/date/current flag: reopening and recalculation preserve old identifiers.
  const history = details.history?.value;
  return <>
    {Object.entries(details).filter(([, source]) => source.error).map(([key, source]) => <p role="alert" key={key}>Leitura de {({ snapshot: 'cálculo salvo', auditoria: 'auditoria de notas', history: 'histórico PGDAS' })[key]}: {source.error}. Atualize a conferência ou abra a empresa para verificar.</p>)}
    <dl className="operacoes-checklists">
      <div><dt>Faturamento interno salvo</dt><dd>{money(snapshot?.receitaInterna)}</dd></div>
      <div><dt>Faturamento externo salvo</dt><dd>{money(snapshot?.receitaExterna)}</dd></div>
      <div><dt>Cálculo simulado salvo</dt><dd>{money(snapshot?.dasSimuladoSerpro)}</dd></div>
      <div><dt>Estado do snapshot</dt><dd>{snapshot?.estado || 'Não disponível'}</dd></div>
      <div><dt>Declaração do snapshot</dt><dd>{snapshot?.numeroDeclaracao || 'Não registrada'}</dd></div>
      <div><dt>Retorno salvo da transmissão SERPRO</dt><dd>{money(snapshot?.dasRetornadoSerpro)}</dd></div>
      <div><dt>Data salva da transmissão</dt><dd>{operationInstant(snapshot?.transmitidoEm)}</dd></div>
      <div><dt>Correspondência do extrato com esta revisão</dt><dd>A verificar</dd></div>
    </dl>
    <p>Extrato sem vínculo comprovado com a revisão do cálculo. Número da declaração e valores iguais não comprovam correspondência. O retorno salvo pode pertencer à transmissão anterior quando o cálculo foi reaberto ou recalculado.</p>
    {history && <>
      {(history.declaracaoDiferenteDaInterna || history.entregaSemTransmissaoInterna || history.mudancaDetectada) && <p role="alert">O histórico indica mudança ou divergência de declaração. Confira as versões na apuração da empresa.</p>}
      <div className="operacoes-tabela-scroll" role="region" aria-label="Extratos salvos, sem conciliação de revisão" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Declaração / versão</th><th>Imposto do extrato salvo</th><th>Origem</th><th>Consulta</th><th>Registro</th></tr></thead><tbody>{history.versoes.map((v, i) => <tr key={`${v.id || 'legado'}-${i}`}><td>{v.numeroDeclaracao || 'Não registrada'}<br />{v.id || 'Versão não identificada'}</td><td>{money(v.dasTotal)}</td><td>{v.origem || 'Não registrada'}</td><td>{operationInstant(v.consultadaEm)}</td><td>{v.atual ? 'Atual na circular' : 'Histórico'}{v.legado ? ' · Legado' : ''}</td></tr>)}</tbody></table></div>
      {!history.versoes.length && <p>Nenhum extrato salvo disponível.</p>}
      {history.limitado && <p>Histórico limitado pela fonte. Abra a apuração para conferir os documentos disponíveis.</p>}
    </>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Atividades do cálculo salvo" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Atividade salva</th><th>Anexo do formulário</th><th>Receita interna / externa</th></tr></thead><tbody>{(Array.isArray(snapshot?.atividadesEscolhidas) ? snapshot.atividadesEscolhidas : []).map((activity, i) => <tr key={i}><td>{activity.descricao || activity.idAtividade || 'Não informado'}</td><td>{activity.anexoImplicito ?? 'Não registrado no formulário'}</td><td>{money(activity.valorInterno)} / {money(activity.valorExterno)}</td></tr>)}</tbody></table></div>
    {!snapshot?.atividadesEscolhidas?.length && <p>Atividades/anexo não disponíveis no snapshot. O cadastro atual não substitui o formulário histórico.</p>}
    <p>Auditoria: {audit ? `${audit.totalAchados ?? 'A verificar'} achados · ${audit.foraDaConferencia?.total ?? 'A verificar'} notas fora da conferência` : 'Indisponível; ausência não significa aprovação.'}</p>
    {audit && <div className="operacoes-tabela-scroll" role="region" aria-label="Auditoria da competência" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Verificação</th><th>Situação</th><th>Achados / não avaliadas</th><th>Causa</th></tr></thead><tbody>{[...(audit.perguntas || []), ...(audit.manutencao?.leitura ? [audit.manutencao.leitura] : [])].map(p => <tr key={p.id}><td>{p.titulo || p.id}</td><td>{p.situacao || 'A verificar'}</td><td>{p.achados?.length ?? 'A verificar'} / {p.naoAvaliadas?.length ?? 'A verificar'}</td><td>{p.motivo || (p.achados?.length ? 'Revisar as notas apontadas na auditoria' : 'Conferir evidências da verificação')}</td></tr>)}</tbody></table></div>}
  </>;
}

export function OperationsCalculationDetails({ api, companyId, competencia }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true; setData(null);
    readCalculationDetails(api, companyId, competencia).then(value => { if (active) setData(value); });
    return () => { active = false; };
  }, [api, companyId, competencia]);
  return <CalculationEvidence details={data} />;
}

// Read-only summary: these are distinct saved sources, never proof of reconciliation.
export function OperationsTransmissionValues({ api, companyId, competencia }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    readCalculationDetails(api, companyId, competencia).then(details => {
      if (active) setResult({ api, companyId, competencia, details });
    });
    return () => { active = false; };
  }, [api, companyId, competencia]);
  const details = result && result.api === api && result.companyId === companyId && result.competencia === competencia ? result.details : null;
  if (!details) return <><td>Lendo cálculo salvo…</td><td>Lendo extrato salvo…</td></>;
  const snapshot = details.snapshot?.value, history = details.history?.value;
  const failed = Object.values(details).some(source => source.error);
  const versions = history?.versoes || [];
  const current = versions.filter(version => version.atual);
  const divergent = history?.declaracaoDiferenteDaInterna || history?.entregaSemTransmissaoInterna || history?.mudancaDetectada;
  const incompatible = versions.some(version =>
    (version.competencia != null && version.competencia !== competencia) ||
    (version.companyId != null && version.companyId !== companyId) ||
    (version.portalClientId != null && version.portalClientId !== companyId));
  const ambiguous = current.length > 1 || (history?.atualId != null && (current.length !== 1 || current[0].id !== history.atualId));
  const declarationConflict = (history?.numeroDeclaracaoInterna && snapshot?.numeroDeclaracao && String(history.numeroDeclaracaoInterna) !== String(snapshot.numeroDeclaracao)) ||
    (current.length === 1 && snapshot?.numeroDeclaracao && current[0].numeroDeclaracao && String(current[0].numeroDeclaracao) !== String(snapshot.numeroDeclaracao));
  const unknown = failed || incompatible || ambiguous || divergent || declarationConflict;
  return <>
    <td>{unknown || !snapshot ? 'A verificar' : <><span>{money(snapshot.dasSimuladoSerpro)}</span><br /><small>Simulação · {snapshot.idempotencyKey}</small></>}</td>
    <td>{unknown || !versions.length ? 'A verificar' : versions.map((version, index) => <div key={version.id || index}>
      <span>{!version.id || !version.numeroDeclaracao || money(version.dasTotal) === 'Não disponível' ? 'A verificar' : money(version.dasTotal)}</span><br />
      <small>Declaração {version.numeroDeclaracao || 'a verificar'} · versão {version.id || 'a verificar'}<br />{version.atual ? 'Atual na circular' : 'Histórico'}</small>
    </div>)}</td>
  </>;
}
