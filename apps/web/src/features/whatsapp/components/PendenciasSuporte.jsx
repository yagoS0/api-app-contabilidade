import { novaIntencao } from '../lib/atendimentoPwa';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { notificarDemandaSuporteAtualizada } from '../lib/leituraConfirmada';

function mensagemDaRecusa(error) {
  const codigo = error?.code || error?.payload?.code || error?.message;
  const mensagens = {
    versao_conflitante: 'Esta solicitação foi alterada por outra pessoa. Atualize a fila e confira antes de tentar novamente.',
    origem_legada_nao_comprovada: 'Não foi possível comprovar a origem desta demanda. Confira a conversa e o vínculo da empresa antes de adotar.',
    solicitacao_nao_encontrada: 'Esta solicitação não está mais disponível no seu acesso. Atualize a fila.',
    origem_alterada: 'O vínculo desta solicitação mudou. Atualize a fila e confira a empresa.',
    acesso_negado: 'Seu acesso não permite esta ação. Confira a permissão com o responsável pelo escritório.',
    autenticacao_obrigatoria: 'Sua sessão expirou. Entre novamente para continuar.',
    solicitacao_indisponivel: 'Não foi possível atualizar a solicitação. Atualize a fila para conferir o resultado antes de repetir.',
    chave_reutilizada: 'Esta ação já foi usada com outros dados. Atualize a fila antes de continuar.',
  };
  return mensagens[codigo] || (/^[a-z]+(?:_[a-z0-9]+)+$/i.test(error?.message || '')
    ? 'Não foi possível atualizar a solicitação. Atualize a fila e confira os dados antes de tentar novamente.'
    : error?.message || 'Não foi possível atualizar o atendimento.');
}

export function PendenciasSuporte({ api, onAbrir, companyId = null }) {
  const [fila, setFila] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const [excluir, setExcluir] = useState(null), [aviso, setAviso] = useState('');
  const [recarregar, setRecarregar] = useState(0);
  const [pagina, setPagina] = useState(null);
  const cursor = pagina?.companyId === companyId ? pagina.cursor : null;
  const resumoFila = useRef(null);
  const comandos = useRef(new Map());
  const trava = useRef(false), geracao = useRef(0), leitura = useRef(0);
  const carregar = useCallback(async () => {
    const r = cursor ? await api.getPendenciasSuporte(companyId, { cursor }) : await api.getPendenciasSuporte(companyId);
    if (!r?.ok || !Array.isArray(r.itens)) throw new Error('Não foi possível ler os atendimentos da equipe.');
    return r;
  }, [api, companyId, cursor]);
  useEffect(() => { const geracaoDaExecucao = geracao;
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
    return () => { geracaoDaExecucao.current++; clearInterval(timer); };
  }, [api, companyId, recarregar, carregar]);
  function navegarFila(alterar) {
    if (trava.current) return;
    resumoFila.current?.focus();
    alterar();
  }
  async function agir(item, acao) {
    if (trava.current) return;
    // Foco sai do acionador antes de desabilitar/remover o item; respostas tardias não o movem.
    if (acao === 'resolver') resumoFila.current?.focus();
    const atual = geracao.current;
    leitura.current++;
    trava.current = true; setOcupado(true); setErro(''); setAviso('');
    try {
      const individual = ['aceitar', 'resolver', 'adotar'].includes(acao);
      const fn = acao === 'aceitar' ? api.assumirSolicitacao : acao === 'resolver' ? api.concluirSolicitacao : acao === 'adotar' ? api.adotarSolicitacao : acao === 'excluir' ? api.excluirDemandaSuporte : api.devolverConversaWhatsapp;
      const identidade = [companyId, item.id, item.versao, acao].join(':');
      if (!comandos.current.has(identidade)) comandos.current.set(identidade, novaIntencao());
      const resultado = individual ? await fn(item.id, { chave: comandos.current.get(identidade), versao: item.versao }) : acao === 'excluir' ? await fn(item.conversaId, item.id) : await fn(item.conversaId);
      if (resultado?.ok !== true || (individual && !resultado.item)) throw Object.assign(new Error(resultado?.message || resultado?.error || 'Não foi possível atualizar a demanda.'), { code: resultado?.code });
      if (geracao.current !== atual) return;
      notificarDemandaSuporteAtualizada();
      setExcluir(null);
      if (acao === 'excluir') {
        setFila(f => f ? { ...f, total: Math.max(0, f.total - (f.itens.some(i => i.id === item.id) ? 1 : 0)), itens: f.itens.filter(i => i.id !== item.id) } : f);
        setAviso('Demanda excluída da fila. A conversa foi preservada.');
      }
      try { const r = await carregar(); if (geracao.current === atual) setFila(r); }
      catch { if (geracao.current === atual) setErro('A ação foi concluída, mas a fila não pôde ser atualizada.'); }
      // Opening the chat is a separate explicit action.
    } catch (e) { if (geracao.current === atual) setErro(mensagemDaRecusa(e)); }
    finally { if (geracao.current === atual) { trava.current = false; setOcupado(false); } }
  }
  if (!api.getPendenciasSuporte) return null;
  return <><details className="wa-support-queue" open={companyId ? true : undefined}>
    <summary ref={resumoFila}>{companyId ? 'Pedidos ao contador' : 'Equipe'}{fila ? ' · ' + fila.total : ''}</summary>
    {erro && <div role="alert"><p>{erro}</p><Button size="lg" variant="secondary" disabled={ocupado} onClick={() => navegarFila(() => setRecarregar(n => n + 1))}>Tentar novamente</Button></div>}{aviso && <p role="status">{aviso}</p>}
    {fila === null && !erro && <p role="status">Carregando demandas…</p>}
    {fila?.total === 0 && <p>Nenhum atendimento pendente.</p>}
    {fila?.itens.map(item => <article key={item.id}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong>{item.empresa || 'Atendimento'}</strong>{item.conversaId && <Button size="lg" variant="secondary" type="button" onClick={() => onAbrir(item.conversaId)}>Ver conversa</Button>}</div>
      <p>{item.titulo || item.motivo}</p>{item.resumo && item.resumo !== (item.titulo || item.motivo) && <p>{item.resumo}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {item.contratoVersao !== 1 ? <Button size="lg" disabled={ocupado || !api.adotarSolicitacao} onClick={() => agir(item, 'adotar')}>Adotar solicitação</Button> : <><Button size="lg" disabled={ocupado || !api.assumirSolicitacao} onClick={() => agir(item, 'aceitar')}>Atribuir a mim e iniciar</Button><Button size="lg" variant="secondary" disabled={ocupado || !api.concluirSolicitacao} onClick={() => agir(item, 'resolver')}>Concluir solicitação</Button></>}
        {item.contratoVersao !== 1 && <Button size="lg" variant="secondary" disabled={ocupado || !api.excluirDemandaSuporte} onClick={() => { setErro(''); setExcluir(item); }}>Excluir demanda</Button>}
        {item.conversaId && <Button size="lg" variant="secondary" disabled={ocupado || !api.devolverConversaWhatsapp} onClick={() => agir(item, 'devolver')}>Devolver atendimento à IA</Button>}
      </div>
    </article>)}
    {(cursor || fila?.proximoCursor) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {cursor && <Button size="lg" variant="secondary" disabled={ocupado} onClick={() => navegarFila(() => setPagina(null))}>Voltar ao início</Button>}
      {fila?.proximoCursor && <Button size="lg" variant="secondary" disabled={ocupado} onClick={() => navegarFila(() => setPagina({ companyId, cursor: fila.proximoCursor }))}>Próximas solicitações</Button>}
    </div>}
  </details>
  {excluir && <Modal titulo="Excluir demanda da fila?" tamanho="sm" ocupado={ocupado} fecharAoClicarFundo={false} aoFechar={() => { if (!ocupado) setExcluir(null); }} rodape={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><Button size="lg" variant="secondary" disabled={ocupado} onClick={() => setExcluir(null)}>Cancelar</Button><Button size="lg" variant="danger" disabled={ocupado} onClick={() => agir(excluir, 'excluir')}>{ocupado ? 'Excluindo…' : 'Confirmar exclusão'}</Button></div>}>
    <p><strong>{excluir.empresa || 'Atendimento'}</strong> · {excluir.motivo || 'Pedido à equipe'}</p>
    {excluir.resumo && <p>{excluir.resumo}</p>}
    <p>A demanda sairá da fila. A conversa e o histórico serão preservados. Nenhuma mensagem será enviada e a IA não será reativada.</p>
    {erro && <p role="alert">{erro}</p>}
  </Modal>}
  </>;
}

export function ConsumoIaDetalhado({ api }) {
  const [consumo, setConsumo] = useState(null), [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const emCurso = useRef(false);
  if (!api.getConsumoIaDetalhado) return null;
  async function carregar() {
    if (emCurso.current) return;
    emCurso.current = true; setCarregando(true); setErro('');
    try { const r = await api.getConsumoIaDetalhado(); if (!r?.ok || !r.consumo || !Array.isArray(r.consumo.itens)) throw new Error(); setConsumo(r.consumo); }
    catch { setErro('Consumo indisponível.'); }
    finally { emCurso.current = false; setCarregando(false); }
  }
  const usd = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v);
  return <details className="wa-cost-breakdown" onToggle={e => { if (e.currentTarget.open) carregar(); }}><summary>Custos por área</summary>
    {carregando && <p role="status">Carregando consumo…</p>}
    {erro && <div><p role="alert">{erro}{consumo ? ' Os valores abaixo são da última leitura disponível.' : ''}</p><Button size="sm" variant="secondary" onClick={carregar}>Tentar novamente</Button></div>}
    {consumo && <>
    <p>Estimativa do mês: {usd(consumo.custoUsd)}</p><p>Reservado: {usd(consumo.reservaUsd)}</p>
    {['Suporte', 'Comercial', 'Outros'].map(area => {
      const itens = consumo.itens.filter(i => i.area === area);
      return <p key={area}>{area}: {usd(itens.reduce((s, i) => s + i.custoUsd, 0))} · {itens.reduce((s, i) => s + i.chamadas, 0)} chamadas</p>;
    })}
    <small>Valores antigos mantêm o arredondamento original.</small>
  </>}</details>;
}
