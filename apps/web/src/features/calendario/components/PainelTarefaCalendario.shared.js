

export const textoAlertaTarefa = alerta => ({ AMANHA:'Vence amanhã', HOJE:'Vence hoje', ATRASADA:'Atrasada' }[alerta] || '');

export const empresaConcluida = empresa => empresa.subtarefas?.length ? empresa.subtarefas.every(s => s.concluida) : Boolean(empresa.concluida || empresa.concluidaEm);
