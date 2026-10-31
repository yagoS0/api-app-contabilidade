import { OperationsGuides } from './OperationsGuides';
import { OperationsCalculationDetails, OperationsTransmissionValues } from './OperationsCalculationDetails';
import { useEffect, useRef, useState } from 'react';
import { useWorkspaceNavigation } from '../../app/navigation/WorkspaceNavigation.shared';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { projetarOperacoesEmpresas, resumirEtapasOperacoes, distribuicoesCadastrais, CHECKLIST_OPERACOES } from './operacoes';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { ofertaDeRetentativa } from '../guides/lib/canalDeEnvio';
import './operacoes.css';
import { OperationsApproval } from './OperationsApproval';
import { OperationsAlerts } from './OperationsAlerts';
import { OperationsRoutineCompanies } from './OperationsRoutineCompanies';
import { useOperationsEvidence } from './useOperationsEvidence';
import { CompetenciaCarteira } from '../companies/list/components/CompetenciaCarteira';
import { OperationsProcuracao } from './OperationsProcuracao';
import { OperationsManualInss } from './OperationsManualInss';
import { incorporarInssManual, useManualInss } from './useManualInss';
import { OperationsFiscalReports } from './OperationsFiscalReports';
import { operationDate, operationInstant } from './operationsDetails';

const quadros = [['apuracoes', 'Apurações pendentes', 'empresas'], ['faltantes', 'Guias faltantes', 'obrigações'], ['envios', 'Envios pendentes', 'obrigações'], ['erros', 'Erros de envio de guias', 'itens'], ['revisoes', 'Revisões pendentes', 'itens'], ['concluidas', 'Empresas concluídas', 'empresas']];
const nome = c => c.razao || c.razaoSocial || c.nome || c.cnpj;
const EMPTY_COMPANIES = [];
const panelNames = { apurar: 'Apurar', guias: 'Guias', contabilizacao: 'Contabilização', concluido: 'Concluído', calculado: 'Calculado', confirmado: 'Confirmado', transmitido: 'Transmitido', disponivel: 'Disponível', enviado: 'Enviado', pago: 'Pago', ...Object.fromEntries(CHECKLIST_OPERACOES) };


function Progress({ label, metric, unavailable, color, onClick, stage = false }) {
  const count = metric.done.length;
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} role={onClick ? undefined : 'group'} className={`operacoes-progress${stage ? " operacoes-progress-stage" : ""}`} disabled={onClick ? unavailable : undefined} aria-disabled={unavailable || undefined} onClick={onClick} aria-label={`${label} ${unavailable ? '—' : `${count}/${metric.total}`} empresas`} aria-description={`${unavailable ? 'Informação indisponível.' : `${metric.unknown.length} a verificar. ${metric.notApplicable.length} não aplicáveis, fora do total e das pendências.`} ${onClick ? 'Abrir tabela de empresas; o filtro identifica o conjunto da barra e as pendências.' : 'Indicador informativo. Abra Contabilização para conferir as empresas.'}`}>
    <span className="operacoes-progress-label">{label}</span><strong>{unavailable ? '—' : `${count}/${metric.total}`}</strong>
    <span className="operacoes-track" aria-hidden="true"><span style={{ width: `${metric.total ? count / metric.total * 100 : 0}%`, background: color }} /></span>
    {!unavailable && metric.unknown.length > 0 && <small>{metric.unknown.length} a verificar</small>}
  </Tag>;
}
function Pizza({ title, groups, unavailable, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef(null);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  let cursor = 0;
  const stops = groups.map(g => { const start = cursor; cursor += total ? g.items.length / total * 100 : 0; return `${g.color} ${start}% ${cursor}%`; });
  return <div className="operacoes-pizza-tile">
    <button ref={trigger} type="button" disabled={unavailable} aria-expanded={expanded} onClick={() => setExpanded(v => !v)} aria-label={`${title}: ${unavailable ? 'indisponível' : groups.map(g => `${g.label} ${g.items.length}`).join(', ')}`}>
      <strong>{title}</strong><span className="operacoes-pizza" aria-hidden="true" style={{ background: unavailable || !total ? 'var(--border)' : `conic-gradient(${stops.join(',')})` }} />
    </button>
    <div className="operacoes-pizza-tooltip" data-expanded={expanded} aria-label={`Categorias de ${title}`}>{groups.map(g => <button type="button" disabled={unavailable} key={g.key} onClick={() => { trigger.current?.focus(); setExpanded(false); onSelect(g.key); }}>{g.label}: {unavailable ? '—' : g.items.length}</button>)}</div>
  </div>;
}
export function OperationsPage({ api, companies = EMPTY_COMPANIES, competencia, loading = false, error, onRefresh, onChangeCompetencia, acoesGuia = {} }) {
  const navigation = useWorkspaceNavigation();
  const manualInss = useManualInss(api, competencia, companies);
  const { rows, tasks, groups } = incorporarInssManual(projetarOperacoesEmpresas(companies, competencia), manualInss.items);
  const evidence = useOperationsEvidence(api, competencia, companies);
  const summary = resumirEtapasOperacoes(rows, evidence.items, manualInss.items);
  const distribution = distribuicoesCadastrais(rows);
  const errorCompanies = [...new Map(groups.erros.map(t => [t.company.companyId, t.company])).values()];
  const [panel, setPanel] = useState(null), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [stageFilter, setStageFilter] = useState('all');
  const [calculationRow, setCalculationRow] = useState(null);
  const calculationTrigger = useRef(null), calculationHeading = useRef(null);
  useEffect(() => {
    if (calculationRow) calculationHeading.current?.focus();
    else calculationTrigger.current?.focus({ preventScroll: true });
  }, [calculationRow]);
  const [procuracao, setProcuracao] = useState(null), [approvalRows, setApprovalRows] = useState(null);
  useEffect(() => { setCalculationRow(null); setPanel(null); setQuery(''); setPage(0); setApprovalOpen(false); setProcuracao(null); setSelection(null); }, [competencia, api]);

  const search = navigation?.location?.search;
  useEffect(() => {
    if (search == null) return;
    const params = new URLSearchParams(search), key = params.get('operacoesEtapa'), mode = params.get('operacoesLista');
    if (params.get('operacoesCompetencia') === competencia && Object.hasOwn(panelNames, key) && ['all', 'stage', 'missing', 'warnings'].includes(mode)) {
      setPanel({ key, title: mode === 'all' && key === 'apurar' ? 'Apuração' : panelNames[key], mode, competencia });
    } else setPanel(null);
    // Only URL and period identify a saved presentation filter.
  }, [search, competencia]);
  const saveFilter = (key, mode) => {
    if (!navigation?.location || navigation.location.pathname !== '/companies') return;
    const params = new URLSearchParams(search);
    params.set('competencia', competencia);
    params.set('visao', 'operacoes');
    for (const name of ['operacoesEtapa', 'operacoesLista', 'operacoesCompetencia']) params.delete(name);
    if (key) { params.set('operacoesEtapa', key); params.set('operacoesLista', mode); params.set('operacoesCompetencia', competencia); }
    navigation.navigate(`/companies?${params.toString()}`, { replace: true });
  };
  const show = (key, title, mode = 'all') => { setCalculationRow(null); setStageFilter('all'); setPanel({ key, title, mode, competencia }); setQuery(''); setPage(0); saveFilter(key, mode); };
  const closePanel = () => { setCalculationRow(null); setPanel(null); saveFilter(null); };
  const [chart, setChart] = useState(null);
  const [selection, setSelection] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const sending = useRef(false);
  const unavailable = loading || Boolean(error);
  const manualUnavailable = manualInss.loading || Boolean(manualInss.error);
  const selectedGroupUnavailable = ['concluidas', 'faltantes', 'revisoes'].includes(selection?.group) && manualUnavailable;
  const active = selection?.competencia === competencia && !unavailable && !selectedGroupUnavailable ? selection : null;
  const manualSelected = active?.manualCompanyId ? summary.items.find(row => row.company.companyId === active.manualCompanyId && row.manualInss) : null;
  const selected = active?.id ? (manualSelected || [...tasks, ...groups.concluidas].find(t => t.id === active.id)) : null;
  const inssDetail = Boolean(selected && (selected.manualInss || selected.tag?.key === 'inss'));
  const open = (group, id = null) => { setSelection({ group, id, competencia }); setPreview(false); setResult(null); };
  const close = () => { if (!busy) { setSelection(null); setPreview(false); setResult(null); } };
  const closeDetail = () => active?.manualCompanyId ? close() : open(active.group);
  const link = (company, tab) => `${companyTabPath(company.companyId, tab)}?competencia=${encodeURIComponent(competencia || '')}`;
  const whatsapp = selected?.tag?.canalEnvio === 'WHATSAPP' && selected?.tag?.envioStatus === 'falhou';
  const offer = ofertaDeRetentativa(selected?.tag);
  const send = whatsapp ? acoesGuia.onEnviarWhatsapp : acoesGuia.onEnviar;
  const sendIdentity = JSON.stringify([competencia, selected?.company.companyId, selected?.tag?.guideId, whatsapp, selected?.tag?.envioErro, selected?.tag?.emailLastError]);
  const resultContext = JSON.stringify([competencia, active?.group, active?.id]);
  const currentResultContext = useRef(resultContext);
  currentResultContext.current = resultContext;
  async function enviar() {
    if (sending.current || !preview || !selected?.tag?.guideId || !send || (whatsapp && !offer.habilitado)) return;
    if (preview !== sendIdentity) { setPreview(false); setResult({ error: true, message: 'A guia ou o resultado mudou. Confira os dados atualizados em Guias antes de enviar.' }); return; }
    sending.current = true;
    setBusy(true); setResult(null);
    try {
      const out = await send(selected.tag.guideId, selected.company);
      if (currentResultContext.current !== resultContext) return;
      setResult({ error: out?.ok !== true, message: out?.message || 'Confira o resultado na aba Guias antes de uma nova ação.' });
    } catch { if (currentResultContext.current === resultContext) setResult({ error: true, message: 'Não foi possível confirmar o envio. Confira o histórico em Guias antes de repetir.' }); }
    finally { sending.current = false; setBusy(false); setPreview(false); }
  }
  const panelRows = !panel ? [] : panel.mode === 'all' ? summary.items : panel.mode === 'warnings' ? summary.items.filter(r => panel.key === 'confirmado' ? r.operation?.status === 'INVALIDATED' : r.operation?.execution && r.operation.execution.status !== 'DONE') : panel.mode === 'stage' ? summary.items.filter(r => r.presentation.chave === panel.key) : summary.metrics[panel.key]?.missing || [];
  const sortedPanelRows = [...panelRows].sort((a, b) => Number(a.axes.calculado === true) - Number(b.axes.calculado === true) || Number(a.axes.confirmado === true) - Number(b.axes.confirmado === true) || Number(a.axes.transmitido === true) - Number(b.axes.transmitido === true));
  const attentionFilterAvailable = ['calculado', 'transmitido'].includes(panel?.key);
  const effectiveStageFilter = stageFilter === 'error' && !attentionFilterAvailable ? 'all' : stageFilter;
  const filtered = sortedPanelRows.filter(r => `${nome(r.company)} ${r.company.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).filter(r => effectiveStageFilter === 'all' || (effectiveStageFilter === 'done' ? r.axes[panel?.key] === true : effectiveStageFilter === 'pending' ? r.axes[panel?.key] === false : effectiveStageFilter === 'error' ? Boolean(r.operation?.blocked || r.operation?.execution?.status && r.operation.execution.status !== 'DONE') : r.axes[panel?.key] == null));
  const accountingPanel = panel && (CHECKLIST_OPERACOES.some(([k]) => k === panel.key) || panel.key === 'contabilizacao');
  const guidePanel = panel && ['guias', 'disponivel', 'enviado', 'pago'].includes(panel.key);
  const compactCalculationPanel = attentionFilterAvailable;
  const statusText = v => v === true ? 'Concluído' : v === false ? 'Pendente' : 'A verificar';
  const refresh = () => { evidence.reload(); manualInss.reload(); onRefresh?.(); };
  return <section className="operacoes" aria-label="Operações">
    <div className="operacoes-cabecalho"><CompetenciaCarteira competencia={competencia} onChange={onChangeCompetencia} onRefresh={refresh} loading={loading} disabled={busy || approvalBusy} /></div>
    {error && <p role="alert">{error} Os indicadores ficam indisponíveis até a atualização.</p>}
    <div className="operacoes-layout">
      <div className="operacoes-etapas-pizzas">
        <section className="operacoes-etapa operacoes-apuracao" aria-label="Apuração">
          <button className="operacoes-titulo" aria-label="Apuração" onClick={() => show('apurar','Apuração','all')} disabled={unavailable}>Apuração</button>
          {[['calculado','Calculado'],['confirmado','Confirmado'],['transmitido','Transmitido']].map(([key,label]) => {
            const warnings = summary.items.filter(r => key === 'confirmado' ? r.operation?.status === 'INVALIDATED' : key === 'transmitido' && r.operation?.execution && r.operation.execution.status !== 'DONE');
            return <div className="operacoes-status-com-aviso" key={key}><Progress label={label} color="var(--state-ok)" metric={summary.metrics[key]} unavailable={unavailable || (key === 'confirmado' && (evidence.loading || Boolean(evidence.error)))} onClick={() => { if (key === 'confirmado') { setApprovalRows(null); setApprovalOpen(true); } else show(key,label); }} />
              {key === 'calculado' ? <OperationsAlerts api={api} compact /> : !unavailable && warnings.length > 0 && <button type="button" className="operacoes-aviso-etapa operacoes-erro" aria-label={`Avisos de ${label}: ${warnings.length} empresas`} onClick={() => show(key,`Avisos de ${label}`,'warnings')}>⚠ {warnings.length}</button>}
            </div>;
          })}
          {evidence.error && <p className="operacoes-feedback-compact" role={api?.getOperationEvidence ? "alert" : "status"}>{evidence.error} <Button size="sm" variant="secondary" onClick={evidence.reload}>Atualizar conferências</Button></p>}
        </section>
        <section className="operacoes-etapa operacoes-guias" aria-label="Guias">
          <button className="operacoes-titulo" aria-label={`Erros de envio de guias ${unavailable ? '—' : errorCompanies.length}`} onClick={() => open('erros')} disabled={unavailable}>Guias {errorCompanies.length > 0 && <span className="operacoes-erro">⚠ {errorCompanies.length}</span>}</button>
          {[['disponivel','Disponível'],['enviado','Enviado'],['pago','Pago']].map(([key,label]) => <Progress key={key} label={label} color="var(--state-ok)" metric={summary.metrics[key]} unavailable={unavailable || manualUnavailable} onClick={() => show(key,label)} />)}
          {manualInss.error && <p role="alert">{manualInss.error} <Button size="sm" variant="secondary" onClick={manualInss.reload}>Conferir INSS manual</Button></p>}
        </section>
        <section className="operacoes-etapa operacoes-contabilizacao" aria-label="Contabilização">
          <button className="operacoes-titulo" aria-label="Contabilização" onClick={() => show('contabilizacao','Contabilização','all')} disabled={unavailable}>Contabilização</button>
          {CHECKLIST_OPERACOES.map(([key,label]) => <Progress key={key} label={label} color="var(--state-ok)" metric={summary.metrics[key]} unavailable={unavailable} />)}
        </section>
        <div className="operacoes-quatro-pizzas">{[['parcelas','Parcelamento'],['fiscal','Situação fiscal'],['certificado','Certificado'],['procuracao','Procuração']].map(([key,title]) => <Pizza key={key} title={title} groups={distribution[key]} unavailable={unavailable} onSelect={group => setChart({ key, group, competencia })} />)}</div>
      </div>
      <OperationsRoutineCompanies api={api} companies={companies} competencia={competencia} loading={loading} error={error} onRefreshCompanies={refresh} />
    </div>
    {panel?.competencia === competencia && !unavailable && !(manualUnavailable && ['guias','concluido','disponivel','enviado','pago'].includes(panel.key)) && <Modal titulo={panel.title} tamanho="lg" className="operacoes-dialogo" suspenso={Boolean(calculationRow)} aoFechar={closePanel}>
      <p>Competência {competencia} · {panelRows.length} empresas {panel.mode === 'warnings' ? 'com avisos nesta etapa' : panel.mode === 'stage' ? 'nesta etapa' : panel.mode === 'missing' ? 'com etapa pendente ou a verificar' : 'elegíveis'}</p>
      <label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      {['calculado','transmitido','disponivel','enviado','pago'].includes(panel.key) && <label className="operacoes-rotinas-filtros">Situação da etapa<select aria-label="Situação da etapa" value={effectiveStageFilter} onChange={e => { setStageFilter(e.target.value); setPage(0); }}><option value="all">Todas as empresas deste conjunto</option><option value="done">{panel.key === 'calculado' ? 'Calculadas' : 'Com conclusão comprovada'}</option><option value="pending">{panel.key === 'calculado' ? 'Não calculadas' : 'Pendentes'}</option>{attentionFilterAvailable && <option value="error">Atenção ou bloqueio</option>}<option value="unknown">A verificar</option></select><span>{compactCalculationPanel ? 'Erros podem coexistir com a conclusão registrada.' : 'A barra conta empresas com conclusão comprovada, não documentos. Erros podem coexistir com outros estados.'}</span></label>}
      {panel.key === 'transmitido' && <p>Simulação e extrato são fontes distintas. Correspondência com a revisão: a verificar.</p>}
      {guidePanel ? <OperationsGuides key={`${competencia}:${panel.key}`} api={api} rows={filtered.slice(page * 30, page * 30 + 30)} competencia={competencia} stage={panel.key} onManualInss={row => { closePanel(); setSelection({ group: 'revisoes', id: `${row.company.companyId}:inss-detalhe`, manualCompanyId: row.company.companyId, competencia }); setPreview(false); setResult(null); }} /> : <div className="operacoes-tabela-scroll" role="region" aria-label="Empresas da etapa" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Empresa</th>{compactCalculationPanel && <th className="operacoes-acao-curta">Ação</th>}{compactCalculationPanel ? <th>{panelNames[panel.key]}</th> : accountingPanel ? CHECKLIST_OPERACOES.map(([key,label]) => <th key={key}>{label}</th>) : <><th>Calculado</th><th>Confirmado</th><th>Transmitido</th></>}{panel.key === 'transmitido' && <><th>Cálculo salvo</th><th>Imposto do extrato salvo</th></>}{!compactCalculationPanel && <th>Evidências e ações</th>}</tr></thead><tbody>{filtered.slice(page * 30, page * 30 + 30).map(row => <tr key={row.company.companyId}>
        <th scope="row">{nome(row.company)}{compactCalculationPanel && <>
          {row.operation?.blocked && <p role="alert">{row.operation.blocked}</p>}
          {row.operation?.execution?.message && <p>{row.operation.execution.message}</p>}
        </>}</th>
        {compactCalculationPanel && <td className="operacoes-acao-curta"><Button size="sm" variant="secondary" aria-label={`Ver evidências de ${nome(row.company)}`} onClick={e => { calculationTrigger.current = e.currentTarget; setCalculationRow(row); }}>Detalhes</Button></td>}
        {compactCalculationPanel ? <td>{statusText(row.axes[panel.key])}</td> : accountingPanel ? CHECKLIST_OPERACOES.map(([key]) => <td key={key}>{statusText(row.axes[key])}{row.fluxo.contabilizacao?.checklistAutomatico?.[key] ? ' · automática' : ''}</td>) : ['calculado','confirmado','transmitido'].map(key => <td key={key}>{statusText(row.axes[key])}</td>)}
        {panel.key === 'transmitido' && <OperationsTransmissionValues api={api} companyId={row.company.companyId} competencia={competencia} />}
        {!compactCalculationPanel && <td>{accountingPanel ? <><p>Fechamento: {row.fluxo.contabilizacao?.rotulo || 'A verificar'} · Importação ERP: {row.fluxo.contabilizacao?.importados ?? '—'}/{row.fluxo.contabilizacao?.total ?? '—'}</p>{row.fluxo.contabilizacao?.conferenciaDesatualizada && <p role="status">Conferência desatualizada · revise a correção do mês fechado.</p>}</> : <><p>Revisão: {row.operation?.revision || 'A verificar'}</p>{row.operation?.blocked && <p role="alert">{row.operation.blocked}</p>}{row.operation?.execution?.message && <p>{row.operation.execution.message}</p>}<Button size="sm" variant="secondary" onClick={e => { calculationTrigger.current = e.currentTarget; setCalculationRow(row); }}>Ver evidências de {nome(row.company)}</Button></>}
          <details><summary>Subetapas e evidências</summary><ul>{(row.fluxo.tarefas || []).map(t => <li key={t.chave}>{t.titulo} · {t.concluida ? 'Concluída' : 'Pendente'}{t.revisar ? ' · Revisar dados alterados' : ''}</li>)}</ul></details>
          <div className="operacoes-acoes"><InternalLink className="btn btn-secondary btn-sm" href={link(row.company,accountingPanel ? 'lancamentos' : 'cadastroFiscal')}>{accountingPanel ? 'Abrir contabilidade' : 'Abrir apuração'}</InternalLink>
          {!accountingPanel && <><InternalLink className="btn btn-secondary btn-sm" href={link(row.company,'obrigacoes')}>Abrir obrigações</InternalLink>{['ACCOUNTANT','FIRM_ADMIN'].includes(row.company.myRole) && <Button size="sm" variant="secondary" disabled={!row.operation} onClick={() => { setApprovalRows([row]); closePanel(); setApprovalOpen(true); }}>Conferir e continuar rotina</Button>}</>}
          </div>
        </td>}
      </tr>)}</tbody></table></div>}
      {!filtered.length && <p>Nenhuma empresa neste conjunto.</p>}
      {filtered.length > 30 && <div className="operacoes-acoes"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>{page + 1}/{Math.ceil(filtered.length / 30)}</span><Button variant="secondary" disabled={(page + 1) * 30 >= filtered.length} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}
    </Modal>}
    {calculationRow && panel?.competencia === competencia && !unavailable && <Modal titulo={`Evidências de ${nome(calculationRow.company)}`} tamanho="lg" className="operacoes-dialogo" aoFechar={() => setCalculationRow(null)} rodape={<Button variant="secondary" onClick={() => setCalculationRow(null)}>Voltar à tabela de empresas</Button>}>
      <h3 ref={calculationHeading} tabIndex={-1}>Cálculo e auditoria de {nome(calculationRow.company)}</h3>
      <p>Competência {competencia}</p>
      {compactCalculationPanel && <>
        <dl className="operacoes-checklists">{['calculado','confirmado','transmitido'].map(key => <div key={key}><dt>{panelNames[key]}</dt><dd>{statusText(calculationRow.axes[key])}</dd></div>)}</dl>
        {calculationRow.operation?.blocked && <p role="alert">{calculationRow.operation.blocked}</p>}
        {calculationRow.operation?.execution?.message && <p>{calculationRow.operation.execution.message}</p>}
        <p className="operacoes-revisao-tecnica">Revisão: {calculationRow.operation?.revision || 'A verificar'}</p>
        <details><summary>Subetapas e evidências</summary><ul>{(calculationRow.fluxo.tarefas || []).map(t => <li key={t.chave}>{t.titulo} · {t.concluida ? 'Concluída' : 'Pendente'}{t.revisar ? ' · Revisar dados alterados' : ''}</li>)}</ul></details>
        <div className="operacoes-acoes">
          <InternalLink className="btn btn-secondary btn-sm" href={link(calculationRow.company, 'cadastroFiscal')}>Abrir apuração</InternalLink>
          <InternalLink className="btn btn-secondary btn-sm" href={link(calculationRow.company, 'obrigacoes')}>Abrir obrigações</InternalLink>
          {['ACCOUNTANT','FIRM_ADMIN'].includes(calculationRow.company.myRole) && <Button size="sm" variant="secondary" disabled={!calculationRow.operation} onClick={() => { setApprovalRows([calculationRow]); calculationTrigger.current = null; closePanel(); setApprovalOpen(true); }}>Conferir e continuar rotina</Button>}
        </div>
      </>}
      <OperationsCalculationDetails api={api} companyId={calculationRow.company.companyId} competencia={competencia} />
      {!compactCalculationPanel && <InternalLink className="btn btn-secondary btn-sm" href={link(calculationRow.company, 'cadastroFiscal')}>Abrir apuração da empresa</InternalLink>}
    </Modal>}
    {active && !active.id && <Modal titulo={quadros.find(([key]) => key === active.group)?.[1]} aoFechar={close} className="operacoes-dialogo">
      <p>Competência {competencia} · {active.group === 'erros' ? `${errorCompanies.length} empresas` : `${groups[active.group].length} itens`}</p>
      <div className="operacoes-tabela-scroll" role="region" aria-label="Pendências da operação" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Empresa</th><th>Etapa</th><th>Causa</th><th>Próxima ação</th></tr></thead><tbody>{groups[active.group].map(t => <tr key={t.id}><th scope="row">{nome(t.company)}</th><td>{t.titulo}</td><td>{t.tag?.envioErro || t.tag?.emailLastError || 'Conferir evidências do item'}</td><td><Button size="sm" variant="secondary" onClick={() => open(active.group,t.id)}>Ver detalhes</Button></td></tr>)}</tbody></table></div>{!groups[active.group].length && <p>Nenhum item nesta categoria.</p>}
    </Modal>}
    {chart?.competencia === competencia && chart.key === 'fiscal' && !unavailable && <OperationsFiscalReports key={`${competencia}:${chart.group}`} api={api} rows={distribution.fiscal.find(g => g.key === chart.group).items} title={`${distribution.fiscal.find(g => g.key === chart.group).label} · ${distribution.fiscal.find(g => g.key === chart.group).items.length} empresas`} competencia={competencia} onClose={() => setChart(null)} />}
    {chart?.competencia === competencia && chart.key !== 'fiscal' && !unavailable && (() => {
      const group = distribution[chart.key].find(g => g.key === chart.group);
      return <Modal titulo={`${group.label} · ${group.items.length} empresas`} aoFechar={() => setChart(null)} className="operacoes-dialogo">
        {chart.key === 'parcelas' && <p>Parcelamento não comprova irregularidade fiscal.</p>}
        <div className="operacoes-tabela-scroll" role="region" aria-label="Empresas do indicador" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Empresa</th><th>Detalhe e próxima ação</th></tr></thead><tbody>{group.items.map(({company}) => <tr key={company.companyId}><th scope="row">{nome(company)}</th><td>{chart.key === 'procuracao' ? <div><p>Validade documental: {String(company.serproStatus?.validUntil || '').includes('T') ? operationInstant(company.serproStatus?.validUntil) : operationDate(company.serproStatus?.validUntil)}. Elegibilidade operacional depende de revalidação.</p><Button size="sm" variant="secondary" onClick={() => { setChart(null); setProcuracao(company); }}>Pedir procuração</Button></div> : <InternalLink className="btn btn-secondary btn-sm" href={link(company,({parcelas:'parcelamento',certificado:'certificado'})[chart.key])}>{chart.key === 'certificado' ? 'Configurar certificado' : 'Abrir parcelamento'}</InternalLink>}</td></tr>)}</tbody></table></div>{!group.items.length && <p>Nenhum item neste grupo.</p>}
      </Modal>;
    })()}
    {procuracao && <OperationsProcuracao api={api} company={procuracao} onClose={() => setProcuracao(null)} />}    {approvalOpen && <Modal titulo="Conferir e liberar apurações" tamanho="lg" className="operacoes-dialogo" ocupado={approvalBusy} aoFechar={() => !approvalBusy && setApprovalOpen(false)} rodape={<Button variant="secondary" disabled={approvalBusy} onClick={() => setApprovalOpen(false)}>Fechar</Button>}>
      {!unavailable ? <OperationsApproval embedded key={competencia} api={api} rows={approvalRows ? rows.filter(row => approvalRows.some(selected => selected.company.companyId === row.company.companyId)) : rows} competencia={competencia} onChanged={refresh} onBusyChange={setApprovalBusy} /> : <p role="alert">Atualize as empresas antes de conferir apurações.</p>}
    </Modal>}
    {active?.id && <Modal titulo={inssDetail ? nome(selected.company) : selected ? `${nome(selected.company)} · ${selected.titulo}` : quadros.find(([key]) => key === active.group)?.[1]} aoFechar={() => !busy && closeDetail()} ocupado={busy} tamanho="md" className="operacoes-dialogo" rodape={inssDetail ? <div className="operacoes-inss-rodape"><Button variant="secondary" disabled={busy} onClick={closeDetail}>Fechar</Button>{!busy && <div className="operacoes-acoes"><InternalLink className="btn btn-secondary btn-md" href={link(selected.company, 'automacao')}>Configurar INSS manual</InternalLink><InternalLink className="btn btn-primary btn-md" href={link(selected.company, 'guides')}>Abrir Guias</InternalLink></div>}</div> : <Button variant="secondary" disabled={busy} onClick={closeDetail}>Fechar</Button>}>
      <div className="operacoes">
        {inssDetail ? <div className="operacoes-inss-contexto"><p>INSS <span>· Competência {competencia?.split('-').reverse().join('/')}</span></p><dl className="operacoes-inss-dados"><div><dt>Apuração</dt><dd>{selected.fluxo.apuracao.rotulo}</dd></div><div><dt>Contabilidade</dt><dd>{selected.fluxo.contabilizacao.rotulo}</dd></div></dl></div> : <p>Competência {competencia}</p>}
        {result && <p role={result.error ? 'alert' : 'status'}>{result.message}</p>}
        {active.id && !selected ? <p role="status">Este item não está mais pendente na lista atualizada.</p> : selected ? <>
          {!inssDetail && <p>Apuração: <strong>{selected.fluxo.apuracao.rotulo}</strong> · Contabilidade: {selected.fluxo.contabilizacao.rotulo}</p>}
          {selected.tipo === 'erros' && <>
            <p className="operacoes-erro">{selected.tag.envioErro || selected.tag.emailLastError || 'O envio falhou. O provedor não informou o motivo.'}</p>
            <p>{whatsapp ? 'WhatsApp' : 'Envio pelos canais cadastrados'} · A guia já existe. A falha de envio não desfaz a apuração.</p>
            {whatsapp && <p>{offer.frase}</p>}
            {preview ? <div className="operacoes-previa"><h3>Conferir novo envio</h3><p>{selected.tag.label} de {nome(selected.company)} · {competencia}</p><p>{whatsapp ? 'Somente WhatsApp, para os destinos com falha.' : 'Liberar a guia e enviar pelos canais cadastrados, conforme o fluxo atual.'} Será usado o documento salvo, sem buscar outro DAS ou extrato.</p><div className="operacoes-acoes"><Button disabled={busy} onClick={enviar}>{busy ? 'Enviando…' : 'Confirmar envio'}</Button><Button variant="secondary" disabled={busy} onClick={() => setPreview(false)}>Cancelar</Button></div></div>
              : !result && send && selected.tag.guideId && <Button disabled={whatsapp && !offer.habilitado} onClick={() => setPreview(sendIdentity)}>Conferir novo envio</Button>}
          </>}
          {selected.tipo === 'pendencias' && !inssDetail && <p>{selected.tag?.state === 'missing' ? 'Confira ou anexe o documento na aba Guias. A ausência do arquivo não comprova falta de apuração.' : selected.tag?.state === 'gerada' ? 'Documento disponível. Confira o destino e a liberação na aba Guias.' : 'Confira o detalhe desta pendência na empresa.'}</p>}
          {(selected.manualInss || selected.tag?.key === 'inss') && api?.getCompanyManualInss && <OperationsManualInss compact key={`${selected.company.companyId}:${competencia}`} api={api} companyId={selected.company.companyId} competencia={competencia} canEdit={false} />}
          {!busy && !inssDetail && <div className="operacoes-acoes operacoes-destinos">
            <InternalLink className="btn btn-secondary btn-sm" href={link(selected.company, selected.tipo === 'apuracoes' ? 'cadastroFiscal' : 'guides')}>{selected.tipo === 'apuracoes' ? 'Abrir apuração' : 'Abrir Guias e corrigir'}</InternalLink>
            <InternalLink className="btn btn-secondary btn-sm" href={link(selected.company, 'automacao')}>{selected.manualInss || selected.tag?.key === 'inss' ? 'Configurar INSS manual' : 'Configurar consultas'}</InternalLink>
          </div>}
        </> : <ul className="operacoes-lista-modal">{groups[active.group].map(t => <li key={t.id}><div><strong>{nome(t.company)}</strong><small>{t.titulo}</small></div><Button size="sm" variant="secondary" onClick={() => open(active.group, t.id)}>Ver detalhes</Button></li>)}{!groups[active.group].length && <li>Nenhum item nesta categoria.</li>}</ul>}
      </div>
    </Modal>}
  </section>;
}
