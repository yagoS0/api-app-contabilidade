# Calendário — janelas e exclusões recorrentes (08/09/2026)

- `CalendarioGrid` abre `CalendarioObrigacoesModal` internamente; não navega mais à central para criar/editar. `initialContext.obrigacoesModal` permite recuperar links antigos: `{ companyId, dataInicio, dataFim, criar, ocorrenciaId }`.
- Formulário, exclusão e regras substituem o modal da lista; não empilhar traps de foco. O estado do calendário continua montado, e `onChanged` recarrega os dados.
- Ao criar uma janela fora do período de origem, ampliar a lista após salvar; não mostrar cards vazios. A lista começa com até três ocorrências por série e permite expandir.
- Mensal do dia 10 ao 15: `janelaTrabalho: { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 }`. Datas inclusivas, corridas; dias inexistentes usam último dia do mês. Deslocamento do fim 1 significa mês seguinte explicitamente.
- Prazo fiscal e janela de trabalho são independentes. `diasPreparacao` continua sendo o modo legado relativo ao vencimento.
- `updateOcorrencia(id, { alcance: "ESTA_E_PROXIMAS", janelaTrabalho })` altera somente a janela das próximas pendentes não personalizadas; não oferece edição de frequência/prazo nesse alcance. Datas individuais continuam pelo PATCH legado.
- `excluirOcorrencia(id, { alcance: "ESTA" | "ESTA_E_PROXIMAS" })` chama DELETE na ocorrência. Backend conserva concluídas e tombstones; calendário/lista/lembretes/verificadores devem ignorar `canceladaEm`.
- Backend: versões append-only de janela em `Obrigacao.agendaVersoes`, com mês âncora `aPartirDe`, autor e data. A última edição aplicável vence, inclusive se houver versão futura mais antiga. Corte `encerradaAPartirDe` impede criar meses ainda não materializados.
- `cicloChave` é mês âncora antes do dia útil/defasagem; legados sem chave são reconhecidos pela competência + defasagem. Ocorrências concluídas/personalizadas antigas não são recalculadas. Não apagar registros antigos para atribuir identidade.
- Worker e edições de agenda usam advisory lock transacional por série. Alterar exclusão sem seguir o mesmo protocolo pode ressuscitar uma ocorrência.
- Migração `20260908190000_calendar_series_exceptions` é aditiva. Schema validado sem banco e testes locais não substituem ensaio PostgreSQL antes de publicação. Não executar geração Prisma sobre node_modules compartilhado durante trabalho paralelo.

Validação desta frente: 72 testes API em seis suites; 143 testes de obrigações web em 11 suites; 24 testes direcionados de modal, grade e mock em três suites (contagens sobrepostas). Nenhuma publicação/banco real alterado.
