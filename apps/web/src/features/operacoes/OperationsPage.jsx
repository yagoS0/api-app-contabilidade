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

const quadros = [['apuracoes', 'Apurações pendentes', 'empresas'], ['faltantes', 'Guias faltantes', 'obrigações'], ['envios', 'Envios pendentes', 'obrigações'], ['erros', 'Erros de envio de guias', 'itens'], ['revisoes', 'Revisões pendentes', 'itens'], ['concluidas', 'Empresas concluídas', 'empresas']];
const nome = c => c.razao || c.razaoSocial || c.nome || c.cnpj;
const EMPTY_COMPANIES = [];
const panelNames = { apurar: 'Apurar', guias: 'Guias', contabilizacao: 'Contabilização', concluido: 'Concluído', calculado: 'Calculado', confirmado: 'Confirmado', transmitido: 'Transmitido', disponivel: 'Disponível', enviado: 'Enviado', pago: 'Pago', ...Object.fromEntries(CHECKLIST_OPERACOES) };


function Progress({ label, metric, unavailable, color, onClick, stage = false }) {
  const count = metric.done.length;
  return <button type="button" className={`operacoes-progress${stage ? " operacoes-progress-stage" : ""}`} disabled={unavailable} onClick={onClick} aria-label={`${label} ${unavailable ? '—' : `${count}/${metric.total}`} empresas`} aria-description={`${unavailable ? 'Informação indisponível.' : `${metric.unknown.length} a verificar. ${metric.notApplicable.length} não aplicáveis, fora do total e das pendências.`} ${stage ? 'A barra mede conclusão independente da posição. Abrir empresas na posição atual desta etapa.' : 'Abrir empresas sem conclusão comprovada, com pendências ou informações a verificar.'}`}>
    <span className="operacoes-progress-label">{label}</span><strong>{unavailable ? '—' : `${count}/${metric.total}`}</strong>
    <span className="operacoes-track" aria-hidden="true"><span style={{ width: `${metric.total ? count / metric.total * 100 : 0}%`, background: color }} /></span>
    {!unavailable && metric.unknown.length > 0 && <small>{metric.unknown.length} a verificar</small>}
  </button>;
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
  const [procuracao, setProcuracao] = useState(null), [approvalRows, setApprovalRows] = useState(null);
  useEffect(() => { setPanel(null); setQuery(''); setPage(0); setApprovalOpen(false); setProcuracao(null); setSelection(null); }, [competencia, api]);

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
  const show = (key, title, mode = 'missing') => { setPanel({ key, title, mode, competencia }); setQuery(''); setPage(0); saveFilter(key, mode); };
  const closePanel = () => { setPanel(null); saveFilter(null); };
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
  const filtered = sortedPanelRows.filter(r => `${nome(r.company)} ${r.company.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const accountingPanel = panel && (CHECKLIST_OPERACOES.some(([k]) => k === panel.key) || panel.key === 'contabilizacao');
  const guidePanel = panel && ['guias', 'disponivel', 'enviado', 'pago'].includes(panel.key);
  const statusText = v => v === true ? 'Concluído' : v === false ? 'Pendente' : 'A verificar';
  const refresh = () => { evidence.reload(); manualInss.reload(); onRefresh?.(); };
  return <section className="operacoes" aria-label="Operações">
    <div className="operacoes-cabecalho"><CompetenciaCarteira competencia={competencia} onChange={onChangeCompetencia} onRefresh={refresh} loading={loading} disabled={busy || approvalBusy} /></div>
    {error && <p role="alert">{error} Os indicadores ficam indisponíveis até a atualização.</p>}
    <section className="operacoes-progresso-total" aria-label="Progresso mensal">
      <p className="operacoes-total">{unavailable || manualUnavailable ? '—' : `${summary.items.length ? Math.round(summary.metrics.concluido.done.length / summary.items.length * 100) : 0}% · ${summary.metrics.concluido.done.length}/${summary.items.length}`} <small>empresas concluídas / elegíveis</small></p>
      <div className="operacoes-quatro-etapas">{[['apurar','Apurar','var(--accent-orange)'],['guias','Guias','var(--primary)'],['contabilizacao','Contabilização','var(--accent-purple)'],['concluido','Concluído','var(--state-ok)']].map(([key,label,color]) => <Progress stage key={key} label={label} color={color} metric={summary.metrics[key]} unavailable={unavailable || (['guias','concluido'].includes(key) && manualUnavailable)} onClick={() => show(key, label, 'stage')} />)}</div>
    </section>
    <div className="operacoes-layout">
      <div className="operacoes-etapas-pizzas">
        <section className="operacoes-etapa operacoes-apuracao" aria-label="Apuração">
          <button className="operacoes-titulo" aria-label="Apuração" onClick={() => show('apurar','Apuração','all')} disabled={unavailable}>Apuração</button>
          {[['calculado','Calculado'],['confirmado','Confirmado'],['transmitido','Transmitido']].map(([key,label]) => {
            const warnings = summary.items.filter(r => key === 'confirmado' ? r.operation?.status === 'INVALIDATED' : key === 'transmitido' && r.operation?.execution && r.operation.execution.status !== 'DONE');
            return <div className="operacoes-status-com-aviso" key={key}><Progress label={label} color="var(--state-ok)" metric={summary.metrics[key]} unavailable={unavailable || (key === 'confirmado' && (evidence.loading || Boolean(evidence.error)))} onClick={() => show(key,label)} />
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
          {CHECKLIST_OPERACOES.map(([key,label]) => <Progress key={key} label={label} color="var(--state-ok)" metric={summary.metrics[key]} unavailable={unavailable} onClick={() => show(key,label)} />)}
        </section>
        <div className="operacoes-quatro-pizzas">{[['parcelas','Parcelamento'],['fiscal','Situação fiscal'],['certificado','Certificado'],['procuracao','Procuração']].map(([key,title]) => <Pizza key={key} title={title} groups={distribution[key]} unavailable={unavailable} onSelect={group => setChart({ key, group, competencia })} />)}</div>
      </div>
      <OperationsRoutineCompanies api={api} companies={companies} competencia={competencia} loading={loading} error={error} onRefreshCompanies={refresh} />
    </div>
    {panel?.competencia === competencia && !unavailable && !(manualUnavailable && ['guias','concluido','disponivel','enviado','pago'].includes(panel.key)) && <Modal titulo={panel.title} tamanho="lg" className="operacoes-dialogo" aoFechar={closePanel}>
      <p>Competência {competencia} · {panelRows.length} empresas {panel.mode === 'warnings' ? 'com avisos nesta etapa' : panel.mode === 'stage' ? 'nesta etapa' : panel.mode === 'missing' ? 'com etapa pendente ou a verificar' : 'elegíveis'}</p>
      <label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <ul className="operacoes-lista-modal">{filtered.slice(page * 30, page * 30 + 30).map(row => <li key={row.company.companyId}>
        <div><strong>{nome(row.company)}</strong>
          {accountingPanel ? <><dl className="operacoes-checklists">{CHECKLIST_OPERACOES.map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{statusText(row.axes[key])}{row.fluxo.contabilizacao?.checklistAutomatico?.[key] ? ' · automática' : ''}</dd></div>)}</dl><small>Fechamento: {row.fluxo.contabilizacao?.rotulo || 'A verificar'} · Importação ERP: {row.fluxo.contabilizacao?.importados ?? '—'}/{row.fluxo.contabilizacao?.total ?? '—'}</small>{row.fluxo.contabilizacao?.conferenciaDesatualizada && <p role="status">Conferência desatualizada · revise a correção do mês fechado.</p>}</> : guidePanel ? <>
            {!row.guideSummary.completo && <p>Cobertura a verificar</p>}
            {row.axes.pago === 'na' && <p>Pagamento não aplicável: nenhum item de recolhimento neste recorte.</p>}
            {row.guideSummary.items.map(item => <small key={item.key}>{item.label} · Documento: {item.documento} · Envio: {item.comunicacao} · Pagamento: {item.pagamento}</small>)}
            {row.manualInss && <><small>INSS manual · {({PENDING_DOCUMENT:'Aguardando documento',DOCUMENT_REVIEW:'Documento para revisão',DOCUMENT_AVAILABLE:'Documento disponível',DOCUMENT_ABSENT:'Ausência registrada',NOT_APPLICABLE:'Não aplicável'})[row.manualInss.status] || 'A verificar'}</small><InternalLink href={link(row.company,'automacao')}>Configurar INSS manual</InternalLink><Button size="sm" variant="secondary" onClick={() => { const task = tasks.find(t => t.company.companyId === row.company.companyId && (t.manualInss || t.tag?.key === 'inss')); closePanel(); if (task) { open(task.categoria === 'faltantes' ? 'faltantes' : 'revisoes', task.id); } else { setSelection({ group: 'revisoes', id: `${row.company.companyId}:inss-detalhe`, manualCompanyId: row.company.companyId, competencia }); setPreview(false); setResult(null); } }}>Ver detalhes do INSS manual</Button></>}
            {groups.erros.filter(t => t.company.companyId === row.company.companyId).map(t => <Button size="sm" variant="secondary" key={t.id} onClick={() => { closePanel(); open('erros',t.id); }}>Conferir falha de {t.tag?.label}</Button>)}
          </> : <><small>Calculado: {statusText(row.axes.calculado)} · Confirmado: {statusText(row.axes.confirmado)} · Transmitido: {statusText(row.axes.transmitido)}</small><small>Origem: {row.fluxo.apuracao?.origem || (row.fluxo.apuracao?.porFora ? 'Receita Federal' : 'Projeção da competência')} · Revisão: {row.operation?.revision || 'a verificar'}</small>{row.operation?.blocked && <p>{row.operation.blocked}</p>}{row.operation?.execution?.message && <p>{row.operation.execution.message}</p>}<small>Obrigações: {(row.fluxo.obrigacoes || []).filter(o => !o.concluida).length} pendentes</small></>}
          <details><summary>Subetapas e evidências</summary><ul>{(row.fluxo.tarefas || []).map(t => <li key={t.chave}>{t.titulo} · {t.concluida ? 'Concluída' : 'Pendente'}{t.revisar ? ' · Revisar dados alterados' : ''}</li>)}</ul></details>
        </div>
        <div className="operacoes-acoes"><InternalLink href={link(row.company,accountingPanel ? 'lancamentos' : guidePanel ? 'guides' : 'cadastroFiscal')}>{accountingPanel ? 'Abrir contabilidade' : guidePanel ? 'Abrir Guias' : 'Abrir apuração'}</InternalLink>
          {!accountingPanel && !guidePanel && <><InternalLink href={link(row.company,'obrigacoes')}>Abrir obrigações</InternalLink>{['ACCOUNTANT','FIRM_ADMIN'].includes(row.company.myRole) && <Button size="sm" variant="secondary" disabled={!row.operation} onClick={() => { setApprovalRows([row]); closePanel(); setApprovalOpen(true); }}>Conferir e continuar rotina</Button>}</>}
        </div>
      </li>)}</ul>
      {!filtered.length && <p>Nenhuma empresa neste conjunto.</p>}
      {filtered.length > 30 && <div className="operacoes-acoes"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>{page + 1}/{Math.ceil(filtered.length / 30)}</span><Button variant="secondary" disabled={(page + 1) * 30 >= filtered.length} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}
    </Modal>}
    {active && !active.id && <Modal titulo={quadros.find(([key]) => key === active.group)?.[1]} aoFechar={close} className="operacoes-dialogo">
      <p>Competência {competencia} · {active.group === 'erros' ? `${errorCompanies.length} empresas` : `${groups[active.group].length} itens`}</p><ul className="operacoes-lista-modal">{(active.group === 'erros' ? errorCompanies : [...new Map(groups[active.group].map(t => [t.company.companyId,t.company])).values()]).map(company => <li key={company.companyId}><div><strong>{nome(company)}</strong>{groups[active.group].filter(t => t.company.companyId === company.companyId).map(t => <div key={t.id}><small>{t.titulo}</small><span>{t.tag?.envioErro || t.tag?.emailLastError || ''}</span><Button size="sm" variant="secondary" onClick={() => open(active.group,t.id)}>Ver detalhes</Button></div>)}</div></li>)}</ul>{!groups[active.group].length && <p>Nenhum item nesta categoria.</p>}
    </Modal>}
    {chart?.competencia === competencia && !unavailable && (() => {
      const group = distribution[chart.key].find(g => g.key === chart.group);
      return <Modal titulo={`${group.label} · ${group.items.length} empresas`} aoFechar={() => setChart(null)} className="operacoes-dialogo">
        <ul className="operacoes-lista-modal">{group.items.map(({company}) => <li key={company.companyId}><strong>{nome(company)}</strong>{chart.key === 'procuracao' ? <div><small>Validade documental: {company.serproStatus?.validUntil || 'a verificar'}. Elegibilidade operacional depende de revalidação.</small><Button size="sm" variant="secondary" onClick={() => { setChart(null); setProcuracao(company); }}>Pedir procuração</Button></div> : <InternalLink href={link(company,({parcelas:'parcelamento',fiscal:'sitfis',certificado:'certificado'})[chart.key])}>{chart.key === 'certificado' ? 'Configurar certificado' : chart.key === 'fiscal' ? 'Abrir situação fiscal' : 'Abrir parcelamento'}</InternalLink>}</li>)}</ul>{!group.items.length && <p>Nenhum item neste grupo.</p>}
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
            <InternalLink href={link(selected.company, selected.tipo === 'apuracoes' ? 'cadastroFiscal' : 'guides')}>{selected.tipo === 'apuracoes' ? 'Abrir apuração' : 'Abrir Guias e corrigir'}</InternalLink>
            <InternalLink href={link(selected.company, 'automacao')}>{selected.manualInss || selected.tag?.key === 'inss' ? 'Configurar INSS manual' : 'Configurar consultas'}</InternalLink>
          </div>}
        </> : <ul className="operacoes-lista-modal">{groups[active.group].map(t => <li key={t.id}><div><strong>{nome(t.company)}</strong><small>{t.titulo}</small></div><Button size="sm" variant="secondary" onClick={() => open(active.group, t.id)}>Ver detalhes</Button></li>)}{!groups[active.group].length && <li>Nenhum item nesta categoria.</li>}</ul>}
      </div>
    </Modal>}
  </section>;
}
