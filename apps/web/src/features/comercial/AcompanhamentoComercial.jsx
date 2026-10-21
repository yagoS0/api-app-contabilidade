import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import './comercial.css';
import { resumoRetorno } from './comercialModel';

export function AcompanhamentoComercial(props) {
  return <AcompanhamentoDaFicha key={props.onboarding.id} {...props} />;
}

function AcompanhamentoDaFicha({ api, onboarding, onAtualizar, revisao: revisaoExterna = 0 }) {
  const [estado, setEstado] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const [erroLeitura, setErroLeitura] = useState(''), [leituraPronta, setLeituraPronta] = useState(null);
  const [form, setForm] = useState(null), [canais, setCanais] = useState([]), [canalId, setCanalId] = useState('');
  const [nome, setNome] = useState(onboarding.responsavelNome || ''), [telefone, setTelefone] = useState(onboarding.responsavelTelefone || '');
  const [evidencia, setEvidencia] = useState(''), [autorizado, setAutorizado] = useState(false);
  const [acao, setAcao] = useState(''), [quando, setQuando] = useState(''), [revisao, setRevisao] = useState(0);
  const trava = useRef(false);
  const sequencia = useRef(0), contexto = useRef(null), montado = useRef(true);
  const ultimoEstado = useRef(estado);
  ultimoEstado.current = estado;
  const chave = JSON.stringify([onboarding.id, onboarding.versao, revisaoExterna, revisao]);
  contexto.current = chave;
  const pronto = leituraPronta?.chave === chave && leituraPronta?.api === api && !erroLeitura;
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const base = `/onboardings/${encodeURIComponent(onboarding.id)}`;
  useEffect(() => {
    let vivo = true;
    const n = ++sequencia.current;
    setLeituraPronta(null);
    api.comercial(`${base}/acompanhamento`).then(r => {
      if (!vivo || n !== sequencia.current || contexto.current !== chave) return;
      if (!r || r.ok === false || !Number.isInteger(r.versao) || r.versao < onboarding.versao) throw new Error('Acompanhamento desatualizado. Atualize antes de continuar.');
      if (r.versao < (ultimoEstado.current?.versao ?? 0)) throw new Error('Acompanhamento anterior ao último salvamento. Atualize antes de continuar.');
      setEstado(r); setErroLeitura(''); setLeituraPronta({ chave, api });
    }).catch(e => { if (vivo && n === sequencia.current && contexto.current === chave) setErroLeitura(e.message); });
    return () => { vivo = false; };
  }, [api, base, chave, onboarding.versao]);
  async function abrirContato() {
    if (!pronto || trava.current) return;
    const origem = chave;
    setForm('contato'); setErro('');
    try { const r = await api.comercial('/canais-comerciais'); if (!montado.current || contexto.current !== origem) return; setCanais(r.canais || []); setCanalId(r.canais?.length === 1 ? r.canais[0].id : ''); }
    catch(e) { if (montado.current && contexto.current === origem) setErro(e.message); }
  }
  async function salvar(e) {
    e.preventDefault();
    if (trava.current || !pronto) return;
    const origem = chave;
    trava.current = true; setOcupado(true); setErro('');
    try {
      if (form === 'contato') {
        const r = await api.comercial(`${base}/contato`, { nome, telefone, canalId, autorizado, evidencia });
        if (!montado.current) return;
        if (!r?.conversaId || !r?.atendimentoId) throw new Error('Contato sem confirmação. Atualize a ficha antes de repetir.');
        sequencia.current++;
        setEstado(s => ({ ...s, conversaId: r.conversaId }));
        if (contexto.current !== origem) setRevisao(v => v + 1);
        setForm(null);
        try { await onAtualizar?.(); } catch(e) { if (montado.current) setErro(`Contato salvo, mas não foi possível atualizar a ficha. ${e.message}`); }
      } else {
        const data = new Date(quando);
        if (!Number.isFinite(data.getTime())) throw new Error('Informe uma data e hora válidas para o retorno.');
        const salvo = await api.comercial(`${base}/retorno`, { acao, quando: data.toISOString(), versao: estado?.versao });
        if (!montado.current) return;
        if (!salvo || salvo.ok === false || !Number.isInteger(salvo.versao) || !salvo.retorno) throw new Error('Retorno sem confirmação. Atualize antes de repetir.');
        sequencia.current++;
        setEstado(s => s?.versao > salvo.versao ? s : ({ ...s, ...salvo }));
        setForm(null);
        setRevisao(v => v + 1);
        try { await onAtualizar?.(); } catch (e) { if (montado.current) setErro(`Retorno salvo, mas não foi possível atualizar a ficha. ${e.message}`); }
      }
      setForm(null);
    } catch(e) { if (montado.current) setErro(e.message || 'Não foi possível confirmar. Atualize antes de repetir.'); }
    finally { trava.current = false; if (montado.current) setOcupado(false); }
  }
  return <section className="commercial-followup" aria-label="Acompanhamento comercial">
    <div className="commercial-followup-heading"><div><strong>Próximo contato</strong><p>{estado ? resumoRetorno(estado.retorno) : erroLeitura ? 'Retorno indisponível' : 'Carregando retorno…'}</p></div><div className="commercial-tools">
      {estado?.conversaId ? pronto ? <Link className="commercial-chat-link" to={`/comercial/conversas?conversa=${encodeURIComponent(estado.conversaId)}`}>Abrir conversa ↗</Link> : <span>Conversa aguardando atualização</span> : <><Link className="btn btn-secondary btn-md" to="/comercial/conversas">Localizar contato</Link><Button variant="secondary" onClick={abrirContato} disabled={ocupado || !pronto}>Iniciar contato</Button></>}
      <Button variant="secondary" disabled={ocupado || !pronto} onClick={() => setForm('retorno')}>Agendar retorno</Button>
    </div></div>
    {erro && <p role="alert">{erro} <button type="button" onClick={() => setRevisao(v => v + 1)}>Atualizar</button></p>}
    {erroLeitura && <p role="alert">{erroLeitura} <Button variant="secondary" onClick={() => setRevisao(v => v + 1)}>Atualizar acompanhamento</Button></p>}
    {!pronto && !erroLeitura && <p role="status">Atualizando acompanhamento…</p>}
    {form && <form onSubmit={salvar} className="commercial-followup-form"><fieldset disabled={ocupado || !pronto}>
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
