import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';

export function RegistrarEnvioExterno(props) {
  return <FormularioEnvioExterno key={`${props.companyId}:${props.guia.guideId || props.guia.id}`} {...props} />;
}
function FormularioEnvioExterno({ api, companyId, guia, aoFechar, aoSalvar }) {
  const guideId = guia.guideId || guia.id;
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState('');
  const [dataEntrega, setData] = useState(''), [meio, setMeio] = useState('PESSOAL');
  const [ocupado, setOcupado] = useState(false), [salvo, setSalvo] = useState(null);
  const chave = useRef(globalThis.crypto?.randomUUID?.() || `entrega-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    let atual = true;
    setPrevia(null); setSalvo(null); setErro('');
    api.preverEnvioExternoGuia(companyId, guideId).then(r => {
      if (!atual) return;
      if (r?.companyId !== companyId || r?.guideId !== guideId || !r.revisaoDocumento) throw new Error('Não foi possível conferir esta guia.');
      setPrevia(r); setSalvo(r.entregaExterna || null);
    }).catch(e => { if (atual) setErro(e.message); });
    return () => { atual = false; vivo.current = false; };
  }, [api, companyId, guideId]);
  async function salvar() {
    setOcupado(true); setErro('');
    try {
      const r = await api.registrarEnvioExternoGuia(companyId, guideId, { revisaoDocumento: previa.revisaoDocumento, idempotencyKey: chave.current, dataEntrega, meio, confirmado: true });
      if (r?.ok !== true || r.entregaExterna?.guideId !== guideId || r.entregaExterna?.companyId !== companyId || !r.entregaExterna.atorId) throw new Error('Registro não confirmado. Atualize a lista antes de repetir.');
      if (!vivo.current) return;
      setSalvo(r.entregaExterna);
      try { await aoSalvar?.(); } catch { if (vivo.current) setErro('Entrega registrada. Não foi possível atualizar a lista; atualize a tela.'); }
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { if (vivo.current) setOcupado(false); }
  }
  return <Modal titulo="Registrar envio externo" tamanho="sm" ocupado={ocupado} aoFechar={aoFechar} rodape={<>
    <Button variant="secondary" disabled={ocupado} onClick={aoFechar}>Fechar</Button>
    {!salvo && <Button disabled={ocupado || !previa || !dataEntrega} onClick={salvar}>{ocupado ? 'Registrando…' : 'Confirmar envio externo'}</Button>}
  </>}>
    <p>{guia.tipo} · {guia.competencia}</p>
    {erro && <p role="alert">{erro}</p>}
    {!previa && !erro && <p role="status">Conferindo a revisão da guia…</p>}
    {salvo ? <p role="status">Envio externo registrado em {salvo.dataEntrega.split('-').reverse().join('/')} por {salvo.atorNome || 'contador identificado no histórico'}. Registro: {new Date(salvo.registradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília).</p> : <div className="guides-external-form">
      <label>Data da entrega<input type="date" value={dataEntrega} disabled={ocupado} onChange={e => setData(e.target.value)} /></label>
      <label>Meio<select value={meio} disabled={ocupado} onChange={e => setMeio(e.target.value)}><option value="PESSOAL">Entrega pessoal</option><option value="WHATSAPP_PARTICULAR">WhatsApp particular</option><option value="EMAIL_EXTERNO">E-mail externo</option><option value="OUTRO">Outro meio</option></select></label>
      <p>Fecha a pendência de envio desta versão. Não confirma pagamento nem entrega pelo WhatsApp da Altan. Seu usuário e o horário serão registrados.</p>
    </div>}
  </Modal>;
}
