import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import './comercial.css';

export function AcompanhamentoComercial({ api, onboarding, onAtualizar }) {
  const [estado, setEstado] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState(null), [canais, setCanais] = useState([]), [canalId, setCanalId] = useState('');
  const [nome, setNome] = useState(onboarding.responsavelNome || ''), [telefone, setTelefone] = useState(onboarding.responsavelTelefone || '');
  const [evidencia, setEvidencia] = useState(''), [autorizado, setAutorizado] = useState(false);
  const [acao, setAcao] = useState(''), [quando, setQuando] = useState(''), [revisao, setRevisao] = useState(0);
  const trava = useRef(false);
  const base = `/onboardings/${encodeURIComponent(onboarding.id)}`;
  useEffect(() => {
    let vivo = true;
    api.comercial(`${base}/acompanhamento`).then(r => { if (vivo) { setEstado(r); setErro(''); } }).catch(e => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [api, base, revisao, onboarding.versao]);
  async function abrirContato() {
    setForm('contato'); setErro('');
    try { const r = await api.comercial('/canais-comerciais'); setCanais(r.canais || []); setCanalId(r.canais?.length === 1 ? r.canais[0].id : ''); }
    catch(e) { setErro(e.message); }
  }
  async function salvar(e) {
    e.preventDefault();
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro('');
    try {
      if (form === 'contato') {
        const r = await api.comercial(`${base}/contato`, { nome, telefone, canalId, autorizado, evidencia });
        setEstado(s => ({ ...s, conversaId: r.conversaId }));
      } else {
        const data = new Date(quando);
        if (!Number.isFinite(data.getTime())) throw new Error('Informe uma data e hora válidas para o retorno.');
        await api.comercial(`${base}/retorno`, { acao, quando: data.toISOString(), versao: estado?.versao });
        setRevisao(v => v + 1); onAtualizar?.();
      }
      setForm(null);
    } catch(e) { setErro(e.message || 'Não foi possível confirmar. Atualize antes de repetir.'); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <section className="commercial-followup" aria-label="Acompanhamento comercial">
    <div className="commercial-followup-heading"><div><strong>Próximo contato</strong><p>{estado?.retorno ? `${estado.retorno.dados.acao} · ${new Date(estado.retorno.dados.quando).toLocaleString('pt-BR')}` : 'Nenhum retorno agendado'}</p></div><div className="commercial-tools">
      {estado?.conversaId ? <Link className="commercial-chat-link" to={`/comercial/conversas?conversa=${encodeURIComponent(estado.conversaId)}`}>Abrir conversa ↗</Link> : <Button variant="secondary" onClick={abrirContato} disabled={ocupado}>Iniciar contato</Button>}
      <Button variant="secondary" disabled={ocupado || !estado} onClick={() => setForm('retorno')}>Agendar retorno</Button>
    </div></div>
    {erro && <p role="alert">{erro} <button type="button" onClick={() => setRevisao(v => v + 1)}>Atualizar</button></p>}
    {form && <form onSubmit={salvar} className="commercial-followup-form"><fieldset disabled={ocupado}>
      {form === 'contato' ? <>
        <legend>Preparar contato</legend>
        <label>Nome<input required minLength={2} maxLength={120} value={nome} onChange={e => setNome(e.target.value)} /></label>
        <label>Telefone com DDI<input required type="tel" placeholder="55 + DDD + número" value={telefone} onChange={e => setTelefone(e.target.value)} /></label>
        <label>Canal<select required value={canalId} onChange={e => setCanalId(e.target.value)}><option value="">Selecione</option>{canais.map(c => <option key={c.id} value={c.id}>{c.chave}</option>)}</select></label>
        <label>Origem da autorização<input required minLength={5} maxLength={500} placeholder="Ex.: solicitou contato pelo formulário" value={evidencia} onChange={e => setEvidencia(e.target.value)} /></label>
        <label className="commercial-consent"><input type="checkbox" required checked={autorizado} onChange={e => setAutorizado(e.target.checked)} />Autorizou receber este contato pelo WhatsApp</label>
        <p>A mensagem será conferida e enviada na conversa, usando um modelo aprovado.</p>
      </> : <><legend>Agendar retorno</legend><label>Próxima ação<input required maxLength={300} value={acao} onChange={e => setAcao(e.target.value)} placeholder="Ex.: conversar sobre a proposta" /></label><label>Data e hora<input type="datetime-local" required value={quando} onChange={e => setQuando(e.target.value)} /></label><p>Cria um lembrete interno. Não envia mensagens automaticamente.</p></>}
      <div className="commercial-tools"><Button variant="secondary" type="button" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit">{ocupado ? 'Salvando…' : form === 'contato' ? 'Preparar conversa' : 'Salvar retorno'}</Button></div>
    </fieldset></form>}
  </section>;
}
