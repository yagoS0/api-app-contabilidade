import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { notificarDemandaSuporteAtualizada } from '../lib/leituraConfirmada';

export function PendenciasSuporte({ api, onAbrir, companyId = null }) {
  const [fila, setFila] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const [excluir, setExcluir] = useState(null), [aviso, setAviso] = useState('');
  const trava = useRef(false), geracao = useRef(0), leitura = useRef(0);
  const carregar = async () => {
    const r = await api.getPendenciasSuporte(companyId);
    if (!r?.ok || !Array.isArray(r.itens)) throw new Error('Não foi possível ler os atendimentos da equipe.');
    return r;
  };
  useEffect(() => {
    const atual = ++geracao.current;
    trava.current = false; setOcupado(false); setExcluir(null); setAviso(''); setFila(null); setErro('');
    if (!api.getPendenciasSuporte) return;
    const atualizar = async () => {
      if (trava.current) return;
      const pedido = ++leitura.current;
      try { const r = await carregar(); if (geracao.current === atual && pedido === leitura.current && !trava.current) { setFila(r); setErro(''); } }
      catch { if (geracao.current === atual && pedido === leitura.current && !trava.current) setErro('Fila de suporte indisponível.'); }
    };
    atualizar(); const timer = setInterval(atualizar, 30000);
    return () => { geracao.current++; clearInterval(timer); };
  }, [api, companyId]);
  async function agir(item, acao) {
    if (trava.current) return;
    const atual = geracao.current;
    leitura.current++;
    trava.current = true; setOcupado(true); setErro(''); setAviso('');
    try {
      const fn = acao === 'aceitar' ? api.assumirConversaWhatsapp : acao === 'resolver' ? api.resolverSuporte : acao === 'excluir' ? api.excluirDemandaSuporte : api.devolverConversaWhatsapp;
      const resultado = acao === 'excluir' ? await fn(item.conversaId, item.id) : await fn(item.conversaId);
      if (resultado?.ok === false) throw new Error(resultado.message || 'Não foi possível atualizar a demanda.');
      if (geracao.current !== atual) return;
      notificarDemandaSuporteAtualizada();
      setExcluir(null);
      if (acao === 'excluir') {
        setFila(f => f ? { ...f, total: Math.max(0, f.total - (f.itens.some(i => i.id === item.id) ? 1 : 0)), itens: f.itens.filter(i => i.id !== item.id) } : f);
        setAviso('Demanda excluída da fila. A conversa foi preservada.');
      }
      try { const r = await carregar(); if (geracao.current === atual) setFila(r); }
      catch { if (geracao.current === atual) setErro('A ação foi concluída, mas a fila não pôde ser atualizada.'); }
      if (geracao.current === atual && acao !== 'excluir') onAbrir(item.conversaId);
    } catch (e) { if (geracao.current === atual) setErro(e.message || 'Não foi possível atualizar o atendimento.'); }
    finally { if (geracao.current === atual) { trava.current = false; setOcupado(false); } }
  }
  if (!api.getPendenciasSuporte) return null;
  return <><details className="wa-support-queue" open={companyId ? true : undefined}>
    <summary>{companyId ? 'Pedidos ao contador' : 'Equipe'}{fila ? ' · ' + fila.total : ''}</summary>
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {fila === null && !erro && <p role="status">Carregando demandas…</p>}
    {fila?.total === 0 && <p>Nenhum atendimento pendente.</p>}
    {fila?.itens.map(item => <article key={item.id}>
      <Button variant="secondary" type="button" onClick={() => onAbrir(item.conversaId)}><strong>{item.empresa || 'Atendimento'}</strong></Button>
      <p>{item.motivo}</p>{item.resumo && <p>{item.resumo}</p>}
      <div>
        {item.estado === 'AGUARDANDO' ? <Button disabled={ocupado || !api.assumirConversaWhatsapp} onClick={() => agir(item, 'aceitar')}>Aceitar</Button> : <Button variant="secondary" disabled={ocupado || !api.resolverSuporte} onClick={() => agir(item, 'resolver')}>Resolver</Button>}
        <Button variant="secondary" disabled={ocupado || !api.excluirDemandaSuporte} onClick={() => { setErro(''); setExcluir(item); }}>Excluir demanda</Button>
        <Button variant="secondary" disabled={ocupado || !api.devolverConversaWhatsapp} onClick={() => agir(item, 'devolver')}>Devolver à IA</Button>
      </div>
    </article>)}
  </details>
  {excluir && <Modal titulo="Excluir demanda da fila?" tamanho="sm" ocupado={ocupado} fecharAoClicarFundo={false} aoFechar={() => { if (!ocupado) setExcluir(null); }} rodape={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><Button variant="secondary" disabled={ocupado} onClick={() => setExcluir(null)}>Cancelar</Button><Button variant="danger" disabled={ocupado} onClick={() => agir(excluir, 'excluir')}>{ocupado ? 'Excluindo…' : 'Confirmar exclusão'}</Button></div>}>
    <p><strong>{excluir.empresa || 'Atendimento'}</strong> · {excluir.motivo || 'Pedido à equipe'}</p>
    {excluir.resumo && <p>{excluir.resumo}</p>}
    <p>A demanda sairá da fila. A conversa e o histórico serão preservados. Nenhuma mensagem será enviada e a IA não será reativada.</p>
    {erro && <p role="alert">{erro}</p>}
  </Modal>}
  </>;
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
