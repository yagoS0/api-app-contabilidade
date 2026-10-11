# Apuração: correções e fundação CBS/IBS

Implementação de 11/10/2026. A publicação autorizada foi preparada em checkout isolado de `main`, preservando o checkout original. Inclui o cadastro histórico da reforma como dependência da fundação CBS/IBS e somente as duas migrações aditivas correspondentes. Não habilita consultas fiscais, emissão de guias ou sincronização oficial.

## Etapa 0

- Lucro Real resolve para `NAO_SUPORTADO` no dispatcher de apuração, com mensagem própria na ficha. Não abre o motor do Simples nem o do Presumido.
- A guarda `exigirRegimeLp` protege cálculo, captura, provisão e reemissão, incluindo chamadas diretas por workers/assistente. Guias legadas de empresa do Real não são reemitidas pelo motor LP. A recusa HTTP é 409, antes de transporte ou gravação de recálculo.
- A política anterior de cálculo aproximado com regime desconhecido e aviso permanece. Captura/provisão/emissão exigem cadastro confirmado como LP.
- Lista global: competência, busca e cliente de API identificam o contexto; respostas antigas são descartadas, seleção não atravessa contexto e ações ficam bloqueadas até a lista atual carregar. Há trava síncrona contra envio duplo.
- Competência inicial calcula o mês anterior em Brasília, inclusive virada de ano e dias 29–31.

## Etapa 1

Quatro modelos independentes de `ApuracaoSnapshot`/PGDAS:

| Modelo | Responsabilidade |
| --- | --- |
| `ApuracaoConsumoContribuinte` | CNPJ-base explícito, sem agregar empresas automaticamente |
| `ApuracaoConsumoEstabelecimento` | Vínculo explícito com `PortalClient`, mesma base e CNPJ com DV validado no serviço |
| `ApuracaoConsumoConfiguracao` | Revisão por contribuinte, CBS/IBS e homologação/produção; referências de contrato/cofre |
| `ApuracaoConsumoRevisao` | Preparação por competência, versão, configuração e snapshot histórico de todos os estabelecimentos |

A migração aditiva `20261011190000_apuracao_consumo_fundacao` cria índices de versão/intenção, checks, FK composta para impedir uso de configuração de outro contexto e triggers de imutabilidade. Vínculos não podem ser apagados ou remanejados por esta entrega. Correção excepcional de identidade exige fluxo auditado posterior; não editar diretamente as tabelas. Mudança cadastral de CNPJ para outra base é bloqueada quando já existe vínculo.

O contrato de autorização mantém o administrador global já existente. Para os demais usuários, exige vínculo ativo de nível ACCOUNTANT ou FIRM_ADMIN em **todos** os estabelecimentos do grupo, também nas leituras: a referência ao cofre não pode revelar metadados a STAFF. Não cria isolamento entre escritórios inexistente no modelo atual. Acrescentar uma filial pode tornar o grupo inacessível a um usuário que só tenha acesso à matriz; as permissões não são concedidas automaticamente.

Configurações e revisões usam transação Serializable, intenção UUID e hash do conteúdo normalizado. Repetir a mesma intenção devolve o registro existente; reutilizar a intenção com conteúdo diferente ou disputar a mesma versão resulta em 409. Não há repetição automática de transação/consulta externa.

O enquadramento é lido de `ReformaFiscalRevisao` por competência. É necessária cobertura do mês inteiro para reconhecer enquadramento regular confirmado; mudança no meio do mês fica pendente. A revisão congela cadastro, versão, período e estabelecimentos. Alteração posterior de cadastro, composição do grupo, configuração ou disponibilidade da referência do cofre marca a preparação anterior como desatualizada. Nenhum segredo do cofre é lido ou retornado.

O único estado disponível é `PREPARACAO`. `habilitado` significa preparação **local**; não autentica o contribuinte, não confirma habilitação oficial e não agenda sincronização. Valores oficiais são `null`, cobertura é `NAO_COLETADA` e todas as capacidades externas permanecem falsas. Não há mecanismo para promover uma preparação a conferida, emitir guia ou declarar pagamento.

## API e interface

Rotas sob `/firm/companies/:companyId/apuracao-consumo`, com autenticação FIRM, RBAC e `Cache-Control: no-store`:

- `GET ?tributo=CBS&ambiente=HOMOLOGACAO&competencia=2027-01`: preparação atual e indicação de desatualização; não grava nada.
- `POST /estabelecimentos`: `{ portalClientIds: [...] }`, incluindo a empresa da URL, máximo de 100 IDs por solicitação. Revalida acesso a todo o grupo.
- `POST /configuracoes`: `{ id, versao, tributo, ambiente, habilitado, dados: { motivo, referenciaContrato?, credencialId?, credencialPortalClientId? } }`.
- `POST /revisoes`: `{ id, versao, tributo, ambiente, competencia, motivo }`.

`id` é UUID v4 de intenção; `versao` é a versão conhecida pelo cliente, zero na primeira gravação. Campos inesperados são recusados. Referências de credencial só são aceitas para estabelecimentos do grupo e precisam existir no cofre. A remoção posterior gera pendência e invalida a preparação anterior.

A seção recolhida **Preparação da apuração IBS/CBS** fica no cadastro da reforma. Permite vincular a empresa atual, escolher contexto, salvar configuração e preparar uma competência. Lista os estabelecimentos já vinculados e indica pendências/ausência de coleta. A seleção de múltiplas filiais e associação inicial ao cofre estão disponíveis no contrato de serviço/API, mas ainda não têm editor próprio na interface. Referências já existentes são preservadas ao editar configuração.

O mock comum declara demonstração e recusa gravações da fundação. Não representa serviço oficial ou banco real. A interface deve ser publicada com o modo real explicitamente configurado.

## Validação reproduzível

Executar na raiz do monorepo:

```text
npm test -w @contabilidade/api -- --runInBand apuracaoConsumo reformaCadastro verificarNfse reformaFiscal regimeDoPresumido calculoLpLigacao apuracaoPresumido capturaLpSemDuplicarInss exigirRegimeLp apuracaoLpRota recalculoRegistroRota procedenciaDas apuracaoBatchVinculo
npm test -w @contabilidade/web -- --runInBand --watch=false apuracao reforma estadoApuracao regimeDaAba baseApuracaoConsumo apuracaoConsumoApi
npm run build -w @contabilidade/web
node scripts/run-consumo-postgres.mjs "C:\Users\yagoa\code\.tools\postgresql16\pgsql\bin"
```

O runner cria banco efêmero em localhost/porta aleatória, aplica todo o histórico de migrations, gera cliente Prisma isolado, verifica concorrência/constraints/permissões e encerra o cluster em `finally`. Não utiliza `DATABASE_URL` de clientes. Evidências ficam em `test-evidence/consumo-postgres-*/`.

Resultado da validação desta entrega:

- API: 13 suítes, 222 testes aprovados (`test-evidence/consumo-api-jest.json`).
- Interface/contratos: 30 suítes, 352 testes aprovados (`test-evidence/consumo-web-jest.json`). Total consolidado: 574 testes distintos.
- PostgreSQL real descartável: 187 migrations aplicadas e oito grupos de verificações aprovados, incluindo exclusão de credencial e recusa de STAFF. Evidência: `test-evidence/consumo-postgres-1791754211474/summary.json`; cluster encerrado.
- Build web aprovado; avisos preexistentes de tamanho de chunks e importações mistas.
- Inspeção visual automatizada e visualização das capturas em 1440 e 390 px, sem overflow ou erros JavaScript. O fluxo usa fixture fictícia somente no navegador, sem representar homologação de API. Script: `apps/web/scripts/verify-apuracao-consumo-layout.mjs`; capturas: `test-evidence/apuracao-consumo/desktop.png` e `mobile.png`.
- Lint padrão bloqueado por incompatibilidade preexistente de ESLint (`eslint/config`, `ERR_PACKAGE_PATH_NOT_EXPORTED`). Checagem estática isolada de 13 arquivos passou para identificadores indefinidos, código inalcançável e chaves duplicadas (`test-evidence/check-consumo-static.mjs`).

## Publicação e recuperação

Na branch isolada de publicação, as 13 suítes de API (222 testes) foram repetidas com sucesso. O histórico atualizado de `main` contém 195 migrações com esta entrega; todas foram aplicadas em PostgreSQL descartável, com oito verificações de consumo e quatro de cadastro da reforma aprovadas. Os builds web e portal-cliente passaram. A CI passa a executar explicitamente a regressão da apuração e da fundação.

O procedimento de produção exige backup nativo do volume PostgreSQL, comparação dos checksums do histórico aplicado, aplicação exclusiva de `20261010160000_reforma_fiscal_historico` e `20261011190000_apuracao_consumo_fundacao`, seguida da publicação e testes HTTP autenticados de leitura. Não executar reset, db push ou backfill. O rollback ordinário é do código, mantendo as tabelas aditivas e os dados eventualmente cadastrados. Restauração de backup só se justifica em incidente de dados, considerando escritas posteriores ao snapshot.

O resultado operacional fica registrado separadamente das fontes. A revisão fiscal da carteira e a homologação das APIs oficiais continuam pertencendo às próximas etapas; a fundação local não comprova disponibilidade dos serviços oficiais CBS/IBS.
