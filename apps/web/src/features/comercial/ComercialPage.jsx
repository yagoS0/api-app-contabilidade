import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { NovoAtendimentoModal } from '../onboarding/components/NovoAtendimentoModal';
import { WhatsappPage } from '../whatsapp/pages/renderWhatsappPage';
import { useResumoWhatsapp } from '../whatsapp/hooks/useResumoWhatsapp';
import { ETAPAS, etapaDaOportunidade, nomeDaOportunidade, servicoDaOportunidade } from './comercialModel';
import './comercial.css';

export function ComercialPage({ api, usuarioId, companies = [], mensagemBiblioteca, onMensagemBibliotecaAberta }) {
  const location = useLocation(), navigate = useNavigate();
  const visao = location.pathname.endsWith('/conversas') ? 'conversas' : location.pathname.endsWith('/oportunidades') ? 'oportunidades' : 'hoje';
  const [itens, setItens] = useState([]), [erro, setErro] = useState(''), [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false), [busca, setBusca] = useState(''), [etapa, setEtapa] = useState(''), [revisao, setRevisao] = useState(0);
  const resumoConversas = useResumoWhatsapp({ api, area: 'comercial' });
  useEffect(() => {
    const atualizar = () => { if (document.visibilityState !== 'hidden') setRevisao(v => v + 1); };
    const timer = setInterval(atualizar, 30000);
    window.addEventListener('focus', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    return () => { clearInterval(timer); window.removeEventListener('focus', atualizar); document.removeEventListener('visibilitychange', atualizar); };
  }, []);
  useEffect(() => {
    let vivo = true;
    if (revisao === 0) setCarregando(true);
    api.listarOnboardings({ incluirRascunhos: true }).then(r => {
      if (!Array.isArray(r?.itens)) throw new Error('Não foi possível ler as oportunidades.');
      if (vivo) { setItens(r.itens); setErro(''); }
    }).catch(e => { if (vivo) setErro(e.message); }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [api, revisao, location.pathname]);
  const ativas = itens.filter(i => !['CONCLUIDO', 'DESISTIU'].includes(etapaDaOportunidade(i)));
  const fimDoDia = new Date(); fimDoDia.setHours(23, 59, 59, 999);
  const retornos = ativas.filter(i => i.retornoComercial?.dados?.quando && new Date(i.retornoComercial.dados.quando) <= fimDoDia).sort((a, b) => Date.parse(a.retornoComercial.dados.quando) - Date.parse(b.retornoComercial.dados.quando));
  const indicadores = {
    hoje: [retornos.length, 'retornos para hoje ou atrasados'],
    oportunidades: [ativas.filter(i => etapaDaOportunidade(i) !== 'ONBOARDING').length, 'oportunidades em andamento'],
    conversas: [resumoConversas.selo, 'mensagens comerciais não lidas'],
    onboarding: [ativas.filter(i => i.status === 'EM_TRILHA' && i.progresso?.total > i.progresso?.concluidas).length, 'onboardings com etapas pendentes'],
  };
  const indicador = id => {
    const [quantidade, descricao] = indicadores[id];
    if (!quantidade || (id !== 'conversas' && (carregando || erro))) return null;
    return <span className="commercial-tab-badge" aria-label={`${quantidade} ${descricao}`} title={`${quantidade} ${descricao}`}>{quantidade > 99 ? '99+' : quantidade}</span>;
  };
  const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtradas = (visao === 'hoje' ? ativas : itens).filter(i => (!etapa || etapaDaOportunidade(i) === etapa) && normalizar([nomeDaOportunidade(i), i.cnpj, i.responsavelNome].join(' ')).includes(normalizar(busca)));
  async function criar({ origem, modo }) {
    const r = await api.criarOnboarding(origem);
    if (!r?.onboarding?.id) throw new Error('Criação sem confirmação. Confira a lista antes de repetir.');
    setNovo(false);
    navigate(`/onboardings/${encodeURIComponent(r.onboarding.id)}${modo === 'escritorio' ? '/editar' : ''}`);
  }
  return <main className="commercial-workspace">
    <header className="commercial-heading"><div><span className="commercial-eyebrow">ALTAN · COMERCIAL</span><h1>{visao === 'hoje' ? 'Comercial' : visao === 'conversas' ? 'Conversas' : 'Oportunidades'}</h1></div><Button onClick={() => setNovo(true)}>+ Nova oportunidade</Button></header>
    <nav className="commercial-tabs" aria-label="Comercial">
      {[['hoje', '/comercial', 'Hoje'], ['oportunidades', '/comercial/oportunidades', 'Oportunidades'], ['conversas', '/comercial/conversas', 'Conversas']].map(([id, href, label]) => <Link key={id} to={href} aria-current={visao === id ? 'page' : undefined}>{label}{indicador(id)}</Link>)}
      <Link to="/onboardings">Onboarding{indicador('onboarding')}</Link><Link to="/biblioteca">Biblioteca</Link>
    </nav>
    {visao === 'conversas' ? <WhatsappPage key="comercial" api={api} area="comercial" usuarioId={usuarioId} companies={companies} mensagemBiblioteca={mensagemBiblioteca} onMensagemBibliotecaAberta={onMensagemBibliotecaAberta} /> : <>
      {erro && <div role="alert" className="commercial-error">{erro} <Button variant="secondary" onClick={() => setRevisao(v => v + 1)}>Tentar novamente</Button></div>}
      {carregando ? <p role="status">Carregando oportunidades…</p> : !erro && <>
        <section className="commercial-metrics" aria-label="Visão comercial">
          {[['', 'Em andamento', ativas.length], ['ANALISE', 'Em análise', ativas.filter(i => etapaDaOportunidade(i) === 'ANALISE').length], ['PROPOSTA', 'Propostas', ativas.filter(i => etapaDaOportunidade(i) === 'PROPOSTA').length], ['CONTRATADO', 'Contratações', ativas.filter(i => etapaDaOportunidade(i) === 'CONTRATADO').length]].map(([id, titulo, valor]) => <button type="button" key={titulo} aria-pressed={etapa === id} onClick={() => setEtapa(id)}><span>{titulo}</span><strong>{erro ? '—' : valor}</strong></button>)}
        </section>
        {visao === 'hoje' && retornos.length > 0 && <section className="commercial-returns" aria-label="Retornos de hoje"><h2>Retornos de hoje <span>{retornos.length}</span></h2>{retornos.map(item => <Link key={item.id} to={`/onboardings/${encodeURIComponent(item.id)}`}><strong>{nomeDaOportunidade(item)}</strong><span>{item.retornoComercial.dados.acao}</span><time>{new Date(item.retornoComercial.dados.quando).toLocaleString('pt-BR')}</time></Link>)}</section>}
        <section className="commercial-pipeline"><div className="commercial-list-heading"><h2>{visao === 'hoje' ? 'Em acompanhamento' : 'Todas as oportunidades'}</h2><div className="commercial-tools"><input aria-label="Buscar oportunidade" placeholder="Buscar nome ou CNPJ" value={busca} onChange={e => setBusca(e.target.value)} /><select aria-label="Etapa comercial" value={etapa} onChange={e => setEtapa(e.target.value)}><option value="">Todas as etapas</option>{ETAPAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div></div>
          {!filtradas.length ? <div className="commercial-empty"><span aria-hidden="true">↗</span><h2>{busca || etapa ? 'Nenhuma oportunidade encontrada' : 'Seu próximo cliente começa aqui'}</h2><p>{busca || etapa ? 'Ajuste a busca ou a etapa.' : 'Crie uma oportunidade para reunir a análise, a proposta e a contratação.'}</p>{!busca && !etapa && <Button onClick={() => setNovo(true)}>Criar oportunidade</Button>}</div> : <div className="commercial-list">{filtradas.map(item => <Link className="commercial-row" key={item.id} to={`/onboardings/${encodeURIComponent(item.id)}`}><span className="commercial-avatar" aria-hidden="true">{nomeDaOportunidade(item).slice(0, 1).toUpperCase()}</span><span className="commercial-client"><strong>{nomeDaOportunidade(item)}</strong><small>{servicoDaOportunidade(item)}</small></span><span className="commercial-stage">{ETAPAS.find(([id]) => id === etapaDaOportunidade(item))?.[1]}</span><span className="commercial-date">{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('pt-BR') : ''}</span><span aria-hidden="true">↗</span></Link>)}</div>}
        </section>
      </>}
    </>}
    {novo && <NovoAtendimentoModal onCriar={criar} onFechar={() => { setNovo(false); setRevisao(v => v + 1); }} />}
  </main>;
}
