# Planejamento — continuidade do cenário (08/09/2026)

Premissas ficam antes da comparação. Dentro da empresa, o conteúdo usa a moldura do pai; modo livre mantém sua própria largura. Editar cenário não altera cadastro fiscal.

Salvar cenário e Guardar em Documentos reutilizam `salvarSimulacaoPlanejamento`. O JSON de entradas contém `formularioCenario`, com textos dos campos, confirmações, meses, série mensal e cenário IBS/CBS. Não remover esse bloco: entradas numéricas do motor não preservam todas as escolhas de edição. Abrir cenário usa `listarSimulacoesPlanejamento`, sempre por empresa; cenários legados restauram as premissas disponíveis e avisam o que precisa ser reconferido. A comparação reaberta usa as tabelas atuais; o snapshot/PDF original não é sobrescrito. Procedências salvas são preservadas enquanto o cenário reaberto não é alterado.

Ao trocar empresa, limpar lista/estado salvo; descartar respostas de listagem antigas. Salvar cenário não gera PDF. A geração de PDF pode falhar depois de gravar o cenário e deve dizer exatamente isso.

Regressões: `pages/__tests__/guardarSimulacao.ligacao.test.jsx`, `hierarquiaEAcessibilidade.test.jsx` e testes existentes de troca de empresa, moeda e prefill.
