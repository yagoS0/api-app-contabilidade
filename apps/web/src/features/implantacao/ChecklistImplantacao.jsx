import { SITUACOES } from './ChecklistImplantacao.shared.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared.js';
import './implantacao.css';


const titulo = t => t.titulo === 'Configurar certificado A1' ? 'Configurar certificado' : t.titulo;
const encerrada = t => ['CONCLUIDO', 'NAO_SE_APLICA'].includes(t.status);
const campos = t => ({ status: t.status, responsavel: t.responsavel || '', prazo: t.prazo || '', pendencia: t.pendencia || '', versao: t.versao });
const data = v => v ? String(v).slice(0, 10).split('-').reverse().join('/') : 'Sem prazo';

function EditorTarefa({ tarefa, api, companyId, onSalvar, onFechar }) {
  const [form, setForm] = useState(() => campos(tarefa));
  const [base, setBase] = useState(() => campos(tarefa));
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [remoto, setRemoto] = useState(null);
  const vivo = useRef(true), situacaoRef = useRef(null);
  useEffect(() => { situacaoRef.current?.focus(); }, []);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEdicaoPendente(JSON.stringify(form) !== JSON.stringify(base));
  const mudar = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function salvar(e) {
    e.preventDefault(); if (ocupado) return;
    setOcupado(true); setErro(''); setRemoto(null);
    try {
      const r = await api.salvarImplantacao(companyId, tarefa.chave, form);
      if (!r?.implantacao?.tarefas) throw new Error('Não foi possível confirmar o salvamento. Confira a versão salva.');
      if (vivo.current) onSalvar(r.implantacao);
    } catch (e) { if (vivo.current) setErro(e.message || 'Não foi possível salvar. Sua edição foi preservada.'); }
    finally { if (vivo.current) setOcupado(false); }
  }
  async function conferir() {
    setOcupado(true);
    try {
      const r = await api.getImplantacao(companyId);
      const t = r?.implantacao?.tarefas?.find(x => x.chave === tarefa.chave);
      if (!t) throw new Error('Não foi possível localizar a tarefa salva.');
      if (vivo.current) setRemoto(t);
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { if (vivo.current) setOcupado(false); }
  }
  return <form onSubmit={salvar} className="implantacao-editor">
    <fieldset disabled={ocupado}>
      <legend>Atualizar tarefa</legend>
      <div className="implantacao-campos">
        <label>Situação<select ref={situacaoRef} value={form.status} onChange={e => mudar('status', e.target.value)}>{Object.entries(SITUACOES).map(([v, texto]) => <option key={v} value={v}>{texto}</option>)}</select></label>
        <label>Responsável<input maxLength={120} value={form.responsavel} required={form.status === 'AGENDADO'} onChange={e => mudar('responsavel', e.target.value)} placeholder="Nome da pessoa ou equipe" /></label>
        <label>Prazo<input type="date" value={form.prazo} required={form.status === 'AGENDADO'} onChange={e => mudar('prazo', e.target.value)} /></label>
        <label className="implantacao-pendencia">Pendência ou observação<textarea rows={3} maxLength={3000} value={form.pendencia} required={['AGUARDANDO_CLIENTE', 'NAO_SE_APLICA'].includes(form.status)} onChange={e => mudar('pendencia', e.target.value)} /></label>
      </div>
      <p>Agendamentos exigem responsável e prazo. Registre o que falta do cliente ou o motivo de não se aplicar. Não inclua senhas.</p>
      {erro && <div role="alert"><p>{erro}</p><Button type="button" variant="secondary" onClick={conferir}>Conferir versão salva</Button></div>}
      {remoto && <div className="implantacao-conflito"><h4>Versão atualmente salva</h4>
        <p>{SITUACOES[remoto.status]} · {remoto.responsavel || 'Sem responsável'} · {data(remoto.prazo)}</p><p>{remoto.pendencia || 'Sem observação'}</p>
        <p>Sua edição permanece acima. Escolha qual versão continuar antes de salvar novamente.</p>
        <div className="implantacao-acoes"><Button type="button" variant="secondary" onClick={() => { const c = campos(remoto); setForm(c); setBase(c); setRemoto(null); setErro(''); }}>Usar os dados salvos</Button>
        <Button type="button" variant="secondary" onClick={() => { setBase(campos(remoto)); setForm(f => ({ ...f, versao: remoto.versao })); setRemoto(null); setErro(''); }}>Manter minha edição para substituir esses dados</Button></div>
      </div>}
      <div className="implantacao-acoes"><Button type="button" variant="secondary" onClick={onFechar}>Cancelar edição</Button><Button type="submit" disabled={Boolean(remoto)}>{ocupado ? 'Salvando…' : 'Salvar tarefa'}</Button></div>
    </fieldset>
  </form>;
}

export function ChecklistImplantacao({ api, companyId, podeEditar = true }) {
  const [estado, setEstado] = useState(null), [erro, setErro] = useState(''), [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(null), [filtro, setFiltro] = useState('pendentes');
  const pedido = useRef(0), filtroRef = useRef(null), gatilhos = useRef(new Map()), retorno = useRef(null);
  function encerrarEdicao() { retorno.current = editando; setEditando(null); }
  useEffect(() => {
    if (editando || !retorno.current) return;
    (gatilhos.current.get(retorno.current) || filtroRef.current)?.focus();
    retorno.current = null;
  }, [editando]);
  const carregar = useCallback(async () => {
    const seq = ++pedido.current;
    setCarregando(true); setErro('');
    try {
      const r = await api.getImplantacao(companyId);
      if (!Array.isArray(r?.implantacao?.tarefas)) throw new Error('A consulta da implantação está indisponível.');
      if (seq === pedido.current) setEstado({ id: companyId, dados: r.implantacao });
    } catch (e) { if (seq === pedido.current) { setEstado(null); setErro(e.message || 'Não foi possível consultar a implantação.'); } }
    finally { if (seq === pedido.current) setCarregando(false); }
  }, [api, companyId]);
  useEffect(() => { const pedidoDaExecucao = pedido; setEditando(null); carregar(); return () => { pedidoDaExecucao.current++; }; }, [carregar, api, companyId]);
  const dados = estado?.id === companyId ? estado.dados : null;
  const tarefas = (dados?.tarefas || []).filter(t => t.chave === editando || filtro === 'todas' || (filtro === 'atrasadas' ? t.atrasada : filtro === 'aguardando' ? t.status === 'AGUARDANDO_CLIENTE' : !encerrada(t)));
  return <section className="implantacao" aria-label="Checklist de implantação">
    <div className="implantacao-cabecalho"><h2>Implantação da empresa</h2><Button type="button" variant="secondary" disabled={carregando || Boolean(editando)} onClick={carregar}>Atualizar checklist</Button></div>
    {carregando ? <p role="status">Carregando implantação…</p> : erro ? <p role="alert">{erro}</p> : dados && <>
      <p role="status">Pendentes: {dados.resumo.pendentes} · Atrasadas: {dados.resumo.atrasadas} · Sem responsável: {dados.resumo.semResponsavel} · Concluídas: {dados.resumo.concluidas}</p>
      <label className="implantacao-filtro">Mostrar<select ref={filtroRef} value={filtro} disabled={Boolean(editando)} onChange={e => setFiltro(e.target.value)}><option value="pendentes">Pendentes</option><option value="atrasadas">Atrasadas</option><option value="aguardando">Aguardando cliente</option><option value="todas">Todas, incluindo concluídas</option></select></label>
      {!tarefas.length && <p>Nenhuma tarefa neste filtro.</p>}
      <ul className="implantacao-lista">{tarefas.map(t => <li key={t.chave}>
        <div className="implantacao-linha"><h3>{titulo(t)}</h3>
          <div className="implantacao-acoes">
            {t.destino && <a className="btn btn-secondary btn-md" href={`/companies/${encodeURIComponent(companyId)}/${t.destino}`}>Abrir configuração</a>}
            {editando !== t.chave && podeEditar && dados.podeEditar !== false && <Button ref={el => { if (el) gatilhos.current.set(t.chave, el); else gatilhos.current.delete(t.chave); }} type="button" variant="secondary" disabled={Boolean(editando)} onClick={() => setEditando(t.chave)}>Atualizar tarefa<span className="sr-only">: {titulo(t)}</span></Button>}
          </div>
        </div>
        <dl className="implantacao-resumo-tarefa">
          <div><dt>Situação</dt><dd>{SITUACOES[t.status] || t.status}</dd></div>
          <div><dt>Responsável</dt><dd>{t.responsavel || 'Sem responsável'}</dd></div>
          <div><dt>Prazo</dt><dd className={t.atrasada ? 'implantacao-atrasada' : undefined}>{data(t.prazo)}{t.atrasada ? ' · Atrasada' : ''}</dd></div>
        </dl>
        {t.pendencia && <p className="implantacao-observacao">{t.pendencia}</p>}
        {editando === t.chave && <>
        {t.origem && <details><summary>Registro aproveitado do onboarding</summary><p>{t.origem.titulo} · {t.origem.concluidaEm ? `Conclusão registrada em ${data(t.origem.concluidaEm)}` : 'Pendente na conversão'}</p>{t.origem.observacao && <p>{t.origem.observacao}</p>}</details>}
        {t.historico?.length > 0 && <details><summary>Histórico de acompanhamento</summary><ul>{[...t.historico].reverse().map((h, i) => <li key={i}>{data(h.em)} · {SITUACOES[h.depois.status]} · {h.depois.responsavel || 'Sem responsável'} · {data(h.depois.prazo)}{h.depois.pendencia ? ` · ${h.depois.pendencia}` : ''}</li>)}</ul></details>}
        <EditorTarefa key={`${companyId}:${t.chave}`} tarefa={t} api={api} companyId={companyId} onFechar={encerrarEdicao} onSalvar={d => { setEstado({ id: companyId, dados: d }); encerrarEdicao(); }} />
        </>}

      </li>)}</ul>
    </>}
  </section>;
}
