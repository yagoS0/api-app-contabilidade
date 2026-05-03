# Plano Circular Contabil - 2026-04-28

## Objetivo

Transformar a Circular em uma fonte de eventos contabeis, em vez de uma tela derivada apenas dos lancamentos ja existentes.

Fluxo alvo:

1. SERPRO captura fatos fiscais por competencia.
2. O sistema persiste esses fatos na Circular.
3. O sistema identifica eventos contabilizaveis.
4. O sistema busca a regra contabil padrao configurada para a empresa.
5. O sistema gera ou atualiza lancamentos contabeis automaticos.
6. O usuario revisa, edita, aprova ou confirma.

## Leitura do estado atual

No backend atual:

- Ja existe modulo de lancamentos contabeis com `AccountingEntry` e `AccountingEntryLine`.
- Ja existem rotas CRUD de lancamentos em `apps/api/src/routes/firm/accountingEntries.js`.
- Ja existe integracao SERPRO para captura de guias PGDAS-D em `apps/api/src/application/fiscal/serpro/`.
- A "Circular" atual nao e uma entidade fiscal propria no banco. Hoje ela e uma visao anual montada a partir de lancamentos `PROVISAO` e `RECEITA` na rota `GET /firm/companies/:companyId/entries/circular`.

Conclusao:

- O projeto ainda nao tem a tabela `company_monthly_circulars` no backend.
- Portanto, este plano nao e apenas uma melhoria de tela.
- Ele redefine a Circular como camada fiscal de origem, e nao mais como agregacao contabil.

## Conceito principal

Separar claramente tres camadas:

1. Dado fiscal capturado
   - Ex.: receita bruta, DAS total, INSS total, vencimentos e referencias do SERPRO.

2. Regra de lancamento padrao
   - Ex.: quando entrar `RECEITA_SIMPLES`, debitar conta `5` e creditar conta `301`.

3. Lancamento contabil gerado
   - Ex.: D `5` / C `301` / valor `50000` / historico preenchido por template.

Resumo:

- A Circular armazena o dado fiscal.
- A regra define como contabilizar.
- O lancamento contabil registra o efeito contabil.

## Nova arquitetura funcional

Fluxo ideal:

1. SERPRO sincroniza a competencia, por exemplo `202603`.
2. O sistema salva na Circular os fatos fiscais capturados.
3. O sistema transforma os fatos em eventos contabilizaveis.
4. O sistema busca regras configuradas por empresa.
5. O sistema gera lancamentos automaticos com `origem = SERPRO`.
6. O usuario revisa, edita ou aprova.

## Eventos contabeis previstos

Eventos iniciais sugeridos:

- `RECEITA_SIMPLES`
- `DAS_SIMPLES`
- `INSS_DCTFWEB`

Eventos futuros possiveis:

- `ISS`
- `FGTS`
- `PIS_COFINS`
- `FOLHA_PAGAMENTO`
- `ALUGUEL`

## Estruturas necessarias

### 1. Circular fiscal mensal

Criar uma tabela propria, por exemplo `company_monthly_circulars`, para guardar a base fiscal por empresa e competencia.

Campos esperados para o MVP:

- `id`
- `company_id` ou `portal_client_id`
- `competencia`
- `receita_bruta`
- `das_total`
- `inss_total`
- metadados de vencimento e referencia quando existirem
- controle de divergencia contabil
- timestamps

Observacao importante:

- O nome e o relacionamento devem seguir o modelo atual do projeto, que usa `portalClientId` em boa parte do modulo contabil.

### 2. Regras de lancamento automatico

Criar tabela `accounting_entry_rules`.

Responsabilidade:

- Guardar como cada `event_type` deve virar lancamento contabil.
- Suportar regra padrao universal e regra especifica por empresa.

Campos sugeridos:

- `id`
- `company_id` ou `portal_client_id` nullable
- `scope`
- `event_type`
- `description_template`
- `debit_account_code`
- `credit_account_code`
- `amount_source`
- `entry_date_strategy`
- `is_active`
- `created_at`
- `updated_at`

Escopos esperados:

- `GLOBAL`: regra universal, usada como padrao para todas as empresas
- `COMPANY`: regra especifica de uma empresa

Resolucao esperada das regras:

1. Procurar regra ativa da empresa para o `event_type`.
2. Se existir, usar a regra da empresa.
3. Se nao existir, usar a regra global ativa para o mesmo `event_type`.
4. Se nao existir nenhuma, registrar alerta e nao gerar lancamento.

Regra de precedencia:

- a regra `COMPANY` sempre sobrescreve a regra `GLOBAL` para o mesmo `event_type`

Restricoes sugeridas:

- unicidade da regra especifica por empresa: `UNIQUE(company_id, event_type)`
- unicidade da regra global por evento: uma unica regra global ativa por `event_type`

Observacao de modelagem:

- Preferir uma unica tabela `accounting_entry_rules` com escopo, em vez de duas tabelas separadas.
- Se o projeto optar por evitar coluna `scope`, o mesmo comportamento pode ser representado com `portalClientId = null` para regra global e `portalClientId = <id>` para regra da empresa.

### 3. Lancamentos contabeis gerados

Reaproveitar o modulo atual de lancamentos, expandindo `AccountingEntry` e `AccountingEntryLine` em vez de criar um segundo modulo paralelo.

## Regras de contabilizacao

### Exemplo: Receita

Exemplo de hierarquia:

- Regra global de `RECEITA_SIMPLES`: D `5` / C `301`
- Regra da empresa X para `RECEITA_SIMPLES`: D `1.01` / C `3.01.001`

Resultado esperado:

- empresa sem regra propria usa a configuracao global
- empresa com regra propria usa a configuracao particular, sobrescrevendo a global

Regra:

```json
{
  "eventType": "RECEITA_SIMPLES",
  "descriptionTemplate": "VR REF RECEITA BRUTA DO SIMPLES NACIONAL - {{competencia}}",
  "debitAccountCode": "5",
  "creditAccountCode": "301",
  "amountSource": "receita_bruta"
}
```

Resultado:

- Debito: conta `5`
- Credito: conta `301`
- Valor: `receita_bruta`

### Exemplo: DAS Simples

```json
{
  "eventType": "DAS_SIMPLES",
  "descriptionTemplate": "VR REF DAS SIMPLES NACIONAL - {{competencia}}",
  "debitAccountCode": "401",
  "creditAccountCode": "5",
  "amountSource": "das_total"
}
```

### Exemplo: INSS

```json
{
  "eventType": "INSS_DCTFWEB",
  "descriptionTemplate": "VR REF INSS DCTFWEB - {{competencia}}",
  "debitAccountCode": "420",
  "creditAccountCode": "5",
  "amountSource": "inss_total"
}
```

Observacao:

- Os codigos de conta acima sao ilustrativos.
- A configuracao real deve respeitar o plano de contas da empresa.

## Evolucao do modelo atual de `AccountingEntry`

O modulo atual ja existe e deve ser aproveitado.

Campos adicionais sugeridos em `AccountingEntry`:

- `circularId`
- `ruleId`
- `eventType`
- eventualmente algum snapshot ou referencia do valor de origem

Campos existentes que devem evoluir semanticamente:

- `origem`: hoje usa principalmente `MANUAL`, `OFX`, `PDF`; deve aceitar `SERPRO`
- `status`: hoje usa `RASCUNHO`, `CONFIRMADO`, `EXPORTADO`; o fluxo automatico pode exigir estados como `GENERATED`, `REVIEWED`, `APPROVED`, `POSTED`, `ERROR`

Decisao pendente:

- definir se o sistema migra a nomenclatura de status ou se adapta o fluxo novo aos status atuais.

## Ligacao entre Circular e lancamentos

Existem duas abordagens possiveis.

### Abordagem A: colunas fixas na Circular

Adicionar campos como:

- `receita_entry_id`
- `das_entry_id`
- `inss_entry_id`

Vantagem:

- simples para MVP.

Desvantagem:

- fica rigido para novos eventos.

### Abordagem B: relacao reversa via `AccountingEntry`

Salvar em `AccountingEntry`:

- `circularId`
- `eventType`

E criar restricao de unicidade por empresa, competencia, evento e origem.

Vantagem:

- escala melhor para eventos futuros.

Preferencia registrada neste plano:

- Preferir a abordagem B para evitar rigidez estrutural.

## Regra contra duplicidade

Ponto obrigatorio do desenho:

- se o SERPRO sincronizar duas vezes, o sistema nao pode gerar dois lancamentos iguais.

Restricao sugerida:

- `UNIQUE(company_id, competencia, event_type, origin)`

Exemplo de unicidade:

- Empresa A + `202603` + `RECEITA_SIMPLES` + `SERPRO`

deve existir apenas uma vez.

## Mudanca de valor no SERPRO

Regra recomendada:

1. Se o lancamento ainda estiver em estado gerado/rascunho/revisavel:
   - atualizar automaticamente valor, historico e linhas.

2. Se o lancamento ja estiver aprovado/postado/exportado:
   - nao alterar automaticamente.
   - marcar divergencia para revisao humana.

Campos sugeridos na Circular:

- `has_accounting_divergence`
- `accounting_divergence_message`

## Servico de geracao automatica

Criar um service dedicado, por exemplo:

- `apps/api/src/application/accounting/AccountingEntryGeneratorService.js`

Responsabilidades:

1. Carregar a Circular.
2. Transformar os dados fiscais em eventos.
3. Buscar regra ativa da empresa e, se nao existir, aplicar fallback para a regra global.
4. Criar ou atualizar lancamento automatico.
5. Registrar divergencias quando necessario.

## Transformacao da Circular em eventos

Comportamento esperado:

- se `receita_bruta > 0`, gerar `RECEITA_SIMPLES`
- se `das_total > 0`, gerar `DAS_SIMPLES`
- se `inss_total > 0`, gerar `INSS_DCTFWEB`

Cada evento deve carregar:

- `eventType`
- `amount`
- `amountSource`
- referencia ao campo de origem na Circular

## Templates de historico

Permitir historico parametrizado, por exemplo:

- `{{competencia}}`
- `{{companyName}}`
- `{{cnpj}}`

Exemplo:

- `VR REF RECEITA BRUTA DO SIMPLES NACIONAL - {{competencia}}`

Resultado:

- `VR REF RECEITA BRUTA DO SIMPLES NACIONAL - 03/2026`

## Estrategia de data do lancamento

Adicionar na regra:

- `entry_date_strategy`

Valores sugeridos:

- `LAST_DAY_OF_MONTH`
- `DUE_DATE`
- `SYNC_DATE`
- `MANUAL`

Sugestao inicial:

- Receita: `LAST_DAY_OF_MONTH`
- DAS: `DUE_DATE`
- INSS: `DUE_DATE`

## Endpoints necessarios

### Regras de lancamento

- `POST /api/companies/:companyId/accounting-entry-rules`
- `GET /api/companies/:companyId/accounting-entry-rules`
- `POST /api/accounting-entry-rules/global`
- `GET /api/accounting-entry-rules/global`
- `PUT /api/accounting-entry-rules/:ruleId`
- `PATCH /api/accounting-entry-rules/:ruleId/deactivate`

Observacao:

- Melhor desativar do que deletar regras ja utilizadas.
- A API deve deixar claro no payload se a regra e `GLOBAL` ou `COMPANY`.

### Lancamentos gerados pela Circular

- `GET /api/companies/:companyId/circular/:competencia/accounting-entries`
- `PATCH /api/accounting-entries/:entryId/approve`
- `PUT /api/accounting-entries/:entryId`

## Ajuste no fluxo SERPRO

Depois da sincronizacao fiscal, o sistema deve chamar o gerador de lancamentos automaticos.

Fluxo pretendido:

1. sincroniza SERPRO
2. atualiza Circular
3. gera lancamentos automaticos
4. retorna Circular com seus lancamentos relacionados

## Total de despesas no MVP

Para o MVP:

- a Circular continua podendo mostrar totais fiscais diretamente de seus campos
- os lancamentos contabeis sao gerados em paralelo
- o dashboard pode continuar usando a Circular como fonte simples para totais operacionais

Evolucao futura:

- calcular despesas a partir da classificacao contabil, quando o plano de contas e as regras estiverem maduros.

## Ordem de implementacao sugerida

1. Criar a tabela fiscal da Circular.
2. Criar a tabela `accounting_entry_rules`.
3. Evoluir `AccountingEntry` para suportar origem fiscal automatica.
4. Criar o service `generateEntriesFromCircular`.
5. Acoplar o service ao final da sincronizacao SERPRO.
6. Criar CRUD das regras.
7. Criar endpoints para listar e revisar lancamentos da Circular.
8. Implementar aprovacao/edicao dos lancamentos automaticos.
9. Implementar alerta de divergencia quando o SERPRO mudar valor ja aprovado.

## MVP recomendado

Primeiro corte funcional:

1. Usuario configura regra de `RECEITA_SIMPLES`.
2. SERPRO traz `receita_bruta`.
3. Sistema salva `receita_bruta` na Circular.
4. Sistema gera lancamento automatico.
5. Tela mostra o valor fiscal na Circular e o lancamento gerado abaixo ou em aba lateral.

Depois replicar a mesma estrutura para:

- `DAS_SIMPLES`
- `INSS_DCTFWEB`

## Interpretacao consolidada

Este plano significa, na pratica:

- a Circular deixa de ser uma visualizacao derivada da contabilidade
- a Circular passa a ser a base fiscal mensal da empresa
- cada fato fiscal vira um evento contabil potencial
- a contabilizacao nasce de regras configuradas pelo usuario
- os lancamentos automaticos reaproveitam o modulo atual de `AccountingEntry`
- o usuario continua no controle por revisao, edicao e aprovacao

## Decisoes em aberto

1. Confirmar o nome final da tabela da Circular e seu relacionamento com `PortalClient`.
2. Definir se os novos status substituem `RASCUNHO/CONFIRMADO/EXPORTADO` ou se havera adaptacao progressiva.
3. Definir se o vinculo Circular -> lancamento sera por colunas fixas na Circular ou por relacao reversa via `eventType`.
4. Confirmar se datas por tipo de evento entram no MVP ou em segunda etapa.
5. Definir como DCTFWeb e outras origens fiscais estruturadas entrarao no pipeline apos PGDAS-D.

## Registro

Documento salvo na raiz do projeto em `2026-04-28` para retomada futura.
