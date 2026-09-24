# Revisão de parcelamento — 21/09/2026

Continuidade: [acompanhamento fiscal e agendas de 24/09/2026](parcelamentos-acompanhamento-2026-09-24.md), com captura/pagamento independentes da abertura contábil e condições de homologação.

Pedido: validar baixa, clareza e usabilidade conforme os padrões do app, com múltiplos agentes e revisão independente. Alterações em desenvolvimento; esta revisão não publica em produção.

## Problemas corrigidos

- Baixa documental e declaração manual poderiam disputar a mesma prestação. A baixa documental agora reserva também a prestação na transação, desfazendo a reserva da guia quando há conflito.
- Estorno de baixa manual aceita a guia anexada posteriormente, preserva esse vínculo e recusa alterações concorrentes do vínculo.
- Datas impossíveis de pagamento são recusadas; uma data documental inválida não é substituída silenciosamente pela data atual/declarada.
- Baixa, aprovação e ações do contrato atualizam filas, cartões e conferência. Troca de empresa descarta respostas atrasadas e reinicia estado local.
- Correção do principal seguida de falha na baixa conserva o valor já salvo e permite repetir apenas a etapa pendente.
- Resultados de baixa continuam visíveis quando a linha sai da fila. Confirmações identificam o contrato; erros de aprovação preservam seleção.
- Modal de baixa manual usa o componente padrão, rodapé fixo, ajuda recolhível e prévia sem vazamento horizontal. Confirmação suspende o formulário; Escape volta aos campos e restaura o foco. Gravação bloqueia fechamento.
- Rescisão é descrita como registro local reversível. Prestações sem guia saem da fila; guias pagas continuam disponíveis para contabilização.
- Mock agora isola dados por empresa, conserva configuração/rescisão e reproduz baixa, conferência, aprovação e atualização do contrato. Parcelas quitadas deixam os alertas de atraso do mock.

## Verificação

- Compilação de produção concluída (596 módulos); somente avisos já existentes de tamanho de pacotes e importações mistas. `git diff --check` sem erros.
- Interface: 20 suítes / 334 testes aprovados; 3 suítes / 29 testes repetidos após os últimos ajustes de foco/texto.
- Mock: 4 testes aprovados, cobrindo baixa documental/manual, isolamento por empresa, rescisão/desfazimento, configuração e busca de pagamento.
- API: 18 suítes / 316 testes no conjunto ampliado; 4 suítes / 71 testes direcionados após o ajuste final de datas.
- Juiz independente: revisão de transações, estorno, datas, isolamento, atualização de filas e retomada parcial; nova execução dos testes de datas e 18 testes de Modal/retentativa. Sem bloqueador identificado.
- Navegador local em modo mock: baixa documental com mensagem persistente, entrada imediata na conferência e aprovação; baixa manual com atualização para 1 de 60; cancelamento por Escape mantendo o formulário e foco no botão original; ausência de erros de console no encerramento.
- Inspeção visual em desktop e 390 × 844: modal sem vazamento; listas com rolagem horizontal local, sem alargar a página. Override de viewport restaurado.

## Limites

Nenhuma baixa, consulta fiscal ou rescisão real foi executada. Concorrência foi validada pela estrutura transacional e por testes simulados, sem corrida em PostgreSQL real. Não houve alteração das regras de composição contratual/provisão previamente acordadas. O mock mantém dados apenas em memória e reinicia ao recarregar.
