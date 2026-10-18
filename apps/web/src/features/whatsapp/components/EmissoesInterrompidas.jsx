import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { fmtDataHora } from '../lib/conversasTela';
import { campo } from './FioDaConversa.shared';

const rotulos = { LEGADO_SEM_TENTATIVA: 'Sem tentativa vinculada', AGUARDANDO_CONFERENCIA: 'Aguardando conferência', RECUPERADA: 'Emissão recuperada', PROCESSANDO: 'Processamento em andamento', INCONCLUSIVA: 'Resultado incerto',
  MESMA: 'Mesma operação confirmada', OUTRA: 'Operação diferente identificada', EM_CONFERENCIA: 'Conferência em andamento' };

// Montado por contexto: uma resposta tardia nunca altera a conversa que o substituiu.
export function EmissoesInterrompidas({ api, conversaId, contexto = '' }) {
  if (!api?.listarEmissoesInterrompidasWhatsapp || !conversaId) return null;
  return <Painel key={`${conversaId}:${contexto}`} api={api} conversaId={conversaId} />;
}

function Painel({ api, conversaId }) {
  const [itens, setItens] = useState(null), [erro, setErro] = useState(''), [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState(false), [ocupado, setOcupado] = useState(null);
  const [motivos, setMotivos] = useState({}), [incertas, setIncertas] = useState({});
  const vivo = useRef(true), bloqueado = useRef(false), leitura = useRef(0);
  useEffect(() => {
    const estadoLeitura = leitura;
    vivo.current = true;
    return () => { vivo.current = false; estadoLeitura.current++; };
  }, []);
  async function carregar() {
    const versaoLeitura = ++leitura.current;
    setCarregando(true); setErro('');
    try {
      const r = await api.listarEmissoesInterrompidasWhatsapp(conversaId);
      if (!Array.isArray(r?.itens) || r.ok === false) throw new Error('Resposta de conferência indisponível.');
      if (vivo.current && versaoLeitura === leitura.current) {
        setItens(r.itens);
        setIncertas(atuais => Object.fromEntries(Object.entries(atuais).filter(([id, versao]) => {
          const item = r.itens.find(i => i.acaoId === id);
          return item && item.podeConferir && (item.versao === versao || item.situacao === 'PROCESSANDO');
        })));
      }
    } catch (e) {
      if (vivo.current && versaoLeitura === leitura.current) setErro(e?.message || 'Não foi possível consultar as emissões.');
    } finally { if (vivo.current && versaoLeitura === leitura.current) setCarregando(false); }
  }
  async function conferir(item) {
    const motivo = (motivos[item.acaoId] || '').trim();
    if (bloqueado.current || motivo.length < 10 || incertas[item.acaoId] || !item.podeConferir) return;
    bloqueado.current = true; leitura.current++; setCarregando(false); setOcupado(item.acaoId); setErro(''); setAviso('');
    try {
      const r = await api.conferirEmissaoInterrompidaWhatsapp(conversaId, item.acaoId, { versao: item.versao, motivo });
      if (!r?.item || r.ok === false) throw new Error('O resultado da conferência não foi confirmado.');
      if (!vivo.current) return;
      setItens(atuais => atuais?.map(a => a.acaoId === item.acaoId ? r.item : a));
      setAviso(r.item.mensagem === r.message ? '' : r.message || 'Conferência registrada.');
      await carregar();
    } catch (e) {
      if (!vivo.current) return;
      // Pode ter sido processado no servidor: não repetir automaticamente nem gerar outra intenção.
      setIncertas(atuais => ({ ...atuais, [item.acaoId]: item.versao }));
      setErro(e?.message || 'Não foi possível confirmar a resposta.');
      setAviso('Confira o estado salvo em “Atualizar resultados”. Nenhuma emissão será repetida.');
    } finally { if (vivo.current) { bloqueado.current = false; setOcupado(null); } }
  }
  return <details className="wa-emission-review" style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: '.875rem' }} onToggle={e => { if (e.currentTarget.open && itens === null && !carregando) carregar(); }}>
    <summary style={{ cursor: 'pointer', padding: '10px 16px', minHeight: 44, boxSizing: 'border-box' }}>Conferir emissões{itens?.some(i => i.situacao !== 'RECUPERADA') ? ` · ${itens.filter(i => i.situacao !== 'RECUPERADA').length} para conferir` : ''}</summary>
    <div style={{ minWidth: 0, overflowWrap: 'anywhere', maxHeight: 'min(32vh, 280px)', overflowY: 'auto', padding: '0 16px 12px' }}>
      <p style={{ color: 'var(--text-muted)' }}>Consulta e registra o resultado, sem emitir nota, enviar mensagem ou reativar a IA.</p>
      <Button variant="secondary" disabled={carregando || Boolean(ocupado)} onClick={carregar}>Atualizar resultados</Button>
      {carregando && <p role="status">Consultando emissões…</p>}
      {erro && <p role="alert">{erro}</p>}
      {aviso && <p role="status">{aviso}</p>}
      {itens?.length === 0 && <p>Nenhuma emissão interrompida nesta conversa.</p>}
      {itens?.map(item => <section key={item.acaoId} aria-label={`Emissão de ${item.empresa?.razao || 'empresa'}`} className="wa-detail-section">
        <strong>{item.empresa?.razao || 'Empresa não identificada'}</strong>
        <p>{rotulos[item.situacao] || 'Conferência necessária'}</p>
        <p>Confirmação: {item.confirmadaEm ? fmtDataHora(item.confirmadaEm) : 'Horário não disponível'}{item.tentativa?.numeroNfse ? ` · Nota ${item.tentativa.numeroNfse}` : ''}</p>
        <details><summary>Detalhes da tentativa</summary><p>Identificador: {item.tentativa?.idDps || item.tentativa?.id || 'Sem vínculo persistido'}</p>
          <p>Estado: {item.tentativa?.status || 'Não disponível'}</p>
          {item.tentativa?.updatedAt && <p>Atualizada em {fmtDataHora(item.tentativa.updatedAt)}</p>}
          {item.historico?.map((h, i) => <p key={h.id || i}>{h.motivo || 'Conferência registrada'}{h.iniciadaEm ? ` · ${fmtDataHora(h.iniciadaEm)}` : ''}{h.estado ? ` · ${rotulos[h.estado] || 'Análise registrada'}` : ''}</p>)}
        </details>
        {item.mensagem && <p>{item.mensagem}</p>}
        {item.podeConferir && !incertas[item.acaoId] ? <div>
          <label>Motivo da conferência<textarea style={{ ...campo, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }} maxLength={1000} value={motivos[item.acaoId] || ''} onChange={e => setMotivos(atuais => ({ ...atuais, [item.acaoId]: e.target.value }))} disabled={Boolean(ocupado)} /></label>
          <p>Descreva o motivo em pelo menos 10 caracteres.</p>
          <Button disabled={Boolean(ocupado) || carregando || (motivos[item.acaoId] || '').trim().length < 10 || !api.conferirEmissaoInterrompidaWhatsapp} onClick={() => conferir(item)}>{ocupado === item.acaoId ? 'Conferindo…' : 'Conferir resultado'}</Button>
        </div> : !item.podeConferir && !item.mensagem ? <p>Conferência indisponível para este estado ou acesso.</p> : null}
      </section>)}
    </div>
  </details>;
}
