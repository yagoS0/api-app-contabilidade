import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';

// A projeção diária não é uma nova ocorrência: deslocar conserva a janela completa.
export function configDoGestoTarefa(projecao, patch) {
  const item = projecao.atividadeOriginal || projecao;
  const delta = Math.round((Date.parse(patch.dataInicio) - Date.parse(projecao.dataInicio)) / 86400000);
  return {
    ...item.config,
    dataInicio: patch.periodoCompleto ? patch.dataInicio : somarDiasAgenda(item.dataInicio, delta),
    dataFim: patch.periodoCompleto ? patch.dataFim : somarDiasAgenda(item.dataFim, delta),
    ...(patch.horaInicio ? { horarioModo: 'FIXO', horaInicio: patch.horaInicio, horaFim: patch.horaFim || null } : {}),
  };
}
