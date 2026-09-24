# Confiabilidade das consultas de pagamento — 24/09/2026

## Escopo e dependência

Implementação local autorizada pelo usuário, com três agentes e revisão integrada. Prioridade: corrigir o significado e a rastreabilidade das consultas antes de implementar avisos de guias em aberto.

O trabalho inicial `7598ece3` foi reaplicado na branch `fix/integracao-consultas` sobre a entrega real da tarefa Fiscal, `4c193a85` (PR 86, integrado à main `8d4c2ec3`). O snapshot intermediário `79716cbf` permanece somente no histórico local de desenvolvimento e não integra a branch de entrega. O workspace original da tarefa Fiscal não foi editado.

No desenvolvimento e nos ensaios sintéticos não foram feitas consultas fiscais pagas. O piloto posterior, descrito abaixo, usa consultas reais autorizadas e limitadas. Nenhuma dessas etapas ativou workers, alterou agendas reais, enviou avisos ou usou tokens Anthropic. O plano de acompanhamento por portal/WhatsApp permanece posterior à homologação fiscal.

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

## Rodada de integração e simulação entre agentes

A segunda rodada separou três papéis: revisão fiscal da integração, execução concorrente em PostgreSQL real e simulação das falas do cliente/atendimento do contador. Os testes identificaram e corrigiram:

- Recaptura de PDF apagava a projeção da última consulta. Mesma revisão agora conserva observação, data e declaração do cliente; revisão alterada mantém a referência histórica com `INDETERMINADO / DOCUMENTO_ALTERADO`, sem carimbar uma nova consulta.
- Parcelas `PAID/CLIENTE` eram puladas. O consumidor oficial agora as verifica sem reabrir a guia nem apagar autoria/data declaradas. As confirmações manuais, oficiais e baixas anteriores continuam protegidas.
- Uma observação mais recente da guia podia recusar o resultado antigo enquanto a parcela recebia `CONFIRMADO`. Guia, parcela e observação agora têm aplicação coerente na mesma transação. A recusa fica auditada e conserva o intervalo da tentativa real, evitando nova chamada paga imediata.
- Projeção legada sem `observacaoId` escapava da comparação cronológica. A guarda também cobre esse estado.
- “Já paguei” recebia resposta de consulta de guias. Agora encaminha à equipe pelo fluxo humano existente, preservando empresa e pausa de atendimento. Perguntas como “quais guias já paguei?” continuam consultas históricas, com mensagem vazia adequada ao período.

PostgreSQL real: **15 verificações de guias/agenda e 17 de parcelas**, com dados sintéticos. O ensaio de parcelas mantém serviço/parser/Prisma reais e substitui somente credenciais e transporte; 15 chamadas sintéticas, sem SERPRO, Meta ou Anthropic. Inclui erro durante escrita e rollback, locks de empresa/contrato/guia, mudança cadastral, documento recalculado, baixa concorrente, duplicação, proprietário substituído, declaração CLIENTE e intervalo mínimo.

O simulador executou 430 testes na primeira rodada e 165 na rodada final do chat. O revisor executou 155 testes em 11 suítes, com 72 repetidos depois do último ajuste. Esses totais se sobrepõem; não devem ser somados como casos únicos. O workflow `payment-consultations.yml` repete regressões e os dois ensaios PostgreSQL sem serviços externos.

A regressão conjunta local passou em **1.369 testes/90 suítes da API e 34 testes/6 suítes da interface**; build Vite aprovado, com avisos existentes de tamanho de pacote. Durante a validação, a tarefa do portal integrou autenticação à main `96bf1d92`; essa entrega foi incorporada sem conflitos e elevou o banco local a 177 migrations. A verificação do endereço interno dos ensaios foi adaptada ao encaminhamento de porta do container do GitHub, mantendo destino/usuário/banco de teste obrigatórios.

Limitação separada: um trigger artificial `DEFERRABLE INITIALLY DEFERRED` produziu rollback no banco, mas a pilha Prisma local retornou sucesso. O schema/código migrado não possui constraints diferidas e o cenário operacional de falha durante escrita passou. Não tratar essa injeção como aprovada; revalidar o ORM caso sejam introduzidas constraints diferidas. Os registros de diagnóstico ficam nos relatórios locais, sem alteração de dependências nesta tarefa.

## Piloto fiscal real de leitura

Rodada autorizada em 24/09/2026, limitada a seis tentativas de negócio: três `CONSDECLARACAO13`, duas `COMPARRECADACAO72` e uma `DETPAGTOPARC165`. Código novo executado localmente com o transporte/credencial/guarda centrais, sem implantar a branch ou chamar registradores financeiros. A migration de observações ainda não estava no banco de produção. Escritas permitidas no runner: somente ledger SERPRO e auditoria de acesso ao certificado; respostas e comprovante guardados fora do repositório público.

Resultado: cinco confirmações e um `INDETERMINADO / SEM_COMPROVANTE`. Os três documentos DAS atuais retornaram booleano literal `true`, inclusive dois ainda abertos no cadastro. Os índices das versões anteriores retornaram `false`, sem contaminar a seleção do documento atual. O comprovante PAGTOWEB positivo foi renderizado e conferido visualmente; CNPJ/documento, data e composição corresponderam ao parser. A ausência de comprovante no outro caso não foi convertida em inadimplência. A parcela teve CNPJ, contrato, referência, ordinal, documento e composição conferidos.

A revisão interrompeu a expansão antes da consulta de parcela e corrigiu:

- Identidade numérica de contrato: `1` e `0001` são equivalentes, sem arredondamento de inteiros longos ou aceitação de caracteres inválidos.
- CNPJ esperado conferido contra o envelope e identidades adicionais presentes; ausência/divergência impede confirmação e marca `identidadeConferida:false`.
- Valores, somas e pisos exigem centavos finitos/seguros; booleanos, objetos, transbordamento e valores positivos que arredondariam a zero são recusados. Decimais do Prisma são convertidos explicitamente na borda do serviço; zeros monetários legítimos continuam válidos.

Validação complementar: **156 testes em duas suítes**, revisão independente de contraprovas e **18 cenários PostgreSQL** com transporte sintético, incluindo parcela sem guia e piso `Prisma.Decimal`. O último endurecimento de valor subcentavo foi validado offline, sem repetir a consulta real. As evidências reais foram reprocessadas localmente para conferir o parser corrigido.

Seis chamadas únicas registradas como `ok`, HTTP 200, sem forçar guarda, e orçamento interno de 728 para 734 de um teto observado de 1.520. Esses números são tentativas contabilizadas, não uma fatura em reais. Nenhum token Anthropic, envio a cliente, recálculo ou lançamento contábil foi usado no piloto.

Ressalvas: não houve negativa explícita de um DAS **vigente** nesta amostra; não usar a negativa das versões antigas como substituto desse teste. O replay também encontrou ordinais e vínculo de guia inconsistentes em um cadastro de parcelamento, mantidos intactos para reconciliação. Seis casos não medem taxa estatística de confiabilidade ou disponibilidade do provedor.

Na inspeção, o executor de consultas existente já estava habilitado, com agenda no **dia 20 às 8h, America/Sao_Paulo**. O piloto não ativou/desativou esse executor nem alterou a agenda. A preferência pelo dia 25 permanece uma configuração da futura ativação. Avisos automáticos continuam fora do escopo implementado.

## Critérios antes da ativação operacional

1. Integração Fiscal e revisão concluídas localmente; conferir a versão efetivamente publicada antes da ativação.
2. As 177 migrations da integração final estão aplicadas no banco local isolado, com os 32 cenários PostgreSQL repetidos. Aplicar e conferir também no ambiente da ativação; homologação local não comprova operação em produção.
3. Fazer piloto fiscal de leitura controlado, com amostra de documentos pagos/não localizados/retificados e comparação manual, respeitando orçamento. A rodada descrita abaixo deve conservar suas lacunas de cobertura; não equivale a comprovar toda a carteira.
4. Conferir agenda salva, fuso, empresas elegíveis, flag do executor e próxima execução. Dia 25 é preferência operacional, não garantia de atualização da Receita.
5. Observar uma execução realmente disparada pela agenda antes de habilitar mensagens a clientes.

## Plano posterior preservado: acompanhamento de guias

Após consulta suficientemente recente e completa, criar pendência no portal e comunicação deduplicada por obrigação/destinatário. A mensagem deverá dizer que o pagamento **não foi localizado na Receita até aquela consulta**, permitindo recalcular ou informar pagamento. A declaração do cliente exige comprovante no novo fluxo proposto, fica separada da confirmação oficial e encaminha divergências à equipe.

Antes de gerar pendência, resolver a versão vigente da obrigação. Um índice antigo `dasPago:false` ou uma guia histórica ainda `OPEN` não autoriza aviso quando existe documento substituto pago. Recalcular/retificar precisa preservar a relação entre versões; documento exato é necessário para interpretar o retorno, mas sozinho não prova que a versão ainda deve ser cobrada. Se a cadeia de substituição estiver ambígua, encaminhar à conferência interna.

Ainda não implementados: geração dessas pendências, templates Meta, disparo automático, coleta de comprovante para essa jornada e recálculo por ação da mensagem. Revalidar pagamento, identidade e versão antes de cada envio/recálculo; respeitar contatos compartilhados entre empresas, janela/template e consentimento existentes. Uma consulta inconclusiva deve gerar trabalho interno, nunca cobrança automática.

## Fontes oficiais consultadas

- [PGDAS-D — consulta de declaração por ano/PA](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_por_ano_pa/): significado do sinal `dasPago`.
- [PAGTOWEB — comprovante de pagamento](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/servicos/emite_comprovante_pagamento/) e [mensagens](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/mensagens/): contrato da resposta e códigos fiscais.
- [PAGAMENTOS71 — consulta de pagamentos](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/servicos/consulta_pagamento/): alternativa de conciliação paginada, ainda fora deste consumidor.
