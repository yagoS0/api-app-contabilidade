import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { projetarOperacoesEmpresas } from './operacoes';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { ofertaDeRetentativa } from '../guides/lib/canalDeEnvio';
import './operacoes.css';
import { OperationsApproval } from './OperationsApproval';
import { OperationsAlerts } from './OperationsAlerts';
import { OperationsRoutineCompanies } from './OperationsRoutineCompanies';
import { OperationsDailyCalendar } from './OperationsDailyCalendar';

const quadros = [['concluidas', 'Empresas concluídas'], ['apuracoes', 'Apurações pendentes'], ['pendencias', 'Pendências de guias'], ['erros', 'Erros de envio de guias']];
const nome = c => c.razao || c.razaoSocial || c.nome || c.cnpj;

export function OperationsPage({ api, companies = [], competencia, loading = false, error, onRefresh, onChangeCompetencia, onOpenCompany, acoesGuia = {} }) {
  const { rows, tasks, groups } = projetarOperacoesEmpresas(companies, competencia);
  const [selection, setSelection] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const sending = useRef(false);
  const unavailable = loading || Boolean(error);
  const active = selection?.competencia === competencia && !unavailable ? selection : null;
  const selected = active?.id ? [...tasks, ...groups.concluidas].find(t => t.id === active.id) : null;
  const open = (group, id = null) => { setSelection({ group, id, competencia }); setPreview(false); setResult(null); };
  const close = () => { if (!busy) { setSelection(null); setPreview(false); setResult(null); } };
  const link = (company, tab) => `${companyTabPath(company.companyId, tab)}?competencia=${encodeURIComponent(competencia || '')}`;
  const whatsapp = selected?.tag?.canalEnvio === 'WHATSAPP' && selected?.tag?.envioStatus === 'falhou';
  const offer = ofertaDeRetentativa(selected?.tag);
  const send = whatsapp ? acoesGuia.onEnviarWhatsapp : acoesGuia.onEnviar;
  const sendIdentity = JSON.stringify([competencia, selected?.company.companyId, selected?.tag?.guideId, whatsapp, selected?.tag?.envioErro, selected?.tag?.emailLastError]);
  async function enviar() {
    if (sending.current || !preview || !selected?.tag?.guideId || !send || (whatsapp && !offer.habilitado)) return;
    if (preview !== sendIdentity) { setPreview(false); setResult({ error: true, message: 'A guia ou o resultado mudou. Confira os dados atualizados em Guias antes de enviar.' }); return; }
    sending.current = true;
    setBusy(true); setResult(null);
    try {
      const out = await send(selected.tag.guideId, selected.company);
      setResult({ error: out?.ok !== true, message: out?.message || 'Confira o resultado na aba Guias antes de uma nova ação.' });
    } catch { setResult({ error: true, message: 'Não foi possível confirmar o envio. Confira o histórico em Guias antes de repetir.' }); }
    finally { sending.current = false; setBusy(false); setPreview(false); }
  }
  return <section className="operacoes" aria-label="Central de Operações">
    <div className="operacoes-resumo">
      <div className="operacoes-cabecalho"><h2>Central de Operações</h2><Button variant="secondary" disabled={unavailable} onClick={() => setApprovalOpen(true)}>Conferir e liberar apurações</Button></div>
      <div className="operacoes-cabecalho"><label>Competência <input type="month" value={competencia || ''} disabled={busy} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) onChangeCompetencia?.(e.target.value); }} /></label><Button variant="secondary" onClick={onRefresh} disabled={loading || busy}>Atualizar empresas</Button></div>
      {error && <p role="alert">{error} Os indicadores ficam indisponíveis até a atualização.</p>}
      <div className="operacoes-indicadores">{quadros.map(([key, label]) => <button type="button" className="operacoes-quadro" key={key} disabled={unavailable} aria-haspopup="dialog" onClick={() => open(key)}>
        <span>{label}</span><strong className={key === 'erros' && groups[key].length ? 'operacoes-erro' : ''}>{unavailable ? '—' : groups[key].length}</strong><small>{key === 'erros' || key === 'pendencias' ? 'Ver e resolver' : 'Ver empresas'} ↗</small>
      </button>)}<OperationsAlerts api={api} /></div>
    </div>
    <OperationsRoutineCompanies api={api} companies={companies} loading={loading} error={error} />
    <OperationsDailyCalendar api={api} empresas={companies} onOpenCompany={onOpenCompany} />
    {approvalOpen && <Modal titulo="Conferir e liberar apurações" tamanho="lg" className="operacoes-dialogo" ocupado={approvalBusy} aoFechar={() => !approvalBusy && setApprovalOpen(false)} rodape={<Button variant="secondary" disabled={approvalBusy} onClick={() => setApprovalOpen(false)}>Fechar</Button>}>
      {!unavailable ? <OperationsApproval embedded key={competencia} api={api} rows={rows} competencia={competencia} onChanged={onRefresh} onBusyChange={setApprovalBusy} /> : <p role="alert">Atualize as empresas antes de conferir apurações.</p>}
    </Modal>}
    {active && <Modal titulo={selected ? `${nome(selected.company)} · ${selected.titulo}` : quadros.find(([key]) => key === active.group)?.[1]} aoFechar={close} ocupado={busy} tamanho="md" className="operacoes-dialogo" rodape={<Button variant="secondary" disabled={busy} onClick={close}>Fechar</Button>}>
      <div className="operacoes">
        <p>Competência {competencia}</p>
        {result && <p role={result.error ? 'alert' : 'status'}>{result.message}</p>}
        {active.id && !selected ? <p role="status">Este item não está mais pendente na lista atualizada.</p> : selected ? <>
          <p>Apuração: <strong>{selected.fluxo.apuracao.rotulo}</strong> · Contabilidade: {selected.fluxo.contabilizacao.rotulo}</p>
          {selected.tipo === 'erros' && <>
            <p className="operacoes-erro">{selected.tag.envioErro || selected.tag.emailLastError || 'O envio falhou. O provedor não informou o motivo.'}</p>
            <p>{whatsapp ? 'WhatsApp' : 'Envio pelos canais cadastrados'} · A guia já existe. A falha de envio não desfaz a apuração.</p>
            {whatsapp && <p>{offer.frase}</p>}
            {preview ? <div className="operacoes-previa"><h3>Conferir novo envio</h3><p>{selected.tag.label} de {nome(selected.company)} · {competencia}</p><p>{whatsapp ? 'Somente WhatsApp, para os destinos com falha.' : 'Liberar a guia e enviar pelos canais cadastrados, conforme o fluxo atual.'} Será usado o documento salvo, sem buscar outro DAS ou extrato.</p><div className="operacoes-acoes"><Button disabled={busy} onClick={enviar}>{busy ? 'Enviando…' : 'Confirmar envio'}</Button><Button variant="secondary" disabled={busy} onClick={() => setPreview(false)}>Cancelar</Button></div></div>
              : !result && send && selected.tag.guideId && <Button disabled={whatsapp && !offer.habilitado} onClick={() => setPreview(sendIdentity)}>Conferir novo envio</Button>}
          </>}
          {selected.tipo === 'pendencias' && <p>{selected.tag?.state === 'missing' ? 'Confira ou anexe o documento na aba Guias. A ausência do arquivo não comprova falta de apuração.' : selected.tag?.state === 'gerada' ? 'Documento disponível. Confira o destino e a liberação na aba Guias.' : 'Confira o detalhe desta pendência na empresa.'}</p>}
          {!busy && <div className="operacoes-acoes operacoes-destinos">
            <InternalLink href={link(selected.company, selected.tipo === 'apuracoes' ? 'cadastroFiscal' : 'guides')}>{selected.tipo === 'apuracoes' ? 'Abrir apuração' : 'Abrir Guias e corrigir'}</InternalLink>
            <InternalLink href={link(selected.company, 'automacao')}>Configurar consultas</InternalLink>
          </div>}
        </> : <ul className="operacoes-lista-modal">{groups[active.group].map(t => <li key={t.id}><div><strong>{nome(t.company)}</strong><small>{t.titulo}</small></div><Button size="sm" variant="secondary" onClick={() => open(active.group, t.id)}>Ver detalhes</Button></li>)}{!groups[active.group].length && <li>Nenhum item nesta categoria.</li>}</ul>}
      </div>
    </Modal>}
  </section>;
}
