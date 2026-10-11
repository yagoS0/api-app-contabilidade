import { useEffect, useRef, useState } from 'react';
import { createApiClient } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { REGIMES_REFORMA, FORMAS_IBSCBS, SITUACOES_REFORMA, EMISSOR_REFORMA, validarCadastroReforma } from '@contabilidade/shared/reforma-cadastro';
import './reforma.css';
import { BaseApuracaoConsumo } from './BaseApuracaoConsumo';
const apiPadrao = createApiClient();
const opcoes = lista => Object.entries(lista).map(([k, v]) => <option key={k} value={k}>{v}</option>);
export function CadastroReforma(props) { return <Cadastro key={props.companyId} {...props} />; }
function Cadastro({ companyId, api = apiPadrao }) {
  const [carga, setCarga] = useState(null), [dados, setDados] = useState(null);
  const [erro, setErro] = useState(''), [aviso, setAviso] = useState(''), [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0), [editando, setEditando] = useState(false);
  const vivo = useRef(true), salvando = useRef(false), intencao = useRef(null);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let cancelada = false; setErro(''); setCarga(null);
    Promise.resolve().then(() => api.getCadastroReforma(companyId)).then(r => { if (cancelada) return; if (!r?.ok || !r.dados) throw new Error('Resposta de cadastro inválida.'); setCarga(r); setDados({ ...r.dados, motivo: '' }); setEditando(false); intencao.current = null; })
      .catch(e => { if (!cancelada) setErro(e.message || 'Não foi possível carregar o cadastro.'); });
    return () => { cancelada = true; };
  }, [api, companyId, recarga]);
  function mudar(patch) { setDados(d => ({ ...d, ...patch })); setEditando(true); setAviso(''); intencao.current = null; }
  function mudarPeriodo(i, patch) { mudar({ periodos: dados.periodos.map((p, j) => i === j ? { ...p, ...patch } : p) }); }
  async function salvar(e) {
    e.preventDefault(); if (salvando.current) return;
    setErro(''); setAviso('');
    let normalizado;
    try { normalizado = validarCadastroReforma(dados); } catch (err) { setErro(err.message); return; }
    salvando.current = true; setOcupado(true);
    const id = intencao.current || (intencao.current = crypto.randomUUID());
    try {
      const r = await api.salvarCadastroReforma(companyId, { id, versao: carga.versao, dados: normalizado });
      if (!r?.ok || !r.revisao) throw new Error('Gravação sem confirmação. Confira o histórico antes de tentar novamente.');
      if (!vivo.current) return;
      setCarga(c => ({ ...c, versao: r.revisao.versao, dados: r.revisao.dados, historico: [r.revisao, ...c.historico.filter(h => h.id !== r.revisao.id)] }));
      setDados({ ...r.revisao.dados, motivo: '' }); setEditando(false); intencao.current = null;
      setAviso('Revisão registrada no histórico.');
    } catch (err) { if (vivo.current) setErro(err.message || 'Não foi possível confirmar a gravação.'); }
    finally { salvando.current = false; if (vivo.current) setOcupado(false); }
  }
  useEffect(() => {
    if (!editando) return;
    const prevenir = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', prevenir); return () => window.removeEventListener('beforeunload', prevenir);
  }, [editando]);
  return <section className="reforma" aria-label="Cadastro da reforma tributária">
    <h3>Reforma tributária · enquadramento e histórico</h3>
    <p>Registre o regime de cada período e a forma de apuração de IBS/CBS. Este registro documenta a conferência do escritório; a opção oficial é feita no portal fiscal.</p>
    <p><small>As vigências alimentam o painel e o verificador. A emissão e a apuração continuam usando os respectivos cadastros fiscais nesta etapa.</small></p>
    {carga?.demonstracao && <p className="reforma-alert">Demonstração: alterações mantidas somente nesta sessão.</p>}
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {!carga ? <>{!erro && <p role="status">Carregando histórico…</p>}<Button variant="secondary" onClick={() => setRecarga(v => v + 1)}>Recarregar cadastro</Button></> : <>
      <form onSubmit={salvar}>
        <fieldset disabled={ocupado || !carga.podeEditar}>
          <legend>Vigências cadastradas</legend>
          {!dados.periodos.length && <p>Nenhum período informado. O regime atual da ficha não comprova o histórico.</p>}
          {dados.periodos.map((p, i) => <fieldset key={i}>
            <legend>Período {i + 1}</legend>
            <div className="reforma-grid">
              <label>Início da vigência<input type="date" required value={p.inicio} onChange={e => mudarPeriodo(i, { inicio: e.target.value })} /></label>
              <label>Fim da vigência (opcional)<input type="date" value={p.fim || ''} onChange={e => mudarPeriodo(i, { fim: e.target.value })} /></label>
              <label>Regime da empresa<select value={p.regime} onChange={e => mudarPeriodo(i, { regime: e.target.value, forma: 'PENDENTE', situacao: 'EM_ESTUDO' })}>{opcoes(REGIMES_REFORMA)}</select></label>
              <label>Forma de apuração IBS/CBS<select value={p.forma} onChange={e => mudarPeriodo(i, { forma: e.target.value })}>{opcoes(FORMAS_IBSCBS)}</select></label>
              <label>Situação<select value={p.situacao} onChange={e => mudarPeriodo(i, { situacao: e.target.value })}>{opcoes(SITUACOES_REFORMA)}</select></label>
            </div>
            <label>Protocolo ou referência do comprovante<textarea rows={2} maxLength={1500} value={p.evidencia} onChange={e => mudarPeriodo(i, { evidencia: e.target.value })} placeholder="Ex.: protocolo e nome do arquivo guardado em Documentos da empresa" /></label>
            <div className="reforma-actions"><Button type="button" variant="secondary" size="sm" onClick={() => mudar({ periodos: dados.periodos.filter((_, j) => i !== j) })}>Remover da próxima revisão</Button></div>
          </fieldset>)}
          <Button type="button" variant="secondary" onClick={() => mudar({ periodos: [...dados.periodos, { inicio: '', fim: '', regime: 'SIMPLES', forma: 'PENDENTE', situacao: 'EM_ESTUDO', evidencia: '' }] })}>Adicionar período</Button>
          <div className="reforma-grid">
            <label>Preparação do emissor<select value={dados.emissor} onChange={e => mudar({ emissor: e.target.value })}>{opcoes(EMISSOR_REFORMA)}</select></label>
            <label>Evidência da conferência do emissor<textarea rows={2} maxLength={1500} value={dados.evidenciaEmissor} onChange={e => mudar({ evidenciaEmissor: e.target.value })} /></label>
          </div>
          <label>Motivo da revisão<textarea required rows={2} maxLength={1500} value={dados.motivo} onChange={e => mudar({ motivo: e.target.value })} /></label>
          {carga.podeEditar && <div className="reforma-actions"><Button type="submit" disabled={ocupado || !editando}>{ocupado ? 'Registrando…' : 'Registrar revisão'}</Button><span>{editando ? 'Há alterações não salvas.' : `Revisão atual: ${carga.versao}`}</span></div>}
        </fieldset>
      </form>
      <details><summary>Histórico de revisões ({carga.versao})</summary>
        {carga.historicoLimitado && <p>Exibindo as 100 revisões mais recentes. As anteriores continuam preservadas no banco.</p>}
        {carga.historico.map(h => <details key={h.id}><summary>Revisão {h.versao} · {h.createdByName} · {new Date(h.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</summary>
          <p className="reforma-evidence">{h.dados.motivo}</p>
          {h.dados.periodos.map((p, i) => <p key={i} className="reforma-evidence">{p.inicio} a {p.fim || 'sem término'} · {REGIMES_REFORMA[p.regime]} · {FORMAS_IBSCBS[p.forma]} · {SITUACOES_REFORMA[p.situacao]}<br />{p.evidencia || 'Sem comprovante informado.'}</p>)}
          <p className="reforma-evidence">{EMISSOR_REFORMA[h.dados.emissor]} · {h.dados.evidenciaEmissor || 'Sem evidência do emissor.'}</p>
        </details>)}
      </details>
      <div className="reforma-actions"><Button type="button" variant="secondary" disabled={ocupado || editando} onClick={() => setRecarga(v => v + 1)}>Recarregar histórico</Button>{editando && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => { setDados({ ...carga.dados, motivo: '' }); setEditando(false); intencao.current = null; }}>Descartar rascunho</Button>}</div>
    </>}
    {carga?.podeEditar && <BaseApuracaoConsumo companyId={companyId} api={api} cadastroVersao={carga.versao} />}
  </section>;
}
