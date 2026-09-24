# Confiabilidade das consultas de pagamento — 24/09/2026

## Escopo e dependência

Implementação local autorizada pelo usuário, com três agentes e revisão integrada. Prioridade: corrigir o significado e a rastreabilidade das consultas antes de implementar avisos de guias em aberto.

O checkout `fix/confiabilidade-consultas` parte de `b5162066` e contém um snapshot local da tarefa Fiscal (`79716cbf`) como dependência. Esse snapshot inclui agenda, reservas e acompanhamento de parcelamentos ainda em desenvolvimento. A correção desta tarefa é o delta posterior ao snapshot; não publicar a dependência como se já fosse main. O workspace original da tarefa Fiscal não foi editado.

Não foram ativados workers, alteradas agendas reais, enviados avisos, feitas consultas fiscais pagas ou usados tokens Anthropic. O plano de acompanhamento por portal/WhatsApp permanece posterior à homologação fiscal.

## Contrato de resultado

| Estado | Significado | Efeito financeiro automático |
| --- | --- | --- |
| CONFIRMADO | A fonte oficial identifica pagamento do documento consultado | Pode confirmar a guia; baixa exige evidência contábil própria |
| NAO_LOCALIZADO | Resposta válida informa ausência de pagamento registrado naquele instante | Não reabre pagamento nem comprova inadimplência |
| INDETERMINADO | Erro, autorização, formato desconhecido ou evidência insuficiente | Nenhum |
| PARCIAL_OU_DIVERGENTE | Dados incompletos ou identidade/valores divergentes | Nenhum |
| NAO_APLICAVEL | Identificação ou fonte não coberta | Nenhum |

`pago` e `encontrado` são ternários: `true`, `false`, `null`. Não usar `!pago` para declarar guia aberta. `ok:true` descreve processamento da resposta, não quitação ou cobertura fiscal.

Cada observação registra fonte, instante real, documento, cobertura, identidade conferida e motivo. Compartilhar uma resposta dentro da mesma execução preserva seu instante original. O resumo distingue conclusão técnica de qualidade fiscal: uma execução pode terminar **com ressalvas**.

## DAS mensal

- A circular é histórico de apresentação; não substitui a consulta atual de pagamento.
- CONSDECLARACAO13 é compartilhada somente na mesma rodada, por procurador/contribuinte/competência.
- O parser aceita apenas booleano literal em `dasPago` e vincula o número exato da guia. Sem número, exige documento único e ausência de indícios de vínculo ambíguo com retificação/avulso/judicial.
- Ausência de índice, booleano ausente, períodos divergentes e documentos ambíguos são inconclusivos.
- Captura de documento e confirmação de pagamento têm decisões separadas. Existência de DAS não autoriza escolher arbitrariamente o primeiro para confirmar pagamento.
- A confirmação por PGDAS grava a origem específica; não inventa comprovante, data de arrecadação, valor ou composição.

## PAGTOWEB

- Status HTTP e código fiscal são verificados antes de aceitar o anexo.
- A documentação consultada do COMPARRECADACAO72 não define um código negativo que comprove pagamento não localizado. Resposta vazia/erro/ausência de PDF permanece inconclusiva.
- Base64, assinatura, término e estrutura do PDF precisam ser válidos. Identidade é conferida pelo documento/CNPJ no conteúdo ou pelo envelope oficial completo; divergência do conteúdo prevalece.
- Documento identificado sem extração financeira confiável pode demonstrar pagamento, mas não autoriza calcular baixa por estimativa.
- Datas impossíveis são recusadas. Principal, juros e multa zero são valores legítimos.
- Orçamento, autenticação, reservas e cooldown do cliente SERPRO central foram preservados.

## Persistência e concorrência

`GuidePaymentObservation` é o histórico de observações; a projeção corrente fica em `Guide.extracted.consultaPagamento`. O registrador usa transação e lock da guia depois do HTTP, sem manter conexão transacional aberta durante a chamada externa.

O snapshot da consulta inclui identidade, competência, documento, valor, vencimento e versão do PDF. Alterar envio/leitura da guia não invalida consulta; trocar documento ou empresa invalida. Observação atrasada ou de versão antiga fica auditada como não aplicada. A combinação guia/consulta tem chave única contra duplicação.

Confirmação anterior não é apagada por resposta negativa/inconclusiva. Data, autoria e composição de baixa manual são preservadas. Ao substituir a origem CLIENTE por evidência oficial, os campos de declaração permanecem e a data informada pelo cliente é preservada separadamente; nunca apresentada como data extraída de prova inexistente. Uma nova consulta de situação não apaga data/composição oficiais já conhecidas.

Excluir a guia mantém as observações com a referência original e FK nula. Não há backfill que transforme dados históricos em novas consultas.

## Lotes e agenda

Parcelas conservam seus modelos e consultam PARCSN/PARCMEI por contrato e referência. O serviço revalida cadastro, contrato, prestação, PDF e reserva depois do HTTP. Guia vinculada recebe observação na mesma transação; sem guia, a prestação conserva a última evidência no modelo existente (não é histórico append-only de todas as tentativas). Fonte parcelamento não é apresentada como comprovante PDF encontrado. Campo de pagamento ausente é inconclusivo; uma negativa exige ausência explícita e identificação correlacionada.

- Preservada a paginação estável por ID e as reservas da tarefa Fiscal.
- Respostas inconclusivas não causam repetição automática só para transformar ressalva em sucesso.
- Lote misto com falha técnica salva os resultados concluídos e passa apenas IDs com erro à retomada. Lista vazia significa nenhum item, nunca carteira inteira.
- Datas dos resultados anteriores permanecem; o resumo informa quantos foram retomados.
- Parcela excluída da retomada pelo intervalo/escopo continua visível como não consultada, sem data nova e sem ampliar a consulta para a carteira.
- Perda de reserva impede gravação pelo executor antigo.
- Confirmar um pagamento não significa que uma execução agendada foi comprovada em produção.

Limite: se o processo cair na primeira passagem antes de salvar o resumo, a agenda ainda não tem checkpoint por item. As reservas/cooldowns centrais continuam protegendo chamadas; não há promessa de exatamente uma tentativa em qualquer queda. Não criar cache antigo com data nova para mascarar esse limite.

## Validação

Ensaios de desenvolvimento usam respostas/PDFs sintéticos e mocks de transporte. O script `apps/api/scripts/verify-payment-consultations-postgres.js` exige o banco descartável `consulta_pagamento_check`, usuário `consulta_test`, em `127.0.0.1:55447`, e valida esse destino antes de importar o serviço.

As 176 migrations, incluindo a dependência Fiscal e a tabela de observações, foram aplicadas em banco local vazio. O ensaio real verifica 12 gravações concorrentes, deduplicação, observação atrasada, recálculo concorrente, baixa manual concorrente, declaração do cliente, resultados inconclusivos, CNPJ alterado, rollback por lease e retenção do histórico sem lançamentos contábeis.

O ensaio PostgreSQL passou em **14 verificações**, incluindo replay após recálculo, agenda com duas conexões e troca de proprietário. Isso valida a rotina local com horário elegível; não comprova execução do worker de produção.

A regressão ampla da API executou 120 suítes/1.597 testes: 1.595 passaram inicialmente, um caso excedeu 5s durante compilação concorrente e outro tinha fixture antiga do relatório de vencimentos da dependência Fiscal. Corrigida a fixture, os 42 testes das três suítes de rechecagem passaram com limite de 30s. A rodada focal posterior passou em 187 testes/9 suítes. A interface teve 75 testes, com dois timeouts sob carga; as duas suítes repetidas passaram integralmente. A compilação Vite terminou com os avisos existentes de tamanho de pacote/importações.

O aceite final complementar de PAGTOWEB/parcelas passou em 175 testes/6 suítes, incluindo retorno incompleto, identidade, reserva perdida, recálculo, baixa concorrente e retomada sem ampliar escopo. Os novos locks do serviço de parcelas foram ensaiados com mocks; os 14 testes PostgreSQL cobrem o registrador de guias e a agenda. Repetir a concorrência específica das parcelas em homologação antes da ativação operacional. Auditoria estática de migrations aprovada.

Os relatórios locais de execução contêm os resultados finais das suítes da API, interface e compilação. A validação sintética não mede disponibilidade, atraso da Receita ou taxa real de acerto do parser em toda a carteira.

## Critérios antes da ativação operacional

1. Integrar a dependência Fiscal e este delta, revisar conflitos e gerar o Prisma Client da versão final.
2. Aplicar migrations em homologação e repetir os ensaios isolados.
3. Fazer piloto fiscal de leitura controlado, com amostra de documentos pagos/não localizados/retificados e comparação manual, respeitando orçamento. Não realizado nesta entrega.
4. Conferir agenda salva, fuso, empresas elegíveis, flag do executor e próxima execução. Dia 25 é preferência operacional, não garantia de atualização da Receita.
5. Observar uma execução realmente disparada pela agenda antes de habilitar mensagens a clientes.

## Plano posterior preservado: acompanhamento de guias

Após consulta suficientemente recente e completa, criar pendência no portal e comunicação deduplicada por obrigação/destinatário. A mensagem deverá dizer que o pagamento **não foi localizado na Receita até aquela consulta**, permitindo recalcular ou informar pagamento. A declaração do cliente exige comprovante no novo fluxo proposto, fica separada da confirmação oficial e encaminha divergências à equipe.

Ainda não implementados: geração dessas pendências, templates Meta, disparo automático, coleta de comprovante para essa jornada e recálculo por ação da mensagem. Revalidar pagamento, identidade e versão antes de cada envio/recálculo; respeitar contatos compartilhados entre empresas, janela/template e consentimento existentes. Uma consulta inconclusiva deve gerar trabalho interno, nunca cobrança automática.

## Fontes oficiais consultadas

- [PGDAS-D — consulta de declaração por ano/PA](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_por_ano_pa/): significado do sinal `dasPago`.
- [PAGTOWEB — comprovante de pagamento](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/servicos/emite_comprovante_pagamento/) e [mensagens](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/mensagens/): contrato da resposta e códigos fiscais.
- [PAGAMENTOS71 — consulta de pagamentos](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/servicos/consulta_pagamento/): alternativa de conciliação paginada, ainda fora deste consumidor.
