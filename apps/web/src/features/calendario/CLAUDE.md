# Calendário — janelas e exclusões recorrentes (08/09/2026)

- `CalendarioGrid` abre `CalendarioObrigacoesModal` internamente; não navega mais à central para criar/editar. `initialContext.obrigacoesModal` permite recuperar links antigos: `{ companyId, dataInicio, dataFim, criar, ocorrenciaId }`.
- Formulário, exclusão e regras substituem o modal da lista; não empilhar traps de foco. O estado do calendário continua montado, e `onChanged` recarrega os dados.
- Ao criar uma janela fora do período de origem, ampliar a lista após salvar; não mostrar cards vazios. A lista começa com até três ocorrências por série e permite expandir.
- Mensal do dia 10 ao 15: `janelaTrabalho: { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 }`. Datas inclusivas, corridas; dias inexistentes usam último dia do mês. Deslocamento do fim 1 significa mês seguinte explicitamente.
- Prazo fiscal e janela de trabalho são independentes. `diasPreparacao` continua sendo o modo legado relativo ao vencimento.
- Etapa 2: `updateOcorrencia(id, { alcance: "ESTA_E_PROXIMAS", janelaTrabalho, regra })` versiona janela e configuração da recorrência. `regra` contém periodicidade MENSAL/TRIMESTRAL/ANUAL, mesReferencia, diaVencimento, ajusteDiaUtil, defasagemMeses e diasPreparacao. Snapshot completo normalizado no servidor; base da série não é reescrita. `janelaTrabalho: null` seleciona preparação relativa ao vencimento. Datas individuais continuam pelo PATCH legado.
- `excluirOcorrencia(id, { alcance: "ESTA" | "ESTA_E_PROXIMAS" })` chama DELETE na ocorrência. Backend conserva concluídas e tombstones; calendário/lista/lembretes/verificadores devem ignorar `canceladaEm`.
- Backend: versões append-only de janela e regra em `Obrigacao.agendaVersoes`, com mês âncora `aPartirDe`, autor e data. A última edição aplicável vence, inclusive se houver versão futura mais antiga. Corte `encerradaAPartirDe` impede criar meses ainda não materializados.
- `cicloChave` é mês âncora antes do dia útil/defasagem; legados sem chave são reconhecidos pela competência + defasagem. Ocorrências concluídas/personalizadas antigas não são recalculadas. Não apagar registros antigos para atribuir identidade.
- Worker e edições de agenda usam advisory lock transacional por série. Alterar exclusão sem seguir o mesmo protocolo pode ressuscitar uma ocorrência.
- Migração `20260908190000_calendar_series_exceptions` é aditiva. Schema validado sem banco e testes locais não substituem ensaio PostgreSQL antes de publicação. Não executar geração Prisma sobre node_modules compartilhado durante trabalho paralelo.

Validação desta frente: 72 testes API em seis suites; 143 testes de obrigações web em 11 suites; 24 testes direcionados de modal, grade e mock em três suites (contagens sobrepostas). Nenhuma publicação/banco real alterado.

## Etapa 2 — frequência e prazo versionados (08/09/2026)

- A última regra aplicável por ordem de edição vence. Versões anteriores que tinham somente janela continuam compatíveis; sua frequência vem da regra-base ou do último snapshot de regra aplicável.
- `foraDaRecorrencia` identifica uma pendente que saiu da frequência. Não equivale a cancelamento. Nova versão pode reativar o mesmo ID; nunca reativa `canceladaEm`, nem muda concluídas/personalizadas. Listas/calendário/verificadores ignoram retiradas. Corte de exclusão futura continua durável.
- Aplicar migration aditiva `20260908210000_calendar_frequency_versions` e gerar Prisma antes da API. Não usa remoção de linhas nem altera linhas antigas na migração.
- O mês âncora da ocorrência determina o início da edição, inclusive quando ajuste de dia útil move o prazo para outro mês. A API de listagem expõe `cicloChave` para não inferir a identidade pela nova defasagem.
- O mês escolhido pode deixar de fazer parte da frequência nova. O formulário explica que a ocorrência sairá da agenda. O calendário apresenta as datas resultantes; prévia do formulário considera fins de semana e identifica feriados como responsabilidade do servidor.
- Limites deliberados: não converte recorrente em avulsa; não muda conclusão automática, nome, categoria ou descrição nesse alcance. Conflito com data fiscal de outra ocorrência preservada retorna 409 e desfaz a transação. A geração continua limitada a até 12 novas previsões em horizonte de 24 meses; ocorrências já materializadas posteriores também recebem a regra aplicável. Não existe editor visual da linha do tempo de versões.
- Verificação local: 79 testes de obrigações API e 153 testes web de obrigações/mock passaram. Ensaio PostgreSQL `apps/api/scripts/verify-calendar-series-postgres.js` ampliado com troca mensal/trimestral/mensal concorrente, prazo e preservação de IDs/exceções; execução de banco fica para o gate CI. Nenhum banco ou provedor real foi acessado nesta etapa.

- Inativar é pausa reversível: sincronização retorna sem apagar ocorrências. Reativação conserva IDs, cancelamentos, retiradas por frequência e janelas individuais. Calendário, listagem padrão e verificador filtram série ativa. Regressão local API: 80 testes passaram; ensaio PostgreSQL também cobre pausa/reativação e ausência no calendário.
