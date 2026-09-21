import { CARDS_FLUXO, resumoMensal } from '../../../../../packages/shared/src/fluxoMensal';
import { linhaDoMes } from './lib/tabelaDoFluxo';
import { rotuloDoMes } from './lib/leituraDoFluxo';
import { brl } from '../../lib/format';

export function FluxoMensal({ mes, competencia, aoAbrir, comFolha }) {
  if (!mes) return <p role="status">{rotuloDoMes(competencia)} não veio nesta consulta.</p>;
  const total = resumoMensal(mes, linhaDoMes);
  return <section className="fluxo-mensal" aria-label={`Resumo de ${rotuloDoMes(competencia)}`}>
    <h3>{rotuloDoMes(competencia)}</h3>
    <div className="fluxo-mensal-cards">
      {CARDS_FLUXO.map(card => <button type="button" className="fluxo-mensal-card" key={card.chave}
        aria-label={`Ver ${card.rotulo.toLowerCase()} de ${rotuloDoMes(competencia)}`}
        onClick={() => aoAbrir(card.chave)}>
        <span>{card.rotulo}</span><strong>{brl(total[card.chave]?.valor)}</strong>
        <small>{card.chave === 'folha' && !comFolha ? 'Folha não disponível' : total[card.chave]?.status === 'forecast' ? 'Inclui valores a pagar ou previstos' : total[card.chave] ? 'Movimentações registradas' : 'Sem movimentos informados'}</small>
        {card.descricao && <small>{card.descricao}</small>}
        <span className="fluxo-mensal-link">Ver detalhes →</span>
      </button>)}
    </div>
    <p className="hint">Acumulado projetado: {brl(mes.saldo?.final)} · Não representa saldo bancário.</p>
  </section>;
}
