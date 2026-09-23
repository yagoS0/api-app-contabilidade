// Evidências inventadas somente para os verificadores locais, nunca consultas reais.
// O roteiro não preenchido permanece pendente e é declarado na devolutiva.
export function diagnosticoSintetico(certo, necessaria = false) {
  return {
    devolutiva: {
      certo,
      atencao: "SIMULAÇÃO: verificar as informações ainda pendentes no roteiro; nenhum provedor externo foi consultado.",
      corrigir: "SIMULAÇÃO: executar somente os serviços delimitados, após proposta e contratação conferidas.",
    },
    regularizacao: {
      necessaria,
      justificativa: necessaria ? "SIMULAÇÃO: pendências anteriores exigem execução separada da mensalidade." : "SIMULAÇÃO: o serviço cadastral delimitado não inclui regularização de períodos anteriores.",
      condicaoInicioMensal: necessaria ? "APOS_REGULARIZACAO" : "SEM_REGULARIZACAO",
    },
  };
}
