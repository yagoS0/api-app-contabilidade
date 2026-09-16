# Planejamento — continuidade do cenário (08/09/2026)

## Relatórios e Laboratório em dev — 16/09/2026

RelatoriosTab reutiliza AnaliseEmpresa. O simulador tributário foi preservado. LaboratorioEmpresa fica em `/laboratorio`, exclusivo do escritório. A prévia usa dados fictícios e grava apenas no navegador; API real usa cenários próprios, nunca cria uma empresa para ficção. Detalhes e limites em `docs/ajustes/2026-09-16-relatorios-laboratorio-dev.md`.

As regras gerenciais e de declaração de sócios estão em `packages/shared/src/analise`, usadas por API e UI. Não inferir fixo/variável, pró-labore ou distribuição pelo nome da conta. Classificação usa código completo, com revisão concorrente. Pagamentos aos sócios exigem declaração confirmada, fonte e competência; cada salvamento preserva versões. Não somar versões da mesma competência. Pró-labore já descontado da DRE não é descontado novamente ao apresentar resultado menos distribuição.

Recorrência de clientes agora é 3 dos últimos 4 meses (`3-de-4-v1`), separada da regra contábil de despesas recorrentes. Relatório completo usa fotografia transacional, descarta resposta após trocar empresa e imprime todos os clientes dos períodos comparados. Não substituir falha real por mock. Os itens vermelhos e o portal do cliente seguem fora desta entrega; não publicar sem autorização.

## Análise em desenvolvimento — 10/09/2026

Dentro da empresa, PlanejamentoPage reúne Análise da empresa e Simulação tributária. O formulário de simulação permanece montado ao alternar a área, preservando edições. A análise tem seu próprio período; não altera competência fiscal nem premissas. O modo livre continua no simulador. Consultas por empresa descartam respostas antigas. Dados fictícios são marcados e usados somente no mock; a API real nunca recorre ao mock para disfarçar erro. Ver `docs/ajustes/2026-09-10-planejamento-analise-dev.md` para escopo e limites antes da publicação.

Complemento: a abertura na empresa recupera o cenário salvo mais recente após o prefill. Não sobrescrever edições iniciadas durante a busca, nem aplicar resposta de outra empresa. O histórico só expande ao clicar Abrir cenário. Salvar cenário continua sendo explícito; não anunciar salvamento automático de campos. IBS/CBS mostra explicações dos modelos e diferencia imposto próprio de crédito transferido. Comunicado RFB atualizado em 02/09/2026 confirma o procedimento para 2027 e cancelamento até 30/11/2026; substitui a antiga ausência de prova da regulamentação. Consulta documentada em docs/fontes-fiscais.md.

Premissas ficam antes da comparação. Dentro da empresa, o conteúdo usa a moldura do pai; modo livre mantém sua própria largura. Editar cenário não altera cadastro fiscal.

Salvar cenário e Guardar em Documentos reutilizam `salvarSimulacaoPlanejamento`. O JSON de entradas contém `formularioCenario`, com textos dos campos, confirmações, meses, série mensal e cenário IBS/CBS. Não remover esse bloco: entradas numéricas do motor não preservam todas as escolhas de edição. Abrir cenário usa `listarSimulacoesPlanejamento`, sempre por empresa; cenários legados restauram as premissas disponíveis e avisam o que precisa ser reconferido. A comparação reaberta usa as tabelas atuais; o snapshot/PDF original não é sobrescrito. Procedências salvas são preservadas enquanto o cenário reaberto não é alterado.

Ao trocar empresa, limpar lista/estado salvo; descartar respostas de listagem antigas. Salvar cenário não gera PDF. A geração de PDF pode falhar depois de gravar o cenário e deve dizer exatamente isso.

Regressões: `pages/__tests__/guardarSimulacao.ligacao.test.jsx`, `hierarquiaEAcessibilidade.test.jsx` e testes existentes de troca de empresa, moeda e prefill.

Etapa 2: atalhos Premissas → Comparação → Detalhes movem foco/rolagem sem criar entrada no histórico. Respeitam altura dos cabeçalhos fixos. Grades permitem encolher, tabelas rolam localmente; no celular o cabeçalho da empresa não fica sobre o formulário. Ajuda de origem é legível e bloqueios permanecem visíveis. Falha de transporte do PDF após salvar informa sucesso parcial; resposta do PDF de empresa anterior não aparece na empresa atual.
