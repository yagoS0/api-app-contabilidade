import { CalendarioAgenda } from '../calendario/components/CalendarioAgenda';

// Uses the same task source and interactions as Calendário, scoped to one day.
export function OperationsDailyCalendar({ api, empresas, onOpenCompany, initialDate }) {
  return <section className="operacoes-calendario" aria-label="Tarefas do dia">
    <h3>Tarefas do dia</h3>
    <CalendarioAgenda
      api={api}
      empresas={empresas}
      onOpenCompany={onOpenCompany}
      initialContext={{ referencia: initialDate, visao: 'dia' }}
      somenteDia
    />
  </section>;
}
