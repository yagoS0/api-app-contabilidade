# Sessao SERPRO - 2026-04-24

## Contexto

Sessao de depuracao da integracao SERPRO / Integra Contador para:

- consulta de procuracao
- captura manual de PGDAS-D

Empresa usada nos testes:

- `portalCompanyId`: `83a840a5-85d5-44e9-b35d-b546cd3b6b51`
- razao: `LENTE - MEDICAL MARKETING LTDA`
- cnpj: `24352609000198`

Certificado do procurador identificado como:

- `39254243000191`

## Problemas encontrados e correcoes

### 1. `serpro_pgdasd_disabled`

Problema:

- a integracao estava sendo bloqueada antes da chamada externa
- parte do fluxo ainda dependia de validacao por env, nao apenas da configuracao runtime salva no banco

Correcao:

- upload do certificado passou a habilitar a integracao por padrao quando ainda nao havia decisao explicita
- o cliente HTTP SERPRO deixou de validar somente `SERPRO_ENABLE_PGDASD` no construtor
- o fluxo passou a usar a configuracao runtime do banco

Arquivos afetados:

- `apps/api/src/application/fiscal/serpro/SerproRuntimeSettings.js`
- `apps/api/src/application/fiscal/serpro/SerproHttpClient.js`
- `apps/api/src/routes/firm/index.js`

### 2. Sessao expirada no frontend

Problema:

- a tela do SERPRO continuava fazendo chamadas com JWT expirado
- backend registrava varios `jwt expired`

Correcao:

- ao receber `401`, o frontend agora limpa sessao, reseta o estado e volta para login

Arquivos afetados:

- `apps/web/src/api/real/realApi.js`
- `apps/web/src/api/mock/mockApi.js`
- `apps/web/src/App.jsx`

### 3. `serpro_procurador_cnpj_not_configured`

Problema:

- o CNPJ do titular do certificado nao estava sendo extraido corretamente do PFX
- a extracao inicial usava campo inadequado do subject

Correcao:

- a leitura do PFX foi ajustada
- a prioridade correta passou a considerar `serialNumber`, depois `CN`, depois `OU`
- o valor persistido em banco foi corrigido para `39254243000191`

Arquivo afetado:

- `apps/api/src/application/fiscal/serpro/SerproRuntimeSettings.js`

### 4. `Unsupported PKCS12 PFX data`

Problema:

- o Node/OpenSSL rejeitava o uso direto do PFX no `https.Agent`

Correcao:

- o backend passou a extrair `cert` e `key` do PFX com `node-forge`
- o `https.Agent` passou a usar PEM em vez de `pfx + passphrase`

Arquivo afetado:

- `apps/api/src/application/fiscal/serpro/SerproAuthService.js`

### 5. Header obrigatorio `Role-Type`

Problema:

- o SERPRO recusava a chamada com a mensagem `O header 'Role-Type' deve estar preenchido.`

Correcao:

- header `Role-Type: TERCEIROS` foi adicionado na autenticacao e nas chamadas da API

Arquivos afetados:

- `apps/api/src/application/fiscal/serpro/SerproAuthService.js`
- `apps/api/src/application/fiscal/serpro/SerproHttpClient.js`

### 6. `Runtime Error` / `No matching resource found for given API Request`

Problema:

- a URL do Integra Contador estava sendo chamada com path incorreto

Descoberta:

- para o fluxo testado de procuracao, o endpoint funcional foi `POST /Consultar`

Correcao:

- a consulta de procuracao passou a usar `/Consultar`

Arquivo afetado:

- `apps/api/src/application/fiscal/serpro/SerproProcurationService.js`

### 7. `HEADER jwt_token invalido`

Problema:

- as chamadas ao Integra Contador exigem o header `jwt_token`, alem do bearer token

Correcao:

- o backend passou a capturar `jwt_token` na autenticacao
- o cliente HTTP passou a enviar `jwt_token` nas requisicoes ao SERPRO

Arquivos afetados:

- `apps/api/src/application/fiscal/serpro/SerproAuthService.js`
- `apps/api/src/application/fiscal/serpro/SerproHttpClient.js`

### 8. Payload incorreto da consulta de procuracao

Problema:

- o payload inicial da procuracao nao seguia o formato aceito pelo servico `OBTERPROCURACAO41`

Formato que funcionou:

- endpoint: `/Consultar`
- `contribuinte` no topo = CNPJ da empresa outorgante
- `pedidoDados.dados` contendo:
  - `outorgante`
  - `tipoOutorgante`
  - `outorgado`
  - `tipoOutorgado`

Correcao:

- payload da procuracao ajustado para o formato aceito pelo SERPRO
- parser ajustado para ler `dados` vindo como JSON string

Arquivo afetado:

- `apps/api/src/application/fiscal/serpro/SerproProcurationService.js`

## Estado atual da procuracao

Teste direto no backend retornou sucesso:

- `status`: `ATIVA`
- `systems`: `TODOS`

Resultado observado:

```json
{
  "company": {
    "id": "83a840a5-85d5-44e9-b35d-b546cd3b6b51",
    "razao": "LENTE - MEDICAL MARKETING LTDA",
    "cnpj": "24352609000198"
  },
  "procuradorCnpj": "39254243000191",
  "status": "ATIVA",
  "validUntil": null,
  "systems": ["TODOS"]
}
```

## Estado atual do PGDAS-D

Servico testado atualmente:

- `idSistema`: `PGDASD`
- `idServico`: `GERARDASCOBRANCA17`

Interpretacao funcional:

- esse servico busca DAS em contexto de cobranca
- tende a ser util para debitos em aberto / nao pagos / recalculados em atraso

### Erro observado na competencia `2026-03`

Resposta real do SERPRO:

- `status`: `200`
- sem PDF
- mensagem:
  - `Nao foram encontrados debitos de Simples Nacional para este periodo.`

Correcao aplicada:

- esse caso deixou de cair no erro tecnico `SERPRO_PGDASD_PDF_NOT_FOUND`
- agora vira erro de negocio:
  - `SERPRO_PGDASD_NO_DEBTS_FOUND`

Arquivos afetados:

- `apps/api/src/application/fiscal/serpro/CaptureSerproGuidesService.js`
- `apps/api/src/routes/firm/index.js`

## Conclusoes praticas

- a consulta de procuracao esta funcionando no backend
- a autenticacao SERPRO com certificado + bearer + `jwt_token` esta funcionando
- a captura de PGDAS-D tambem esta chegando ao servico correto
- para a competencia testada (`2026-03`), o SERPRO informou que nao existem debitos em cobranca

## Proximos passos sugeridos

1. Reiniciar a API antes de novos testes pela tela.
2. Testar outra competencia com DAS em cobranca conhecida.
3. Melhorar a mensagem no frontend para `SERPRO_PGDASD_NO_DEBTS_FOUND`.
4. Se necessario, integrar outros servicos do PGDAS-D alem do `GERARDASCOBRANCA17`, por exemplo:
   - gerar DAS normal
   - consultar extrato do DAS
   - consultar declaracao/recibo

## Observacoes uteis

- A documentacao publica confirmou o uso de `Role-Type: TERCEIROS`.
- O fluxo da API tambem exige `jwt_token` nas chamadas ao Integra Contador.
- Para procuracao, o body funcional precisa manter coerencia entre:
  - `contribuinte` (topo)
  - `outorgante` em `pedidoDados.dados`
