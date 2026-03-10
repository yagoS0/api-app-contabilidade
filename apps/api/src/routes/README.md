# Routes module

Responsavel por mapear endpoints HTTP e aplicar regras de autorizacao.

## Responsabilidades

- Receber requests e validar entrada basica.
- Aplicar middlewares de autenticacao/autorizacao.
- Encaminhar para servicos na camada `application`.
- Padronizar respostas HTTP e codigos de erro.

## Principais arquivos

- `auth.js`: login, refresh, me e cadastro.
- `admin.js`: aprovacao/rejeicao e gestao de usuarios.
- `client/index.js`: portal de usuarios CLIENT.
- `firm/index.js`: portal de usuarios FIRM.
- `portalClients.js`, `portalInvoices.js`, `portalSync.js`: dominio de notas/sync.
- `nfse.js` e `adn.js`: emissao/consulta e sincronizacao de NFS-e.
- `run.js` e `status.js`: execucoes manuais e status operacional.

## Referencias de documentacao de rotas

- `docs/api-routes.md`: catalogo detalhado de endpoints, payloads e respostas.
- `api.http`: colecao de chamadas para testes manuais no ambiente local.

## Fluxo resumido

1. `server.js` registra o router no prefixo adequado.
2. A rota valida permissao e payload.
3. A rota chama um caso de uso em `application`.
4. Erros mapeados retornam `error`/`reason` no corpo da resposta.
