import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { PRIORIDADES, RECORTES, SITUACOES } from '../hooks/useSolicitacoes';

export function FiltrosSolicitacoes({ search, alterar, data }) {
  const params = new URLSearchParams(search);
  const buscaAtual = params.get('busca') || '';
  const [busca, setBusca] = useState(buscaAtual);
  const buscaRef = useRef(null);
  useEffect(() => setBusca(buscaAtual), [buscaAtual]);
  const responsavel = params.get('responsavelId');
  const empresa = params.get('portalClientId');
  const nome = (tipo, id) => data?.itens.find(item => item.apresentacao?.[tipo]?.id === id)?.apresentacao[tipo]?.nome;
  const select = (key, label, opcoes, padrao = '') => <label>{label}<select value={params.get(key) ?? padrao} onChange={event => alterar({ [key]: event.target.value || undefined })}>
    {Object.entries(opcoes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
  </select></label>;
  return <div className="solicitacoes__filters">
    <form className="solicitacoes__search" onSubmit={event => { event.preventDefault(); alterar({ busca: busca.trim() || undefined }); }}>
      <label>Buscar empresa ou assunto<input ref={buscaRef} type="search" value={busca} maxLength={200} onChange={event => setBusca(event.target.value)} /></label>
      <Button type="submit">Buscar</Button>
    </form>
    {select('situacao', 'Situação', SITUACOES, 'ABERTAS')}
    {select('prioridade', 'Prioridade', { '': 'Todas', ...PRIORIDADES })}
    {select('responsavelId', 'Responsável', { '': 'Todos', null: 'Sem responsável', ...(responsavel && responsavel !== 'null' ? { [responsavel]: nome('responsavel', responsavel) || 'Responsável filtrado · nome indisponível' } : {}) })}
    {select('triagem', 'Vínculo', { '': 'Todos', true: 'Em triagem', false: 'Com empresa' })}
    {select('recorte', 'Recorte', { '': 'Todos', ...RECORTES })}
    {empresa && <Button variant="secondary" onClick={() => {
      // Transferir antes de desmontar o botão, somente no gesto explícito.
      buscaRef.current?.focus({ preventScroll: true });
      alterar({ portalClientId: undefined });
    }}>Remover filtro de empresa: {nome('empresa', empresa) || 'nome indisponível'}</Button>}
    <Button variant="secondary" onClick={() => alterar(null)}>Limpar filtros</Button>
  </div>;
}
