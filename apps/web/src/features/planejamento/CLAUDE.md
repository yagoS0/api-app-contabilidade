# Planejamento — continuidade do cenário (08/09/2026)

Complemento: a abertura na empresa recupera o cenário salvo mais recente após o prefill. Não sobrescrever edições iniciadas durante a busca, nem aplicar resposta de outra empresa. O histórico só expande ao clicar Abrir cenário. Salvar cenário continua sendo explícito; não anunciar salvamento automático de campos. IBS/CBS mostra explicações dos modelos e diferencia imposto próprio de crédito transferido. Comunicado RFB atualizado em 02/09/2026 confirma o procedimento para 2027 e cancelamento até 30/11/2026; substitui a antiga ausência de prova da regulamentação. Consulta documentada em docs/fontes-fiscais.md.

Premissas ficam antes da comparação. Dentro da empresa, o conteúdo usa a moldura do pai; modo livre mantém sua própria largura. Editar cenário não altera cadastro fiscal.

Salvar cenário e Guardar em Documentos reutilizam `salvarSimulacaoPlanejamento`. O JSON de entradas contém `formularioCenario`, com textos dos campos, confirmações, meses, série mensal e cenário IBS/CBS. Não remover esse bloco: entradas numéricas do motor não preservam todas as escolhas de edição. Abrir cenário usa `listarSimulacoesPlanejamento`, sempre por empresa; cenários legados restauram as premissas disponíveis e avisam o que precisa ser reconferido. A comparação reaberta usa as tabelas atuais; o snapshot/PDF original não é sobrescrito. Procedências salvas são preservadas enquanto o cenário reaberto não é alterado.

Ao trocar empresa, limpar lista/estado salvo; descartar respostas de listagem antigas. Salvar cenário não gera PDF. A geração de PDF pode falhar depois de gravar o cenário e deve dizer exatamente isso.

Regressões: `pages/__tests__/guardarSimulacao.ligacao.test.jsx`, `hierarquiaEAcessibilidade.test.jsx` e testes existentes de troca de empresa, moeda e prefill.

Etapa 2: atalhos Premissas → Comparação → Detalhes movem foco/rolagem sem criar entrada no histórico. Respeitam altura dos cabeçalhos fixos. Grades permitem encolher, tabelas rolam localmente; no celular o cabeçalho da empresa não fica sobre o formulário. Ajuda de origem é legível e bloqueios permanecem visíveis. Falha de transporte do PDF após salvar informa sucesso parcial; resposta do PDF de empresa anterior não aparece na empresa atual.
