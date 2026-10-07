import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { resumoOrigensParcelamento } from '../../../../../../../packages/shared/src/accounting/composicaoParcelamento.js';
const dinheiro = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = s => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—';

export function DividasCircular({ listar, tipo, selecionadas = [], onSelecionar, onAplicar, disabled = false }) {
  const [estado, setEstado] = useState({ loading: true, items: [], habilitado: false });
  const [filtro, setFiltro] = useState('');
  const [versao, setVersao] = useState(0);
  const todos = useRef(null);
  useEffect(() => {
    let ativo = true;
    setEstado({ loading: true, items: [], habilitado: false });
    Promise.resolve().then(() => listar(tipo)).then(r => {
      if (ativo) setEstado({ loading: false, items: r.debitos || [], habilitado: r.habilitado });
    }).catch(e => {
      if (ativo) setEstado({ loading: false, items: [], habilitado: true, erro: e.message });
    });
    return () => { ativo = false; };
  }, [listar, tipo, versao]);
  const visiveis = estado.items.filter(o => (o.tributo + ' ' + o.competencia).toLowerCase().includes(filtro.toLowerCase()));
  const ids = new Set(selecionadas.map(o => o.chave));
  const elegiveis = visiveis.filter(o => o.elegivel);
  const marcados = elegiveis.filter(o => ids.has(o.chave)).length;
  const fora = selecionadas.filter(o => !visiveis.some(v => v.chave === o.chave)).length;
  useEffect(() => { if (todos.current) todos.current.indeterminate = marcados > 0 && marcados < elegiveis.length; }, [marcados, elegiveis.length, estado.loading]);
  const trocar = (items, marcar) => {
    const mapa = new Map(selecionadas.map(o => [o.chave, o]));
    for (const o of items) marcar ? mapa.set(o.chave, o) : mapa.delete(o.chave);
    onSelecionar([...mapa.values()]);
  };
  if (estado.loading) return <p role="status">Carregando dívidas da Circular…</p>;
  if (!estado.habilitado) return null;
  if (estado.erro) return <div role="alert">{estado.erro} <Button disabled={disabled} onClick={() => setVersao(v => v + 1)}>Tentar novamente</Button></div>;
  return <section style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
    <strong>Dívidas da Circular</strong>
    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0' }}>Selecione o saldo em aberto que compõe o acordo. Sem dívidas cadastradas, continue com a composição manual.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input aria-label="Filtrar dívidas da Circular" placeholder="Imposto ou competência" value={filtro} onChange={e => setFiltro(e.target.value)} />
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setVersao(v => v + 1)}>Atualizar dívidas</Button>
    </div>
    <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', minWidth: 0, fontSize: 13 }}>
        <thead><tr><th><input ref={todos} type="checkbox" aria-label="Selecionar todas as dívidas visíveis" disabled={disabled || !elegiveis.length} checked={!!elegiveis.length && marcados === elegiveis.length} onChange={e => trocar(elegiveis, e.target.checked)} /></th><th>Imposto</th><th>Competência</th><th>Vencimento</th><th>Saldo</th><th>Situação</th></tr></thead>
        <tbody>{visiveis.map(o => <tr key={o.chave}>
          <td><input aria-label={'Selecionar ' + o.tributo + ' ' + o.competencia} type="checkbox" checked={ids.has(o.chave)} disabled={disabled || !o.elegivel} onChange={e => trocar([o], e.target.checked)} /></td>
          <td>{o.tributo}</td><td>{o.competencia}</td><td>{data(o.vencimento)}</td><td style={{ whiteSpace: 'nowrap' }}>{dinheiro(o.saldo)}</td><td>{o.motivo || (o.semProvisao ? 'Guia sem provisão' : 'Em aberto')}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!visiveis.length && <p>Nenhuma dívida encontrada neste filtro.</p>}
    {selecionadas.length > 0 && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      <span>{selecionadas.length} selecionada(s) · {dinheiro(selecionadas.reduce((s, o) => s + Number(o.saldo), 0))}{fora > 0 ? ' · ' + fora + ' fora do filtro' : ''}</span>
      {onAplicar && <Button disabled={disabled} size="sm" onClick={() => onAplicar(selecionadas)}>Sugerir lançamentos</Button>}
      <Button disabled={disabled} size="sm" variant="secondary" onClick={() => onSelecionar([])}>Limpar seleção</Button>
      <small>{resumoOrigensParcelamento(selecionadas)}</small>
    </div>}
  </section>;
}
