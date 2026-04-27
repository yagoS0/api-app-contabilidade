# SERPRO PGDAS-D Plan

## Objetivo
Integrar o backend ao SERPRO Integra Contador para capturar guias do Simples Nacional / PGDAS-D como origem principal dos dados, persistindo PDF e metadados estruturados no sistema atual.

## Escopo da primeira fase
- Autenticacao tecnica no SERPRO
- Validacao de elegibilidade por empresa
- Captura de guia PGDAS-D / DAS
- Persistencia em `Guide`
- Persistencia de payload bruto e logs
- Reuso do fluxo atual de envio por e-mail

## Fora de escopo desta fase
- Parcelamento
- DCTFWeb
- Transmissao de declaracoes
- Dashboard operacional completo
- Fallback avancado com parser PDF

## Principios
- SERPRO e a origem principal da guia
- PDF passa a ser anexo/evidencia
- Metadados vem da resposta estruturada da API
- `Guide` continua sendo a entidade final de envio
- Toda operacao deve respeitar multi-tenancy via `portalClientId`

## Estado atual do projeto
### Backend existente
- Entidade final de guias: `Guide`
- Empresa operacional: `PortalClient`
- Upload/parser atual:
  - `apps/api/src/application/guides/GuideUploadService.js`
- Servico central de guias:
  - `apps/api/src/application/guides/GuideService.js`
- Envio por e-mail:
  - `apps/api/src/application/guides/GuideCompanyEmailService.js`
  - `apps/api/src/workers/guideEmailWorker.js`

### O que vamos reaproveitar
- Persistencia da entidade `Guide`
- Campo `pdfBytes` para armazenar PDF
- Fluxo de `emailStatus = PENDING -> worker -> SENT`
- Resolucao de e-mail por empresa ja existente

## Arquitetura proposta
### Novos arquivos
```txt
apps/api/src/application/fiscal/serpro/
  SerproConfig.js
  SerproAuthService.js
  SerproHttpClient.js
  SerproErrorMapper.js
  SerproEligibilityService.js
  SerproProcurationService.js
  SerproPgdasdService.js
  SerproGuiaMapper.js
  CaptureSerproGuidesService.js
```

### Rotas futuras
```txt
apps/api/src/routes/firm/serpro.js
```

## Modelagem de dados
### Reaproveitar `Guide`
Adicionar campos para rastrear origem fiscal:
- `integrationSource`
- `serproSistema`
- `serproServico`
- `numeroDocumento`
- `referenceKey`
- `idempotencyKey`
- `rawPayloadJson`
- `captureStatus`

### Nova tabela: FiscalIntegrationCompany
Objetivo: guardar elegibilidade por empresa.

Campos sugeridos:
- `id`
- `portalClientId`
- `cnpj`
- `active`
- `procurationStatus`
- `procurationValidUntil`
- `servicesEnabledJson`
- `lastSyncAt`
- `lastResult`
- `lastError`
- `createdAt`
- `updatedAt`

### Nova tabela: FiscalIntegrationLog
Objetivo: auditoria tecnica das chamadas.

Campos sugeridos:
- `id`
- `portalClientId`
- `system`
- `service`
- `reference`
- `requestSummary`
- `responseSummary`
- `status`
- `errorType`
- `errorMessage`
- `retryable`
- `createdAt`

## Variaveis de ambiente previstas
Adicionar em `apps/api/src/config.js`:
- `SERPRO_BASE_URL`
- `SERPRO_CONSUMER_KEY`
- `SERPRO_CONSUMER_SECRET`
- `SERPRO_CERT_COMPANY_ID` ou equivalente
- `SERPRO_TIMEOUT_MS`
- `SERPRO_ENV`
- `SERPRO_ENABLE_PGDASD`

## Regras de negocio
### Elegibilidade da empresa
Antes de buscar guia:
- empresa deve existir em `PortalClient`
- CNPJ deve estar valido
- deve haver e-mail de guias
- deve haver certificado configurado
- deve haver procuracao/autorizacao valida
- PGDAS-D deve estar habilitado para a empresa

### Idempotencia
Chave sugerida:
`{cnpj}:{tipoGuia}:{sistema}:{referencia}:{numeroDocumento}`

Exemplo:
`12345678000199:DAS_SN:PGDASD:2026-04:1234567890`

Objetivos:
- evitar duplicidade de captura
- evitar duplicidade de persistencia
- evitar duplicidade de envio

## Fluxo PGDAS-D
1. Selecionar empresa elegivel
2. Validar procuracao
3. Autenticar no SERPRO
4. Chamar servico PGDAS-D
5. Receber PDF/base64 + metadados
6. Mapear resposta para formato interno
7. Gerar `idempotencyKey`
8. Verificar duplicidade
9. Persistir `Guide`
10. Salvar payload bruto
11. Marcar `emailStatus = PENDING`
12. Reaproveitar worker de e-mail existente

## Servico PGDAS-D
### Responsabilidade
`SerproPgdasdService`
- montar payload do servico
- chamar endpoint do Integra Contador
- retornar resposta normalizada minima

### Entrada inicial
- `contratanteCnpj`
- `contribuinteCnpj`
- `periodoApuracao`

### Saida esperada
- `pdfBase64`
- `numeroDocumento`
- `vencimento`
- `valorTotal`
- `rawPayload`

## Mapper
### Responsabilidade
`SerproGuiaMapper`
Converter resposta do SERPRO em objeto persistivel para `Guide`.

### Tipo inicial
- `tipo = SIMPLES`
- `integrationSource = SERPRO_PGDASD`

## Erros
### Retry automatico
- `TIMEOUT`
- `NETWORK_ERROR`
- `HTTP_5XX`
- `SERVICE_UNAVAILABLE`

### Erro operacional sem retry automatico
- `AUTH_ERROR`
- `CERT_ERROR`
- `PROCURACAO_INATIVA`
- `COMPANY_NOT_ENABLED`
- `INVALID_INPUT`
- `BUSINESS_ERROR`

## Ordem de implementacao
### Etapa 1
- Criar `SerproConfig.js`
- Criar `SerproAuthService.js`
- Criar `SerproHttpClient.js`
- Criar `SerproErrorMapper.js`

### Etapa 2
- Criar migration com novas tabelas/campos
- Criar `SerproProcurationService.js`
- Criar `SerproEligibilityService.js`

### Etapa 3
- Criar `SerproPgdasdService.js`
- Criar `SerproGuiaMapper.js`
- Criar `CaptureSerproGuidesService.js`

### Etapa 4
- Criar rota manual de teste por empresa/competencia
- Persistir `Guide`
- Disparar fluxo atual de envio

### Etapa 5
- Criar worker recorrente de captura
- Criar reprocessamento
- Melhorar observabilidade

## Primeira entrega funcional
Meta:
- para uma empresa e uma competencia, capturar uma guia DAS do PGDAS-D via SERPRO e salva-la no sistema com envio por e-mail reaproveitando o fluxo atual

## Pendencias em aberto
- definir como sera escolhido o certificado do escritorio/procurador
- confirmar formato exato do endpoint contratado do SERPRO
- confirmar se o payload bruto ficara em coluna JSON ou storage externo
- definir se a validacao de procuracao sera executada em toda captura ou com cache temporal

## Proximo passo
Implementar a fundacao tecnica do modulo SERPRO e a primeira captura PGDAS-D em rota manual controlada.
