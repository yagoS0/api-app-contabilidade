import { dataCivilValida, PRIORIDADES, SITUACOES } from '../hooks/useSolicitacoes';

function nome(item, tipo, id) {
  const apresentacao = item.apresentacao?.[tipo];
  return apresentacao?.id === id && apresentacao.nome ? apresentacao.nome : 'Nome indisponível';
}
export function TabelaSolicitacoes({ data, scrollRef, onScroll }) {
  return <div className="solicitacoes__table-scroll" ref={scrollRef} onScroll={onScroll} role="region" aria-label="Lista de solicitações" tabIndex={0}>
    <table className="solicitacoes__table">
      <thead><tr>{['Solicitação', 'Empresa', 'Prioridade', 'Responsável', 'Prazo', 'Situação'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.itens.map(item => {
        const prazo = item.prazoCivil;
        const valido = dataCivilValida(prazo);
        const atrasada = valido && prazo < data.hoje && !['CONCLUIDA', 'ENCERRADA_LEGADO'].includes(item.situacao);
        return <tr key={item.id}>
          <td><span className="solicitacoes__title">{item.titulo || item.motivo || 'Título indisponível'}</span>{item.resumo && <span className="solicitacoes__description">{item.resumo}</span>}</td>
          <td>{item.portalClientId ? <>{nome(item, 'empresa', item.portalClientId)}{data.itens.some(other => other.portalClientId && other.portalClientId !== item.portalClientId && nome(other, 'empresa', other.portalClientId) === nome(item, 'empresa', item.portalClientId)) && <span className="solicitacoes__description">Referência: {item.portalClientId}</span>}</> : item.triagem === true ? 'Em triagem' : 'Vínculo a verificar'}</td>
          <td><span className={item.prioridade === 'ALTA' ? 'solicitacoes__attention' : ''}>{PRIORIDADES[item.prioridade ?? 'null'] || 'A verificar'}</span></td>
          <td>{item.responsavelId ? nome(item, 'responsavel', item.responsavelId) : 'Sem responsável'}</td>
          <td>{!prazo ? 'Sem prazo' : valido ? <><time dateTime={prazo}>{prazo.split('-').reverse().join('/')}</time>{atrasada && <span className="solicitacoes__attention solicitacoes__description">Atrasada</span>}</> : 'Prazo a verificar'}</td>
          <td>{SITUACOES[item.situacao] || 'A verificar'}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
