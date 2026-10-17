import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import './reforma.css';
const ESTADOS = { ERRO: 'Erro', REVISAO: 'Revisão necessária', ALERTA: 'Alerta', SEM_ACHADOS: 'Sem achados nas regras cobertas', EXCLUIDA: 'Fora da conferência de ativas' };
export function VerificadorNfse(props) { return <Verificador key={`${props.companyId}:${props.competencia}`} {...props} />; }
function Verificador({ api, companyId, competencia, onAbrirNota, className = '', embutido = false, onOcupado }) {
  const [aberto, setAberto] = useState(embutido), [dados, setDados] = useState(null), [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false), [filtro, setFiltro] = useState('PENDENTES'), [pagina, setPagina] = useState(0);
  useEffect(() => { onOcupado?.(ocupado); }, [ocupado, onOcupado]);
  const vivo = useRef(true), seq = useRef(0), executando = useRef(false);
  useEffect(() => { const seqDaExecucao = seq; vivo.current = true; return () => { vivo.current = false; seqDaExecucao.current++; }; }, []);
  const aceitar = r => { if (!r?.ok || !Object.hasOwn(r, 'verificacao')) throw new Error('Resposta de conferência inválida.'); return r; };
  useEffect(() => {
    if (!aberto || !competencia) return;
    const vez = ++seq.current; setErro(''); setDados(null);
    api.getVerificacaoNfse(companyId, competencia).then(aceitar).then(r => { if (vivo.current && seq.current === vez) setDados(r); })
      .catch(e => { if (vivo.current && seq.current === vez) setErro(e.message || 'Não foi possível carregar a conferência.'); });
  }, [aberto, api, companyId, competencia]);
  async function verificar() {
    if (executando.current) return;
    executando.current = true; setOcupado(true); setErro(''); const vez = ++seq.current;
    try {
      const r = aceitar(await api.verificarNfseReforma(companyId, competencia));
      if (vivo.current && seq.current === vez) { setDados(r); setPagina(0); }
    } catch (e) { if (vivo.current && seq.current === vez) setErro(e.message || 'A conferência não foi concluída.'); }
    finally { executando.current = false; if (vivo.current) setOcupado(false); }
  }
  const v = dados?.verificacao, resumo = v?.resumo;
  const itens = (v?.itens || []).filter(i => filtro === 'TODAS' || (filtro === 'PENDENTES' ? ['ERRO', 'REVISAO', 'ALERTA'].includes(i.status) : i.status === filtro));
  const Container = embutido ? 'div' : 'details';
  return <Container className={`reforma ${className}`} {...(!embutido ? { onToggle: e => setAberto(e.currentTarget.open) } : {})}>
    {!embutido && <summary>Verificar conformidade de NFS-e · {competencia || 'selecione a competência'}</summary>}
    {aberto && <>
      <p>Conferência local das notas emitidas e recebidas já armazenadas. Inclui documentos sem competência para apontar a falta de informação. Não consulta nem transmite dados ao Fisco.</p>
      {dados?.escopo && <p><small>{dados.escopo}</small></p>}
      {erro && <p role="alert">{erro}</p>}
      {!dados && !erro && competencia && <p role="status">Carregando última conferência…</p>}
      {dados && !v && <p>Nenhuma conferência registrada para esta competência.</p>}
      {dados?.desatualizada && <p className="reforma-alert">Esta conferência está desatualizada. As notas, o cadastro ou as regras mudaram; execute novamente.</p>}
      <div className="reforma-actions"><Button disabled={!competencia || ocupado || dados?.demonstracao} onClick={verificar}>{ocupado ? 'Verificando XMLs…' : 'Verificar notas armazenadas'}</Button></div>
      {v && <>
        <p>Conferência de {new Date(v.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · cadastro revisão {v.cadastroVersao}</p>
        <div className="reforma-cards"><span>{resumo.verificadas} de {resumo.total} documentos</span><span>{resumo.erros} com erro</span><span>{resumo.revisao} para revisão</span><span>{resumo.semAchados} sem achados</span><span>{resumo.excluidas} fora da conferência de ativas</span></div>
        {resumo.parcial && <p className="reforma-alert">Análise parcial: limite de 1.000 documentos por conferência. Há documentos não verificados; não considere a competência concluída.</p>}
        {!resumo.total && <p>Não há documentos armazenados neste recorte. Isso não comprova ausência de movimento.</p>}
        <label>Resultado exibido<select value={filtro} onChange={e => { setFiltro(e.target.value); setPagina(0); }}><option value="PENDENTES">Erros, alertas e revisões</option><option value="TODAS">Todos os documentos</option>{Object.entries(ESTADOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        {itens.slice(pagina * 25, (pagina + 1) * 25).map(item => <div className="reforma-finding" key={item.id}>
          <strong>Nota {item.numero || 'sem número'} · {item.papel === 'EMIT' ? 'Emitida' : item.papel === 'DEST' ? 'Recebida' : 'Papel a conferir'} · {ESTADOS[item.status]}</strong>
          {item.motivo && <p>{item.motivo}</p>}
          {item.achados.map((a, i) => <p key={`${a.codigo}:${i}`}><strong>{a.mensagem}</strong><br />{a.providencia}<br /><small>{a.codigo}{a.campo ? ` · ${a.campo}` : ''}</small></p>)}
          {onAbrirNota && <Button variant="secondary" size="sm" onClick={() => onAbrirNota(item.id)}>Abrir nota</Button>}
        </div>)}
        {!itens.length && <p>Nenhum documento neste filtro de resultado.</p>}
        {itens.length > 25 && <div className="reforma-actions"><Button variant="secondary" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button><span>Página {pagina + 1} de {Math.ceil(itens.length / 25)}</span><Button variant="secondary" disabled={(pagina + 1) * 25 >= itens.length} onClick={() => setPagina(p => p + 1)}>Próxima</Button></div>}
        <details><summary>Regras e cobertura</summary><p>{v.versaoRegras}</p><p>A ausência de achados se limita às regras descritas nesta conferência.</p></details>
      </>}
    </>}
  </Container>;
}
