# Acompanhamento fiscal dos parcelamentos — 24/09/2026

## Estado da entrega

Publicação em main/produção autorizada pelo usuário após a simplificação do mock. Branch `codex/parcelamentos-acompanhamento-20260924`. A implementação e os testes não emitiram guias nem enviaram mensagens reais. O estado final da publicação deve ser conferido no registro de release.

O problema observado foi SITFIS com três parcelas atrasadas para Talbot e duas para Klaus Nigro, enquanto a aba de parcelamentos não possuía contratos locais. A nova entrada aproveita o relatório salvo e mantém um indício a identificar, sem inventar prestações, valores ou datas.

## Fluxo simplificado após revisão do usuário

O objetivo é não esquecer a parcela. A aba Parcelamento conserva a estrutura contábil anterior: o novo painel de acompanhamento, a conferência manual da indicação e os controles de demonstração foram retirados do fluxo visível.

Na carteira, o indicador de parcelamento abre Guias. Na lista de Guias, a linha **Falta guia de parcelamento** oferece **Subir parcela**. A ausência de documento não inventa valor ou vencimento. O contador pode apenas salvar o PDF, vincular a contrato existente ou abrir o mesmo cadastro contábil já usado pelo app. Ao concluir ou cancelar o cadastro, volta ao upload na mesma tela.

Salvar sem contabilizar mantém uma identidade fiscal interna `GUIA_AVULSA`, sem número de acordo, calendário ou provisão inventados; ela não aparece como contrato contabilizado. A guia pode ser enviada pelo fluxo habitual e posteriormente vinculada, sem reenviar o PDF ou alterar pagamento/baixa. Retentativa de vínculo reutiliza a guia já salva. O aviso do mês e os atrasos anteriores permanecem separados; subir a parcela atual não afirma quitação dos atrasos do relatório.

Verificação da simplificação: regressões de Guias passaram em 130 casos (a antiga exigência de contrato foi atualizada para o comportamento solicitado); 27 testes do modal cobrem dados preservados e retorno do cadastro. O mock passou em 21 casos, com nove repetidos na rodada final de envio. Backend teve 56 testes de upload/ingestão/serialização e 31 de vínculo/projeção, com sobreposição. Build compilou 622 módulos. No navegador, subir uma parcela fictícia de R$ 110 sem contrato retirou o aviso mensal, manteve a linha PARC e permitiu abrir o vínculo posterior com o valor preservado; pendências anteriores continuaram acessíveis.

Revisão cruzada corrigiu perda do upload por Escape no cadastro, sobrescrita dos valores por sugestões do contrato, estado carregado entre empresas, vencimento ausente no mock e concorrência no vínculo de parcelas. Banco real e piloto SERPRO continuam sujeitos às condições de liberação ao final deste documento.

## Regras implementadas

- Acompanhamento fiscal separado da abertura contábil, mantendo `Parcelamento` e `Parcela` como registros centrais. Valores e calendário desconhecidos permanecem nulos. A transição para contabilização exige os dados necessários e conserva a prévia/baixa explícita existente.
- Descoberta ordinária PARCSN/PARCMEI por modalidade, empresa e número oficial. Indício sem número exige vínculo ou descarte justificado pelo contador; encontrar um único contrato não prova que ele explica os atrasos do relatório.
- Reprocessamento de SITFIS salvo; evidência e histórico de resolução persistidos. Cadastro local não representa adesão na Receita.
- Captura reserva a referência antes da emissão, persiste o PDF para retomada e reutiliza documento/guia existente. Não consulta pagamento como condição para emitir e não cria provisão implicitamente. Débito automático é acompanhado sem emissão indiscriminada.
- Documento com leitura incompleta gera conferência, com hash, identidade, referência, valor, vencimento, autor e histórico. Só depois pode seguir ao envio. Essa conferência não modifica uma baixa efetiva.
- Liberação, e-mail e WhatsApp revalidam o documento e impedem cobrança de parcela paga, baixada, em débito automático ou com conferência pendente. O lote exclui esses itens e conserva o motivo; a fila de e-mail avança além deles. Liberação por competência usa transação e versão da guia para abortar integralmente em caso de alteração concorrente.
- Confirmação de pagamento por contrato/referência, inclusive sem PDF local. Pagamento parcial/divergente exige conferência. Baixa original e correções manuais prevalecem sobre valores recalculados; confirmação fiscal não cria lançamento.
- A baixa por guia também prioriza a composição do comprovante oficial. A fila mostra o valor arrecadado e conserva `valorDocumento` separado; não é truncada nas primeiras cem parcelas. Composição oficial inconsistente bloqueia a baixa, em vez de recuar silenciosamente ao PDF recalculado.
- Projeção compartilhada de pendências para carteira, acompanhamento, compliance e lote, incluindo anteriores e múltiplos contratos. Sem movimento, fechamento ou ausência de documento não elimina a tarefa. Contratos oficialmente encerrados não geram expectativa futura; histórico permanece.
- Carteira e Situação Fiscal apontam para Guias. A aba contábil de Parcelamento conserva seu desenho anterior, sem entrada duplicada no grupo Fiscal.

## Execução automática

Cada rotina tem agenda própria, fuso `America/Sao_Paulo`, suporte a 00h e ajuste dos dias 29–31 ao último dia disponível. Pagamento admite frequência diária configurável; configurações mensais existentes não são convertidas silenciosamente.

As execuções ficam em `AppSetting` com identidade rotina/horário e reserva de cinco minutos renovável. Por orientação posterior do usuário, cada horário permite somente uma execução, sem novas tentativas automáticas ou recuperação de horários perdidos. Rotina e empresa precisam estar explicitamente habilitadas. Ver `agenda-fiscal-explicita-2026-09-24.md`. O worker de ingestão também usa reserva renovável, cuja liberação não interfere no novo proprietário após expiração.

O status mostra habilitação efetiva, atividade do executor, último resultado, tentativa esgotada, execução atrasada e próximo horário. Falhas parciais de descoberta, captura, extrato e pagamento não aparecem como sucesso geral. A conferência ADN apresenta divergências e resultados inconclusivos por empresa.

As consultas de pagamentos são paginadas; parcelas futuras e pagamentos já confirmados/baixados ficam fora. Descoberta tem cache e reserva por empresa/modalidade; pagamentos têm intervalo mínimo por item e orçamento por lote. Interromper automação não apaga pendências. Silenciar tarefas sem evidência não foi introduzido.

## Arquivos centrais

- `application/fiscal/serpro/ParcelamentoDescobertaService.js`, `CaptureSerproParcelaService.js`, `SerproParcelaPagamentoService.js`, `ParcelamentoDocumentoService.js`.
- `application/accounting/parcelamento/ParcelamentoAcompanhamentoService.js` e `pendenciasParcelamento.js`.
- `routes/firm/parcelamentosAcompanhamento.js`, montado depois da autenticação do escritório e com verificação de acesso à empresa.
- `workers/routineSchedule.js`, `scheduledRoutineService.js`, `runRoutineLoop.js` e os executores PGDAS, DCTFWeb, Pagamento e ADN.
- Web: `AcompanhamentoParcelamentos.jsx`, `ConferirDocumentoParcela.jsx`, carteira, Guias, Situação Fiscal e Rotinas.

## Verificações de desenvolvimento

- Bateria integrada API: 50 suítes / 625 testes passaram, cobrindo parcelamentos, serviços SERPRO e regressões de compliance. Testes posteriores específicos cobrem conferência documental, principal original, exclusões, agenda por rotina e reserva renovável.
- Agenda e reservas: 24 testes em quatro suítes, incluindo suspensão/reinício, proprietário antigo, 00h, fevereiro e fim de mês; dois testes de tela das Rotinas.
- Web: 32 suítes / 505 testes de regressão passaram; build de produção compilou 620 módulos. As execuções adicionais foram direcionadas aos ajustes finais da revisão, sem somar testes repetidos ao total.
- Revisão financeira final: 61 testes de baixa, 15 de projeção e 27 de interpretação/consulta passaram. A rota da fila/data de baixa passou em 11 testes, incluindo pago 100 versus documento 110. Esses conjuntos se sobrepõem à bateria integrada e não devem ser somados.
- Revisão cruzada: agente de acompanhamento julgou agendas e UI; agente de descoberta julgou pagamento; root revisou descoberta/captura e os contratos entre API e telas. Achados foram devolvidos aos responsáveis e corrigidos.
- Guardas de envio: 113 testes em sete suítes passaram. O juiz confirmou em leitura independente as correções da seleção do lote, continuidade da fila e transação por competência, sem bloqueador residual nesse escopo.
- Mock espelha as guardas de liberação/envio: 17 testes em quatro suítes passaram na rodada final; build após esse ajuste compilou 621 módulos. A conferência documental libera somente a guia correspondente e não modifica o layout.
- Navegador no mock: indício da Talbot, localização sem provisão, parcelas atual/anterior, seleção da guia anterior após carregamento, edição para débito automático e confirmação fiscal sem lançamento. Layout verificado a 390 px e no tamanho normal.
- Carteira da Klaus sem movimento mantém PARC visível. Na tela de Rotinas, meia-noite foi conservada ao salvar e refletida no próximo horário; falha esgotada e executor sem sinal aparecem separadamente no cenário demonstrativo.
- Modal documental testado no mock: confirmação fica bloqueada sem aceite; confirmar uma referência altera apenas aquela parcela, mantendo a outra pendente.
- Prisma validado, cliente gerado e auditoria de migrations aprovada. Após a autorização de publicação, a migração foi aplicada sobre 174 migrações anteriores em PostgreSQL 15 descartável. Sete verificações reais de preservação e concorrência passaram: documento 110/pagamento 100/baixa/PDF preservados, disputa de vínculo, pagamento concorrente e reserva da agenda. O script verify-parcelamento-postgres.js também integra a CI.

## Condições para liberação

1. Aplicar `20260924180000_parcelamento_acompanhamento_fiscal` em banco de homologação, após backup, e repetir concorrência com duas conexões reais. A migração adiciona tabelas/campos e relaxa apenas os dados contábeis desconhecidos; não recalcula nem remove baixas históricas.
2. Revisar o mock com o usuário. O mock tem dados fictícios e cenários de sucesso, pagamento não localizado, parcial, erro e documento incompleto; não comprova resposta fiscal real.
3. Fazer piloto de leitura com Talbot/Klaus: habilitação/procuração, pedidos por modalidade e evidências de pagamento. Somente depois escolher contrato/referência para emissão controlada; não enviar ao cliente automaticamente.
4. Confirmar no ambiente de destino `INTEGRACAO_SERPRO_PARCELAMENTO`, credenciais e flags dos executores: `SERPRO_PGDASD_WORKER_ENABLED`, `SERPRO_DCTFWEB_WORKER_ENABLED`, `SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED`, `CONFERENCIA_ADN_WORKER_ENABLED`, além das marcações por empresa/rotina.
5. Observar ao menos uma execução disparada pela agenda, com registro por rotina/empresa. Rodar manualmente ou ver um executor ativo não comprova o horário programado. Em caso de falha, desligar chamadas automáticas mantendo histórico e tarefas visíveis.

As modalidades especiais, PGFN e demais parcelamentos seguem acompanhamento/importação manual até validação de seus contratos de integração. Esta entrega não equivale a integração genérica com “Minhas Dívidas”.
