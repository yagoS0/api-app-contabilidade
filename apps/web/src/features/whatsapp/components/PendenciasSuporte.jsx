import { useEffect, useState } from 'react';

export function PendenciasSuporte({ api, onAbrir }) {
  const [fila, setFila] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const carregar = async () => {
    const r = await api.getPendenciasSuporte();
    if (!r?.ok || !Array.isArray(r.itens)) throw new Error('Não foi possível ler os atendimentos da equipe.');
    return r;
  };
  useEffect(() => {
    if (!api.getPendenciasSuporte) return;
    let vivo = true;
    const atualizar = async () => { try { const r = await carregar(); if (vivo) { setFila(r); setErro(''); } } catch { if (vivo) setErro('Fila de suporte indisponível.'); } };
    atualizar(); const timer = setInterval(atualizar, 30000);
    return () => { vivo = false; clearInterval(timer); };
  }, [api]);
  async function agir(item, acao) {
    setOcupado(true); setErro('');
    try {
      const fn = acao === 'assumir' ? api.assumirConversaWhatsapp : acao === 'resolver' ? api.resolverSuporte : api.devolverConversaWhatsapp;
      await fn(item.conversaId); setFila(await carregar()); onAbrir(item.conversaId);
    } catch (e) { setErro(e.message || 'Não foi possível atualizar o atendimento.'); }
    finally { setOcupado(false); }
  }
  if (!api.getPendenciasSuporte) return null;
  return <details className="wa-support-queue">
    <summary>Equipe{fila ? ` · ${fila.total}` : ''}</summary>
    {erro && <p role="alert">{erro}</p>}
    {fila?.total === 0 && <p>Nenhum atendimento pendente.</p>}
    {fila?.itens.map(item => <article key={item.id}>
      <button type="button" onClick={() => onAbrir(item.conversaId)}><strong>{item.empresa || 'Atendimento'}</strong></button>
      <p>{item.motivo}</p><p>{item.resumo}</p>
      <div>
        {item.estado === 'AGUARDANDO' ? <button disabled={ocupado} onClick={() => agir(item, 'assumir')}>Assumir</button> : <button disabled={ocupado} onClick={() => agir(item, 'resolver')}>Resolver</button>}
        <button disabled={ocupado} onClick={() => agir(item, 'devolver')}>Devolver à IA</button>
      </div>
    </article>)}
  </details>;
}

export function ConsumoIaDetalhado({ api }) {
  const [consumo, setConsumo] = useState(null), [erro, setErro] = useState('');
  if (!api.getConsumoIaDetalhado) return null;
  async function carregar(e) {
    if (!e.currentTarget.open) return;
    try { const r = await api.getConsumoIaDetalhado(); if (!r?.ok) throw new Error(); setConsumo(r.consumo); setErro(''); }
    catch { setErro('Consumo indisponível.'); }
  }
  const usd = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v);
  return <details className="wa-cost-breakdown" onToggle={carregar}><summary>Custos por área</summary>{erro && <p role="alert">{erro}</p>}{consumo && <>
    <p>Estimativa do mês: {usd(consumo.custoUsd)}</p><p>Reservado: {usd(consumo.reservaUsd)}</p>
    {['Suporte', 'Comercial', 'Outros'].map(area => {
      const itens = consumo.itens.filter(i => i.area === area);
      return <p key={area}>{area}: {usd(itens.reduce((s, i) => s + i.custoUsd, 0))} · {itens.reduce((s, i) => s + i.chamadas, 0)} chamadas</p>;
    })}
    <small>Valores antigos mantêm o arredondamento original.</small>
  </>}</details>;
}
