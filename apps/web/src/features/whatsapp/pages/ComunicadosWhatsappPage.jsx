import { useCallback, useEffect, useRef, useState } from 'react';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/Button';

const rotulos = { RASCUNHO: 'Rascunho', SUBMETENDO: 'Conferindo submissão', EM_ANALISE: 'Em análise pela Meta', APROVADO: 'Aprovado, aguardando envio', ENVIANDO: 'Enviando', PAUSADO: 'Precisa de atenção', CONCLUIDO: 'Processamento concluído', CANCELADO: 'Cancelado', PENDENTE: 'Aguardando envio', ENVIADO: 'Enviado', FALHOU: 'Falhou', INDETERMINADO: 'Resultado não confirmado', EXCLUIDO: 'Não enviado', enviado: 'Enviado', entregue: 'Entregue', lido: 'Lido', falhou: 'Falhou', enviando: 'Enviando', indeterminado: 'Resultado não confirmado' };
const categoria = c => c === 'UTILITY' ? 'Atualização de serviço (Utilidade)' : 'Comunicado geral (Marketing)';
const contatos = n => `${n} ${n === 1 ? 'contato' : 'contatos'}`;
const novo = () => ({ idempotencia: crypto.randomUUID(), titulo: '', corpo: '', categoria: 'MARKETING' });

export function ComunicadosWhatsappPage({ api, companies = [], onBack }) {
  const [itens, setItens] = useState([]), [cursor, setCursor] = useState(null), [selecionado, setSelecionado] = useState(null);
  const [form, setForm] = useState(null), [todas, setTodas] = useState(true), [empresas, setEmpresas] = useState([]);
  const [previa, setPrevia] = useState(null), [telefones, setTelefones] = useState([]), [revisar, setRevisar] = useState(false);
  const [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false), [carregando, setCarregando] = useState(true);
  const vivo = useRef(true), sequencia = useRef(0);
  const disponivel = typeof api?.comunicadosWhatsapp === 'function';
  const listar = useCallback(async (proximo = '') => {
    if (!disponivel) { setCarregando(false); return; }
    const r = await api.comunicadosWhatsapp(proximo ? `?cursor=${encodeURIComponent(proximo)}` : '');
    if (vivo.current) { setItens(antes => proximo ? [...antes, ...r.itens] : r.itens); setCursor(r.proximoCursor); setCarregando(false); }
  }, [api, disponivel]);
  useEffect(() => {
    vivo.current = true; listar().catch(e => { if (vivo.current) { setErro(e.message); setCarregando(false); } });
    return () => { vivo.current = false; sequencia.current++; };
  }, [listar]);
  const abrir = async id => {
    const s = ++sequencia.current; setErro(''); setOcupado(true); setRevisar(false); setForm(null);
    try { const r = await api.comunicadosWhatsapp(`/${id}`); if (vivo.current && sequencia.current === s) setSelecionado(r); }
    catch (e) { if (vivo.current && sequencia.current === s) setErro(e.message); }
    finally { if (vivo.current && sequencia.current === s) setOcupado(false); }
  };
  useEffect(() => {
    if (selecionado?.status !== 'ENVIANDO' || ocupado) return undefined;
    const id = selecionado.id, s = sequencia.current;
    let consultando = false;
    const timer = setInterval(async () => {
      if (consultando) return;
      consultando = true;
      try { const r = await api.comunicadosWhatsapp(`/${id}`); if (vivo.current && sequencia.current === s) setSelecionado(r); }
      catch (e) { if (vivo.current && sequencia.current === s) setErro(e.message); }
      finally { consultando = false; }
    }, 5000);
    return () => clearInterval(timer);
  }, [api, selecionado?.id, selecionado?.status, ocupado]);
  const acao = async (caminho, dados = {}) => {
    if (ocupado) return;
    setOcupado(true); setErro(''); const id = selecionado?.id, s = ++sequencia.current;
    try { const r = await api.comunicadosWhatsapp(caminho, dados); if (vivo.current && s === sequencia.current) { setSelecionado(r); setForm(null); setRevisar(false); await listar(); } }
    catch (e) {
      if (vivo.current && s === sequencia.current) {
        setErro(e.message); setRevisar(false);
        if (id) { try { const atual = await api.comunicadosWhatsapp(`/${id}`); if (vivo.current && s === sequencia.current) setSelecionado(atual); } catch {} }
      }
    } finally { if (vivo.current && s === sequencia.current) setOcupado(false); }
  };
  const verDestinatarios = async () => {
    setOcupado(true); setErro('');
    try { const r = await api.comunicadosWhatsapp('/previa', todas ? {} : { empresasIds: empresas }); if (vivo.current) { setPrevia(r); setTelefones(r.destinatarios.map(d => d.telefone)); } }
    catch (e) { if (vivo.current) setErro(e.message); }
    finally { if (vivo.current) setOcupado(false); }
  };
  const iniciar = () => { sequencia.current++; setSelecionado(null); setForm(novo()); setPrevia(null); setRevisar(false); setErro(''); setTodas(true); setEmpresas([]); };
  const ds = selecionado?.destinatarios || [];
  const pendentes = ds.filter(d => d.status === 'PENDENTE' && d.elegivel).length;
  const podeRevisar = selecionado?.status === 'APROVADO' && pendentes > 0;
  return <PageShell title="Comunicados" subtitle="Avisos pelo WhatsApp · um envio por número, mesmo quando representa várias empresas" onBack={onBack}
    actions={<Button disabled={!disponivel || ocupado} onClick={iniciar}>Novo comunicado</Button>} contentStyle={{ maxWidth: 'var(--content-max)', width: '100%', margin: '0 auto', padding: 24 }}>
    <div className="wa-comunicados">
      {!disponivel && <p role="status">Comunicados estão disponíveis no ambiente conectado. A demonstração não envia mensagens.</p>}
      {erro && <p role="alert" className="wa-aviso-erro">{erro}</p>}
      {carregando && <p role="status">Carregando comunicados…</p>}
      {!form && !selecionado && !carregando && <section aria-label="Histórico de comunicados">
        <p>Prepare o aviso, escolha os contatos e envie o texto para aprovação da Meta. Após a aprovação, revise a lista e confirme o envio.</p>
        {!itens.length && <p>Nenhum comunicado criado.</p>}
        {itens.map(c => <button type="button" className="wa-aviso-linha" key={c.id} onClick={() => abrir(c.id)} disabled={ocupado}><strong>{c.titulo}</strong><span>{rotulos[c.status] || c.status}</span><span>{contatos(c._count?.destinatarios || 0)}</span></button>)}
        {cursor && <Button variant="secondary" onClick={() => listar(cursor).catch(e => setErro(e.message))}>Carregar mais comunicados</Button>}
      </section>}
      {form && <form onSubmit={e => { e.preventDefault(); if (previa && telefones.length) acao('', { ...form, empresasIds: previa.empresasIds, telefones }); }}>
        <h2>1. Escreva o aviso</h2>
        <label>Título interno<input required maxLength={100} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} disabled={ocupado} /></label>
        <label>Mensagem para os clientes<textarea required rows={6} maxLength={900} value={form.corpo} onChange={e => setForm({ ...form, corpo: e.target.value })} disabled={ocupado} placeholder="Escreva o aviso completo que todos os contatos selecionados receberão." /></label>
        <p className="wa-aviso-ajuda">{form.corpo.length}/900 caracteres. Links podem ser incluídos. O texto ficará fixo após salvar, para corresponder ao modelo aprovado.</p>
        <label>Tipo de aviso<select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} disabled={ocupado}><option value="MARKETING">Comunicado geral</option><option value="UTILITY">Atualização de serviço contratado</option></select></label>
        <p className="wa-aviso-ajuda">Use atualização de serviço para uma informação específica de um serviço já contratado. A Meta define a categoria final e cobra conforme suas tarifas.</p>
        <h2>2. Escolha quem recebe</h2>
        <label className="wa-aviso-check"><input type="checkbox" checked={todas} disabled={ocupado} onChange={e => { setTodas(e.target.checked); setPrevia(null); }} />Toda a carteira</label>
        {!todas && <div className="wa-aviso-empresas">{companies.map(c => { const id = c.companyId || c.id; return <label className="wa-aviso-check" key={id}><input type="checkbox" disabled={ocupado} checked={empresas.includes(id)} onChange={e => { setPrevia(null); setEmpresas(e.target.checked ? [...empresas, id] : empresas.filter(x => x !== id)); }} />{c.razao || c.name}</label>; })}</div>}
        <Button type="button" variant="secondary" disabled={ocupado || (!todas && !empresas.length)} onClick={verDestinatarios}>Conferir destinatários</Button>
        {previa && <section aria-label="Prévia dos destinatários">
          <p><strong>{contatos(telefones.length)} {telefones.length === 1 ? 'selecionado' : 'selecionados'}</strong> · {previa.excluidos.length} cadastros sem envio · {previa.empresasSemContato} empresas sem contato cadastrado.</p>
          <div className="wa-aviso-destinatarios">{previa.destinatarios.map(d => <label className="wa-aviso-check" key={d.telefone}><input type="checkbox" disabled={ocupado} checked={telefones.includes(d.telefone)} onChange={e => setTelefones(e.target.checked ? [...telefones, d.telefone] : telefones.filter(t => t !== d.telefone))} /><span><strong>{d.nome}</strong> · +{d.telefone}<small>{d.empresas.map(e => e.razao).join(' · ')}</small></span></label>)}</div>
          {!!previa.excluidos.length && <details><summary>Ver por que alguns cadastros não receberão</summary>{previa.excluidos.map(d => <p key={d.contatoId}>{d.nome} · {d.empresa}: {d.motivo}</p>)}</details>}
          <Button type="submit" disabled={ocupado || !telefones.length || !form.corpo.trim() || !form.titulo.trim()}>Salvar prévia</Button>
        </section>}
      </form>}
      {selecionado && <section aria-label="Comunicado selecionado">
        <Button variant="secondary" disabled={ocupado} onClick={() => { sequencia.current++; setSelecionado(null); setRevisar(false); listar().catch(e => setErro(e.message)); }}>Voltar aos comunicados</Button>
        <h2>{selecionado.titulo}</h2><p><strong>{rotulos[selecionado.status]}</strong> · {categoria(selecionado.categoria)}</p>
        {selecionado.motivo && <p role="status">{selecionado.motivo}</p>}
        <div className="wa-aviso-previa"><p>{selecionado.corpo}</p><small>Altan Contabilidade</small></div>
        <p>{contatos(ds.length)} na lista · {pendentes} aguardando envio com cadastro habilitado.</p>
        <div className="wa-aviso-acoes">
          {selecionado.status === 'RASCUNHO' && <Button disabled={ocupado} onClick={() => acao(`/${selecionado.id}/submeter`)}>Enviar para aprovação da Meta</Button>}
          {['SUBMETENDO', 'EM_ANALISE', 'PAUSADO', 'APROVADO'].includes(selecionado.status) && <Button variant="secondary" disabled={ocupado} onClick={() => acao(`/${selecionado.id}/consultar-aprovacao`)}>Consultar aprovação</Button>}
          {podeRevisar && !revisar && <Button disabled={ocupado} onClick={() => setRevisar(true)}>Revisar e enviar</Button>}
          {!['CANCELADO', 'CONCLUIDO'].includes(selecionado.status) && <Button variant="danger" disabled={ocupado} onClick={() => acao(`/${selecionado.id}/cancelar`)}>Cancelar comunicado</Button>}
        </div>
        {revisar && podeRevisar && <section className="wa-aviso-confirmacao" aria-label="Confirmar transmissão"><h3>Confirmar envio para {contatos(pendentes)}</h3><p>Todos receberão o aviso acima uma única vez. O envio pode ser cobrado pela Meta na categoria {categoria(selecionado.categoria)}. As respostas chegam às conversas individuais.</p><Button disabled={ocupado} onClick={() => acao(`/${selecionado.id}/enviar`, { previaHash: selecionado.previaHash })}>Confirmar envio para {contatos(pendentes)}</Button></section>}
        <details open={['ENVIANDO', 'CONCLUIDO', 'CANCELADO'].includes(selecionado.status)}><summary>Destinatários e acompanhamento</summary><div className="wa-aviso-tabela"><table><thead><tr><th>Contato</th><th>WhatsApp</th><th>Resultado</th></tr></thead><tbody>{ds.map(d => <tr key={d.id}><td>{d.nome}</td><td>+{d.telefone}</td><td>{rotulos[d.entrega] || rotulos[d.status] || d.status}{d.status === 'PENDENTE' && !d.elegivel ? ' · cadastro não habilitado' : ''}{d.erroEntrega || d.motivo ? <small>{d.erroEntrega || d.motivo}</small> : null}</td></tr>)}</tbody></table></div></details>
        <p className="wa-aviso-ajuda">“Enviado” significa aceito pelo WhatsApp. “Entregue” e “Lido” dependem da confirmação da Meta. Resultado não confirmado não é reenviado automaticamente.</p>
        <Button variant="secondary" disabled={ocupado} onClick={() => abrir(selecionado.id)}>Atualizar acompanhamento</Button>
      </section>}
    </div>
  </PageShell>;
}
