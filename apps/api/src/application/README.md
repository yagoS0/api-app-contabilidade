# Application module

Camada de casos de uso e regras de negocio.

## Responsabilidades

- Orquestrar fluxos de negocio sem acoplamento HTTP.
- Aplicar regras de dominio (status, validacoes, transicoes).
- Integrar com `infrastructure` para DB, storage, e-mail e APIs externas.

## Submodulos

- `auth/`: autenticacao, JWT e refresh token.
- `guides/`: ingestao, classificacao e envio de guias.
- `nfse/`: emissao e sincronizacao de notas fiscais.
- `sync/`: engine de sincronizacao de documentos/invoices.
- `company/`: validacao e normalizacao de cadastro.
- `validators/`: validadores de payload.

## Observacoes

- Evitar logica de regra de negocio em arquivos de rota.
- Centralizar comportamentos reutilizaveis aqui para manter consistencia.
