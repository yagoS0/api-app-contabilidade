import React, { useEffect, useRef, useState } from 'react';

const dataBR = value => value?.split('-').reverse().join('/') || '—';
const moeda = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ConfigurarRecorrencia({ api, companyId, obterModelo, disabled = false, aoSalvar }) {
  const [aberto, setAberto] = useState(false);
  const [dia, setDia] = useState(1);
  const [inicio, setInicio] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [salva, setSalva] = useState(false);
  const enviando = useRef(false);
  const requestId = useRef(null);
  if (!api?.criarRecorrenciaNfse) return null;
  async function salvar() {
    if (enviando.current || disabled || salva) return;
    const modelo = obterModelo();
    if (!modelo) return;
    const texto = `Autorizar emissão automática mensal?\n\nTomador: ${modelo.tomador?.nome}\nDocumento: ${modelo.tomador?.cnpjCpf || modelo.tomador?.doc}\nValor: ${moeda(modelo.servico?.valorServicos)}\nServiço: ${modelo.servico?.descricao}\nDia: ${dia}\nPrimeira emissão: ${dataBR(inicio)}\n\nA competência será a data programada de cada mês. Nos meses sem esse dia, será usado o último dia. Confira também os tributos na prévia. Não haverá confirmação a cada mês. Você poderá pausar as próximas emissões.`;
    if (!window.confirm(texto)) return;
    enviando.current = true;
    setOcupado(true);
    setMensagem('');
    try {
      requestId.current ||= globalThis.crypto.randomUUID();
      await api.criarRecorrenciaNfse(companyId, { dia: Number(dia), inicio, modelo, confirmada: true, requestId: requestId.current });
      setSalva(true);
      setMensagem('Recorrência salva. Nenhuma nota foi emitida por este botão. Acompanhe as execuções na lista de notas recorrentes.');
      aoSalvar?.();
    } catch (e) { setMensagem(e.message || 'Não foi possível salvar.'); }
    finally { enviando.current = false; setOcupado(false); }
  }
  return <section style={{ border: '1px solid var(--border, #999)', borderRadius: 8, padding: 12, margin: '12px 0' }} aria-label="Configurar nota recorrente">
    <label><input type="checkbox" checked={aberto} disabled={ocupado || salva} onChange={e => setAberto(e.target.checked)} /> Emitir esta nota automaticamente todos os meses</label>
    {aberto && <div>
      <p>Mesmo tomador, descrição e valor. A competência acompanha a data programada. Dias 29–31 usam o último dia quando necessário.</p>
      <label>Dia mensal <input aria-label="Dia mensal" type="number" min="1" max="31" value={dia} disabled={ocupado || salva} onChange={e => setDia(Number(e.target.value))} /></label>{' '}
      <label>Primeira emissão <input aria-label="Primeira emissão" type="date" value={inicio} disabled={ocupado || salva} onChange={e => setInicio(e.target.value)} /></label>{' '}
      <button type="button" disabled={disabled || ocupado || salva || !inicio} onClick={salvar}>{ocupado ? 'Salvando…' : salva ? 'Recorrência salva' : 'Conferir e autorizar recorrência'}</button>
      <p>Salvar a recorrência agenda as próximas notas. O botão “Emitir nota” faz uma emissão avulsa adicional.</p>
    </div>}
    {mensagem && <p role="status">{mensagem}</p>}
  </section>;
}

export function ListaRecorrencias({ api, companyId, revisao = 0 }) {
  const [resposta, setResposta] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [datas, setDatas] = useState({});
  const [atualizar, setAtualizar] = useState(0);
  useEffect(() => {
    let ativo = true;
    setResposta(null);
    setErro('');
    if (api?.listarRecorrenciasNfse && companyId) {
      Promise.resolve().then(() => api.listarRecorrenciasNfse(companyId)).then(r => { if (ativo) setResposta(r); })
        .catch(e => { if (ativo) setErro(e.message || 'Não foi possível carregar as recorrências.'); });
    }
    return () => { ativo = false; };
  }, [api, companyId, revisao, atualizar]);
  if (!api?.listarRecorrenciasNfse) return null;
  async function alterar(item) {
    if (ocupado) return;
    if (!window.confirm(item.ativa ? 'Pausar as próximas emissões? Uma transmissão já iniciada poderá ser concluída.' : `Retomar a emissão automática mensal a partir de ${dataBR(datas[item.id])}, para ${item.modelo.tomador.nome}, no valor de ${moeda(item.modelo.servico.valorServicos)}?`)) return;
    setOcupado(true);
    setErro('');
    try {
      await api.alterarRecorrenciaNfse(companyId, item.id, item.ativa ? 'pausar' : 'retomar', { inicio: datas[item.id], confirmada: true });
      setAtualizar(v => v + 1);
    } catch (e) { setErro(e.message); }
    finally { setOcupado(false); }
  }
  return <details style={{ margin: '16px 0' }}>
    <summary>Notas recorrentes {resposta ? `(${resposta.items.length})` : ''}</summary>
    <button type="button" onClick={() => setAtualizar(v => v + 1)} disabled={ocupado}>Atualizar recorrências</button>
    {erro && <p role="alert">{erro}</p>}
    {resposta?.workerAtivo === false && <p>A emissão automática está desligada neste ambiente. Os agendamentos serão salvos, mas não executados.</p>}
    {resposta?.items.length === 0 && <p>Nenhuma nota recorrente. Configure uma no formulário de emissão.</p>}
    {resposta?.items.map(item => <article key={item.id} style={{ borderBottom: '1px solid #999', padding: 12 }}>
      <strong>{item.modelo.tomador.nome} · {moeda(item.modelo.servico.valorServicos)}</strong>
      <p>{item.modelo.servico.descricao}</p>
      <p>{item.ativa ? 'Ativa' : 'Pausada'} · Dia {item.dia} · {item.ativa ? 'Próxima' : 'Data registrada'}: {dataBR(item.proximaData)} · {item.ambiente === 'homolog' ? 'Homologação' : 'Produção'}</p>
      {!item.ativa && <label>Nova primeira emissão <input type="date" aria-label={`Retomar ${item.modelo.tomador.nome}`} value={datas[item.id] || ''} onChange={e => setDatas({ ...datas, [item.id]: e.target.value })} /></label>}
      <button type="button" disabled={ocupado || (!item.ativa && !datas[item.id])} onClick={() => alterar(item)}>{item.ativa ? 'Pausar' : 'Retomar'}</button>
      {item.execucoes.length > 0 && <ul>{item.execucoes.map(run => <li key={run.id}>{run.competencia} — {run.status === 'EXECUTANDO' ? 'Em andamento ou interrompida; não será repetida automaticamente' : run.status === 'EMITIDA' ? 'Emitida' : 'Revisão necessária'}{run.erro ? `: ${run.erro}` : ''}{run.invoiceId ? ` · Registro da nota: ${run.invoiceId}` : ''}</li>)}</ul>}
    </article>)}
  </details>;
}
