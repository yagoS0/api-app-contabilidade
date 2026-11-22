# Operações — sete modais aprovados

Decisão de apresentação do usuário em 22/11/2026: implementar as prévias de Calculado, Confirmado, Transmitido, Guias disponíveis, Guias enviadas, Guias pagas e Contabilização. Substitui a tabela permanente por diálogos de trabalho; não redefine cálculo, transmissão, envio ou pagamento. O pedido autoriza desenvolvimento e validação, sem publicação ou atos reais.

## Contratos preservados

- `OperationsStageModal` reutiliza Modal, tokens, foco, Escape, proteção de gravação e rodapé. A URL conserva competência/filtro/página e registra explicitamente a abertura; URLs antigas continuam legíveis sem forçar um modal ao entrar.
- Calculado apresenta receita, impostos, avisos, erros, Calcular e Conferir. Calcular reutiliza a prévia e o motor existentes; Conferir navega à Apuração. Conferir selecionadas continua explícito e não transmite.
- Confirmado separa transmissão manual selecionada de Liberar rotina para todas as confirmadas elegíveis da prévia. Presumido conserva conclusão externa auditada. Configuração, pausas, versão, regime histórico e bloqueios FS12 continuam no servidor.
- Transmitido apresenta receita transmitida, guias e documentos em tags; versões, erros e evidências ficam no detalhe. Retificar e Abrir empresa navegam; não executam retificação por leitura. Downloads usam APIs autenticadas e descartam respostas de contextos antigos.
- Guias usam uma linha por empresa e tags por documento. Disponibilidade e valor ficam separados. A seleção geral alcança as elegíveis do filtro inteiro; empresas sem documento enviável não entram no envio. A consulta possui seleção e confirmação próprias.
- Enviado conserva canais, falhas, incertezas, reenvio seletivo e entrega externa com data/meio/autor. Abrir uma ação por empresa com várias guias exige escolher o documento. Não altera pagamento.
- Pago identifica documentos pagos, inclusive em empresas com outras guias abertas. A paginação usa esse conjunto; erros e leituras inconclusivas permanecem visíveis. Origem, data civil e registro da confirmação são distintos. Recálculo exige registro explícito, não diferença de valores.
- Contabilização conserva Receitas, Provisões, Folha, Despesas e Pagamentos; os estados são informativos. Abrir Lançamentos preserva empresa e competência; nenhuma leitura cria ou conclui lançamentos.

## Extensão aditiva da leitura de pagamentos

`OperationsGuideEvidence.read` mantém autenticação e escopo e acrescenta `recalculo`, composição documental e, no pagamento, `oficialComprovado`, `composicao`, `composicaoOrigem` e `valorDeclarado`. Não altera reservas, envios, confirmações ou baixas.

`valorPago` continua dependendo da evidência oficial correspondente; `valorDeclarado` existe somente no snapshot da confirmação CLIENTE vigente e é identificado como declaração. Ausência não é preenchida pelo valor nominal. Principal, juros e multa não são deduzidos do total; composições contraditórias são recusadas. Origem SERPRO isolada não vira confirmação oficial. Datas manuais de pagamento mantêm o significado existente, sem substituir instante de registro ausente.

## Impacto e validação

Aplicam-se R01/R02/R06/R08–R12/R19–R22/R25/R26 e seções 33/36/37. Sem nova política fiscal, schema, migração, ativação de automações ou tratamento produtivo. Notas, Guru, eNotas, benefício municipal e demais trabalhos não são alterados.

O controlador oficial iniciou a execução `2026-11-22T15-51-06-925Z-425432e9` e atingiu o timeout na implementação. O resultado original permanece interrompido; não é aprovação técnica. O usuário autorizou conclusão em registro complementar, com os mesmos gates e revisores independentes, sem reiniciar a execução nem alterar política, catálogo ou limites.

Testes e capturas usam somente dados fictícios e bloqueio de rede externa. O registro de governança da entrega deve indicar resultados efetivamente obtidos, hashes e limitações; esta especificação não declara gates aprovados por antecipação. Evidências privadas ficam em `ALTAN/output/operacoes-modais-20261122/`.

Rollback: reverter exclusivamente o incremento de Operações do PR314, comparado à main `4d4749cf82d2b1b1c2664286daca68fa95cf3586`, preferindo reverter seu commit de integração. Preservar o PR313/ADN incorporado da main; não há migração ou dados reais a desfazer. Não remover worktrees, resultados ou alterações de outros chats.

## Fechamento complementar e autorização de integração

Em 22/11/2026, a correção limitada a dois testes preservou todos os cenários e acrescentou cobertura da seleção entre busca/páginas. Foram executadas somente duas suítes/54 casos; a composição conferida independentemente com 598 provas anteriores totaliza600 suítes/7.118 casos aprovados. API: 13.700 casos aprovados e 143 pending explícitos; portal: 1.610; governança: 88; builds e revisão visual aprovados. Os 143 casos pendentes não foram executados por consequência. As execuções anteriormente interrompidas/reprovadas e o estado escalated original permanecem preservados, sem reclassificação.

O usuário autorizou abrir o PR e, somente após o CI passar, integrar na main e publicar. A conferência após a publicação é estritamente de leitura. Não ativar automações, alterar dados reais ou executar consultas/atos fiscais e mensagens como teste. Não há migração ou mudança de ambiente nesta entrega. O fechamento local não substitui os checks do PR nem representa prova de produção antecipada.

A atualização da main pelo PR313 foi incorporada sem conflitos para validar os novos checks sobre a composição completa. Os 19 arquivos dessa atualização permanecem intactos e não fazem parte dos 24 arquivos deste incremento. A falha inicial por arquivos ausentes no head permanece registrada; a integração depende do CI do novo SHA.
