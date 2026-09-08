import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { cicloRecorrente } from '../lib/janelaRecorrente';
import { ModalObrigacao } from './ModalObrigacao';
import { RegrasObrigacao } from './renderRegrasObrigacao';

const fmt = value => value?.slice(0, 10).split('-').reverse().join('/') || '—';
const campo = { padding: 10, minHeight: 40, background: 'var(--bg-page)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 };
function conferir(out) { if (out?.ok === false) throw new Error(out.message || 'Não foi possível concluir a operação.'); return out; }

/** Todo o trabalho permanece sobre o calendário. Um modal de formulário substitui o da lista. */
export function CalendarioObrigacoesModal({ api, empresas = [], contexto = {}, onClose, onChanged }) {
  const cargaId = useRef(0);
  const [dados, setDados] = useState(null), [erro, setErro] = useState(null), [ocupado, setOcupado] = useState(false);
  const [empresa, setEmpresa] = useState(contexto.companyId || ''), [busca, setBusca] = useState('');
  const [editar, setEditar] = useState(contexto.criar ? { companyId: contexto.companyId, dataInicio: contexto.dataInicio, dataFim: contexto.dataFim } : null);
  const [excluir, setExcluir] = useState(null), [alcance, setAlcance] = useState('ESTA');
  const [detalheId, setDetalheId] = useState(contexto.ocorrenciaId || null);
  const [expandidas, setExpandidas] = useState({});
  const [todoPeriodo, setTodoPeriodo] = useState(false);
  const [regras, setRegras] = useState(false), [aviso, setAviso] = useState('');
  const carregar = useCallback(async () => {
    const id = ++cargaId.current;
    setErro(null); setDados(null);
    try { const out = conferir(await api.listObrigacoes({ companyId: empresa || undefined })); if (id === cargaId.current) setDados(out); }
    catch (e) { if (id === cargaId.current) setErro(e.message); }
  }, [api, empresa]);
  useEffect(() => { carregar(); return () => { cargaId.current++; }; }, [carregar]);
  async function acao(executar) {
    setOcupado(true); setErro(null);
    try { const out = conferir(await executar()); await carregar(); onChanged?.(); return out; }
    catch (e) { setErro(e.message); return null; }
    finally { setOcupado(false); }
  }
  function abrirEdicao(o, oc) {
    const ciclo = cicloRecorrente(oc, o);
    const versoes = (o.agendaVersoes || []).filter(v => v.aPartirDe <= ciclo);
    setEditar({ ...o, ...oc, janelaTrabalho: versoes.length ? versoes[versoes.length - 1].janela : o.janelaTrabalho, ...(o.periodicidade === 'AVULSA' ? { ocorrenciaId: undefined } : {}) });
  }
  async function salvar(form) {
    const corpo = { ...form, verificador: form.verificador || null };
    const out = await acao(() => editar.ocorrenciaId
      ? api.updateOcorrencia(editar.ocorrenciaId, form.alcance === 'ESTA_E_PROXIMAS'
        ? { alcance: form.alcance, janelaTrabalho: form.janelaTrabalho }
        : { dataInicio: form.dataInicio, dataFim: form.dataFim })
      : editar.obrigacaoId ? api.updateObrigacao(editar.obrigacaoId, corpo) : api.createObrigacao(form.companyId, corpo));
    if (out) { setEditar(null); setDetalheId(null); setTodoPeriodo(true); setAviso('Salvo no calendário. Mostrando todos os períodos para incluir o item salvo.'); }
  }
  if (editar) return <ModalObrigacao empresas={empresas} opcoes={dados?.opcoes} inicial={editar} onFechar={() => { setEditar(null); setErro(null); }} onSalvar={salvar} salvando={ocupado} erro={erro} />;
  if (excluir) return <Modal titulo="Excluir da agenda" aoFechar={() => setExcluir(null)} ocupado={ocupado} tamanho="sm">
    <p><strong>{excluir.nome}</strong> · {fmt(excluir.dataInicio)} até {fmt(excluir.dataFim)}</p>
    {excluir.periodicidade !== 'AVULSA' && <label>Alcance<select style={{ ...campo, width: '100%' }} value={alcance} onChange={e => setAlcance(e.target.value)}><option value="ESTA">Somente esta ocorrência</option><option value="ESTA_E_PROXIMAS">Esta e as próximas</option></select></label>}
    <p>Ocorrências concluídas são preservadas no histórico. As excluídas não serão recriadas pela repetição.</p>
    {erro && <p role="alert">{erro}</p>}
    <Button disabled={ocupado} onClick={async () => {
      const out = await acao(() => api.excluirOcorrencia(excluir.ocorrenciaId, { alcance }));
      if (out) { setExcluir(null); setAviso(`${out.canceladas ?? 1} ocorrência(s) retirada(s) da agenda. Concluídas preservadas.`); }
    }}>Confirmar exclusão</Button>
  </Modal>;
  if (regras) return <RegrasObrigacao emModal api={api} empresas={empresas} onVoltar={() => { setRegras(false); carregar(); onChanged?.(); }} />;
  const visiveis = o => (o.ocorrencias || []).filter(oc => detalheId ? oc.ocorrenciaId === detalheId : todoPeriodo || ((!contexto.dataInicio || (oc.dataFim || oc.dataVencimento) >= contexto.dataInicio) && (!contexto.dataFim || (oc.dataInicio || oc.dataVencimento) <= contexto.dataFim)));
  const lista = (dados?.obrigacoes || []).filter(o => visiveis(o).length).filter(o => `${o.nome} ${o.empresa || ''}`.toLowerCase().includes(busca.toLowerCase()));
  return <Modal titulo="Tarefas e obrigações" aoFechar={onClose} ocupado={ocupado} tamanho="lg">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <label>Empresa<select style={campo} value={empresa} onChange={e => setEmpresa(e.target.value)}><option value="">Todas as empresas</option>{empresas.map(e => <option key={e.companyId || e.id} value={e.companyId || e.id}>{e.razao}</option>)}</select></label>
      <label>Buscar<input style={campo} value={busca} onChange={e => setBusca(e.target.value)} /></label>
      <Button onClick={() => setEditar({ companyId: empresa, dataInicio: contexto.dataInicio, dataFim: contexto.dataFim })}>Nova tarefa ou obrigação</Button>
      {(detalheId || !todoPeriodo) && <Button onClick={() => { setDetalheId(null); setTodoPeriodo(true); }}>Ver todas as ocorrências</Button>}
      <Button onClick={() => setRegras(true)}>Regras e recorrências</Button>
    </div>
    {erro && <p role="alert">{erro} <Button onClick={carregar}>Tentar novamente</Button></p>}
    {aviso && <p role="status">{aviso}</p>}
    {!dados && !erro && <p role="status">Carregando tarefas e obrigações…</p>}
    {dados && !lista.length && <p>Nenhuma tarefa ou obrigação neste filtro.</p>}
    {lista.map(o => <section key={o.obrigacaoId} style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 8 }}>
      <h3 style={{ margin: 0 }}>{o.nome}</h3><p>{o.empresa} · {o.periodicidade === 'AVULSA' ? 'Sem repetição' : o.periodicidade.toLowerCase()}</p>
      {o.descricao && <p>{o.descricao}</p>}
      {(expandidas[o.obrigacaoId] ? visiveis(o) : visiveis(o).slice(0, 3)).map(oc => <div key={oc.ocorrenciaId} style={{ padding: '12px 0', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: contexto.ocorrenciaId === oc.ocorrenciaId ? 'var(--bg-page)' : undefined }}>
        <div style={{ flex: '1 1 230px' }}><strong>{fmt(oc.dataInicio)} até {fmt(oc.dataFim)}</strong><br />{o.tipo === 'TAREFA' ? 'Prazo' : 'Vencimento fiscal'}: {fmt(oc.dataVencimento)} · {oc.situacao === 'CONCLUIDA' ? 'Concluída' : oc.situacao === 'VENCIDA' ? 'Vencida' : 'Pendente'}</div>
        {!o.conclusaoAutomatica && <Button disabled={ocupado} onClick={() => acao(() => oc.situacao === 'CONCLUIDA' ? api.reabrirOcorrencia(oc.ocorrenciaId) : api.concluirOcorrencia(oc.ocorrenciaId))}>{oc.situacao === 'CONCLUIDA' ? 'Reabrir' : 'Concluir'}</Button>}
        {oc.situacao !== 'CONCLUIDA' && <><Button disabled={ocupado} onClick={() => abrirEdicao(o, oc)}>Editar</Button><Button disabled={ocupado} onClick={() => { setAlcance('ESTA'); setExcluir({ ...o, ...oc }); }}>Excluir</Button></>}
      </div>)}
      {visiveis(o).length > 3 && <Button onClick={() => setExpandidas(x => ({ ...x, [o.obrigacaoId]: !x[o.obrigacaoId] }))}>{expandidas[o.obrigacaoId] ? "Recolher" : `Ver todas as ${visiveis(o).length} ocorrências`}</Button>}
    </section>)}
  </Modal>;
}
