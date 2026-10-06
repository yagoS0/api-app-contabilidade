import { useId, useState } from 'react';
import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';
import { dataLocal } from '../lib/agendaWorkspace';
import { editarJanela } from '../lib/editarJanela';

export function MiniCalendarioAgenda({ dataInicio = '', dataFim = '', onChange }) {
  const [mes, setMes] = useState((dataInicio || dataFim || dataLocal()).slice(0,7));
  const [extremo, setExtremo] = useState('dataInicio');
  const [previa, setPrevia] = useState(null);
  const instrucaoId = useId();
  const primeiro = mes + '-01';
  const inicio = somarDiasAgenda(primeiro, -new Date(primeiro + 'T12:00:00Z').getUTCDay());
  const fimVisual = extremo === 'dataFim' && previa && dataInicio ? previa : dataFim;
  const [deVisual,ateVisual] = dataInicio && fimVisual ? [dataInicio,fimVisual].sort() : [dataInicio,dataFim];
  function navegar(delta) {
    const date = new Date(primeiro + 'T12:00:00Z');
    date.setUTCMonth(date.getUTCMonth()+delta);
    setMes(date.toISOString().slice(0,7));
    setPrevia(null);
  }
  function selecionar(dia) {
    if (extremo === 'dataInicio' || !dataInicio) {
      onChange({dataInicio:dia,dataFim:dia});
      setExtremo('dataFim');
    } else {
      const [de,ate] = [dataInicio,dia].sort();
      onChange({dataInicio:de,dataFim:ate});
      setExtremo('dataInicio');
    }
    setPrevia(null);
  }
  function editar(chave, valor) {
    const datas = editarJanela({dataInicio,dataFim},chave,valor);
    onChange(datas);
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) setMes(valor.slice(0,7));
  }
  return <div className="agenda-mini-calendar" aria-label="Escolher período" aria-describedby={instrucaoId}>
    <div className="agenda-form-row agenda-range-fields">
      {[['dataInicio','De',dataInicio],['dataFim','Até',dataFim]].map(([chave,rotulo,valor]) => <label key={chave} className={'agenda-field' + (extremo === chave ? ' is-active' : '')}>
        {rotulo}<input type="date" required aria-label={rotulo} value={valor} min={chave === 'dataFim' ? dataInicio : undefined}
          onFocus={() => {setExtremo(chave);setPrevia(null);if(valor)setMes(valor.slice(0,7));}}
          onClick={e => e.preventDefault()} onKeyDown={e => {if(e.altKey && e.key === 'ArrowDown')e.preventDefault();}}
          onChange={e => editar(chave,e.target.value)} />
      </label>)}
    </div>
    <p className="agenda-range-hint" id={instrucaoId} aria-live="polite">{extremo === 'dataInicio' ? 'Selecione o início do período' : 'Agora selecione o fim do período'}</p>
    <div className="agenda-mini-heading"><strong>{new Date(primeiro + 'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</strong><button type="button" aria-label="Mês anterior na seleção" onClick={() => navegar(-1)}>‹</button><button type="button" aria-label="Próximo mês na seleção" onClick={() => navegar(1)}>›</button></div>
    <div className="agenda-mini-days" onMouseLeave={() => setPrevia(null)}>{['D','S','T','Q','Q','S','S'].map((d,i) => <span key={i} aria-hidden="true">{d}</span>)}{Array.from({length:42},(_,i) => {
      const dia = somarDiasAgenda(inicio,i);
      const classes = [dia.slice(0,7) !== mes && 'is-outside', dia > deVisual && dia < ateVisual && 'is-in-range', dia === deVisual && 'is-range-start', dia === ateVisual && 'is-range-end'].filter(Boolean).join(' ');
      return <button type="button" key={dia} className={classes} aria-pressed={dia === dataInicio || dia === dataFim} aria-label={'Selecionar ' + dia.split('-').reverse().join('/')} onMouseEnter={() => setPrevia(dia)} onFocus={() => setPrevia(dia)} onClick={() => selecionar(dia)}>{Number(dia.slice(8))}</button>;
    })}</div>
  </div>;
}
