import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { nomeDaOportunidade } from '../../comercial/comercialModel';

// Mesmo padrão de portal/posicionamento/teclado do MenuTarefaCalendario.
function MenuOportunidade({ nome, rascunho, desistiu, onAcao }) {
  const [aberto, setAberto] = useState(false), [posicao, setPosicao] = useState({ top: 0, left: 0 });
  const gatilho = useRef(null), menu = useRef(null), id = useId();
  const fechar = () => { setAberto(false); gatilho.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!aberto) return undefined;
    const posicionar = () => {
      const r = gatilho.current.getBoundingClientRect(), m = menu.current.getBoundingClientRect();
      setPosicao({ left: Math.max(8, Math.min(r.right - m.width, window.innerWidth - m.width - 8)),
        top: Math.max(8, r.bottom + m.height + 8 > window.innerHeight ? r.top - m.height - 4 : r.bottom + 4) });
    };
    posicionar(); menu.current.querySelector('button')?.focus();
    window.addEventListener('resize', posicionar); window.addEventListener('scroll', posicionar, true);
    return () => { window.removeEventListener('resize', posicionar); window.removeEventListener('scroll', posicionar, true); };
  }, [aberto]);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = e => { if (!gatilho.current?.contains(e.target) && !menu.current?.contains(e.target)) setAberto(false); };
    document.addEventListener('pointerdown', fora); document.addEventListener('focusin', fora);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('focusin', fora); };
  }, [aberto]);
  return <span className="onboarding-opportunity-actions" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!aberto) { setAberto(true); return; }
      const botoes = [...menu.current.querySelectorAll('button')], atual = botoes.indexOf(document.activeElement);
      botoes[e.key === 'Home' ? 0 : e.key === 'End' ? botoes.length - 1 : (atual + (e.key === 'ArrowDown' ? 1 : -1) + botoes.length) % botoes.length]?.focus();
    } else if (e.key === 'Tab' && aberto) fechar();
  }}>
    <button ref={gatilho} type="button" aria-label={`Ações de ${nome}`} aria-haspopup="menu" aria-expanded={aberto} aria-controls={aberto ? id : undefined}
      onClick={() => setAberto(v => !v)} style={{ minWidth: 44, minHeight: 44, border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 20 }}>⋯</button>
    {aberto && createPortal(<div ref={menu} id={id} role="menu" aria-label={`Ações de ${nome}`} style={{ ...posicao, position: 'fixed', zIndex: 1000, display: 'grid', gap: 'var(--space-1)', padding: 'var(--space-2)', maxWidth: 'calc(100vw - 16px)', background: 'var(--bg-surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow)' }}>
      <Button role="menuitem" tabIndex={-1} variant="secondary" onClick={() => { fechar(); onAcao(desistiu ? 'retomar' : 'encerrar'); }}>{desistiu ? 'Retomar atendimento' : 'Encerrar oportunidade'}</Button>
      {rascunho && <Button role="menuitem" tabIndex={-1} variant="secondary" onClick={() => { fechar(); onAcao('excluir'); }}>Excluir rascunho</Button>}
    </div>, document.body)}
  </span>;
}

// A prévia é somente leitura; a decisão e a versão são conferidas novamente no servidor.
export function AcoesOportunidade(props) {
  return <AcoesDaFicha key={props.item.id} {...props} />;
}

function AcoesDaFicha({ api, item, onPersistir, aoRestaurarFoco }) {
  const [acao, setAcao] = useState(null), [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState(''), [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false), [revisao, setRevisao] = useState(0);
  const trava = useRef(false);
  const contexto = useRef(null);
  useLayoutEffect(() => {
    contexto.current = {};
    return () => { contexto.current = null; };
  }, []);
  useEffect(() => {
    if (!acao) return undefined;
    let atual = true;
    setPrevia(null); setErro('');
    Promise.resolve().then(() => api.getElegibilidadeDescarteOnboarding(item.id)).then(r => {
      const p = r?.elegibilidade;
      if (r?.ok !== true || p?.id !== item.id || !Number.isInteger(p?.versao) ||
          typeof p?.podeExcluir !== 'boolean' || typeof p?.podeEncerrar !== 'boolean' || !Array.isArray(p?.impedimentos)) {
        throw new Error('Não foi possível conferir a oportunidade.');
      }
      if (atual) setPrevia(p);
    }).catch(e => { if (atual) setErro(e.payload?.message || e.message || 'Não foi possível conferir a oportunidade.'); });
    return () => { atual = false; };
  }, [api, item.id, acao, revisao]);
  function abrir(valor) { setMotivo(''); setPrevia(null); setErro(''); setAcao(valor); }
  async function confirmar() {
    if (trava.current || !previa) return;
    const origem = contexto.current;
    const aindaAtual = () => origem !== null && contexto.current === origem;
    trava.current = true; setOcupado(true); setErro('');
    try {
      const r = acao === 'excluir'
        ? await api.descartarOnboarding(item.id, previa.versao)
        : acao === 'retomar'
        ? await api.retomarAtendimentoOnboarding(item.id, motivo, previa.versao)
        : await api.desistirOnboarding(item.id, motivo, previa.versao);
      // A mutação já foi enviada. Sair da ficha invalida apenas sua conclusão
      // visual, inclusive callbacks que poderiam focar a nova ficha/rota.
      if (!aindaAtual()) return;
      if (r?.ok !== true || (acao === 'encerrar' && (r.onboarding?.id !== item.id || r.onboarding?.status !== 'DESISTIU')) ||
          (acao === 'retomar' && (r.onboarding?.id !== item.id ||
            !Number.isInteger(r.onboarding?.versao) || r.onboarding.versao <= previa.versao ||
            !['RASCUNHO', 'RECEBIDO', 'EM_TRILHA'].includes(r.onboarding?.status)))) {
        throw new Error('Resposta sem confirmação. Confira a oportunidade antes de tentar novamente.');
      }
      const excluido = acao === 'excluir';
      // Concluir a desmontagem e o retorno de foco do Modal antes de focar
      // o destino persistente: o gatilho pode desaparecer com a linha/ação.
      flushSync(() => {
        setAcao(null);
        onPersistir?.({ id: item.id, excluido, onboarding: r.onboarding });
      });
      aoRestaurarFoco?.({ excluido });
    } catch (e) {
      if (!aindaAtual()) return;
      setErro(e.payload?.message || e.message || 'Não foi possível concluir.');
      setPrevia(null); // Releitura explícita antes de qualquer nova confirmação.
    } finally {
      if (aindaAtual()) { trava.current = false; setOcupado(false); }
    }
  }
  if (['CONVERTIDO', 'CONCLUIDO_AVULSO'].includes(item.status)) return null;
  const excluir = acao === 'excluir';
  const retomar = acao === 'retomar';
  return <>
    <MenuOportunidade nome={nomeDaOportunidade(item)} rascunho={item.status === 'RASCUNHO'} desistiu={item.status === 'DESISTIU'} onAcao={abrir} />
    {acao && <Modal titulo={excluir ? 'Excluir rascunho?' : retomar ? 'Retomar atendimento?' : 'Encerrar oportunidade?'} tamanho="sm" ocupado={ocupado} aoFechar={() => setAcao(null)}
      rodape={<><Button variant="secondary" disabled={ocupado} onClick={() => setAcao(null)}>Cancelar</Button>
        <Button variant={excluir ? 'danger' : 'primary'} disabled={ocupado || !previa || !(excluir ? previa.podeExcluir : retomar ? previa.status === 'DESISTIU' && motivo.trim() : previa.podeEncerrar)} onClick={confirmar}>
          {ocupado ? 'Salvando…' : excluir ? 'Excluir rascunho' : retomar ? 'Retomar atendimento' : 'Confirmar desistência'}
        </Button></>}>
      <p><strong>{nomeDaOportunidade(item)}</strong></p>
      <p>{excluir ? 'Remove definitivamente somente esta ficha em rascunho, se não houver vínculos ou histórico relevante.' : retomar ? 'Retoma o estágio registrado; em fichas antigas sem esse registro, retorna para Recebido quando houve envio ou para Rascunho. Preserva a desistência no histórico, revoga links antigos e mantém este caso em atendimento manual, sem confirmar contratação ou pagamento.' : 'Registra a oportunidade como Desistiu e a retira das oportunidades em andamento. A ficha, as conversas, os documentos e o histórico permanecem consultáveis: Perdido ou Todas no Comercial; Encerrados no Onboarding.'}</p>
      {!excluir && <label style={{ display: 'grid', gap: 'var(--space-2)' }}>{retomar ? 'Motivo da retomada' : 'Motivo (opcional)'}
        <textarea maxLength={500} value={motivo} disabled={ocupado} onChange={e => setMotivo(e.target.value)} rows={3} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-page)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)' }} />
      </label>}
      {!previa && !erro && <p role="status">Conferindo oportunidade…</p>}
      {excluir && previa && !previa.podeExcluir && <div><p>Esta ficha deve ser preservada:</p><ul>{previa.impedimentos.map(i => <li key={i}>{i}</li>)}</ul>
        {previa.podeEncerrar && <Button variant="secondary" onClick={() => abrir('encerrar')}>Encerrar como desistência</Button>}
      </div>}
      {!excluir && !retomar && previa && !previa.podeEncerrar && <p role="status">Esta oportunidade já está encerrada. Atualize a lista para conferir o histórico.</p>}
      {erro && <div role="alert"><p>{erro}</p><Button variant="secondary" disabled={ocupado} onClick={() => setRevisao(v => v + 1)}>Conferir novamente</Button></div>}
    </Modal>}
  </>;
}
