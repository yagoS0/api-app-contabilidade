# Apuração assistida: coleta técnica CBS

Registro da etapa de 11/10. A continuação de 12/10 acrescentou segurança OAuth/download, inspeção local e livro mensal; o estado consolidado e as pendências atuais estão no [plano integral](apuracao-plano-integral-2026-10-12.md). Os números e limites abaixo descrevem a verificação original desta etapa.

Continuação das etapas 0 e 1 publicadas pela PR 143. Esta entrega implementa o transporte e a persistência técnica da coleta CBS, com acompanhamento no perfil fiscal. Foi preparada em `codex/apuracao-cbs-etapa-2`, a partir da versão publicada, sem alterar o checkout principal. Não foi publicada nem migrada em produção.

## O que foi implementado

- Adaptador dos endpoints oficiais de abertura de débitos/créditos e consulta de situação, com ambientes separados. A abertura envia somente `urlRetorno`; não inventa filtro de competência ou cursor.
- Reserva transacional antes do transporte, intenção idempotente, bloqueio de operações concorrentes e proteção contra tíquete repetido por contribuinte/ambiente. Repetir uma intenção lê o registro existente, sem repetir a chamada externa.
- Estados técnicos de reserva, espera, processamento, disponibilidade, armazenamento, erro, incerteza e expiração. Eles não alteram a revisão de apuração `PREPARACAO`.
- Arquivo preservado byte a byte, com SHA-256 e AES-256-GCM. A autenticação da cifra vincula contribuinte, ambiente, coleta e finalidade. O envelope precisa corresponder ao CNPJ-base, tíquete, recurso e períodos retornados; isso não valida cálculos ou direito a crédito.
- Evidência HTTP por resumo canônico dos campos autorizados, expressamente diferente do corpo HTTP original. URL assinada fica cifrada, fora de DTOs e logs; é descartada após uso ou reconhecimento explícito de expiração.
- Painel **Coleta CBS** dentro da preparação IBS/CBS, com recursos, bloqueios, solicitações, tentativas e metadados dos arquivos. Abrir ou atualizar o painel consulta somente o banco local. Leituras não disparam coleta, processamento ou escrita.
- Limite local conservador de quatro aberturas por contribuinte/ambiente/dia em Brasília, somando débitos e créditos. Não é uma afirmação sobre o escopo da cota oficial.

A coleta pode trazer várias competências. Não há soma de atualizações, saldo oficial calculado, conciliação, crédito apropriado, fechamento, guia, baixa ou coleta IBS nesta entrega. Arquivo armazenado permanece com cobertura não validada e valores oficiais não normalizados. A primeira coleta feita pelo ALTAN não é presumida como primeira consulta oficial.

## Contrato interno

Todas as rotas ficam sob `/firm/companies/:companyId/apuracao-consumo/cbs/coletas`, exigindo ACCOUNTANT/FIRM_ADMIN em todos os estabelecimentos do grupo, além do contrato de administrador global existente. Identidade e escopo vêm da sessão e do servidor.

| Método e sufixo | Entrada | Efeito |
| --- | --- | --- |
| GET | `ambiente` | Lista local de até 100 coletas, com indicação de truncamento e capacidades. Sem acesso externo. |
| POST | `{ id, ambiente, recurso }` | Abertura explícita de DEBITOS ou CREDITOS, somente se a integração estiver habilitada. |
| POST `/:coletaId/consultar` | `{ id, ambiente }` | Consulta explícita de um tíquete conhecido; não abre outra solicitação. |
| POST `/:coletaId/baixar` | `{ id, ambiente }` | Armazena o arquivo disponível após verificar identidade, prazo e integridade. |

`id` é UUID v4 da intenção. Competência, datas e cursor são recusados. O cliente técnico precisa estar vinculado ao contribuinte, ambiente e referência de credencial do contexto autorizado. A disponibilidade de uma referência no cofre não comprova acesso oficial.

GET apresenta disponibilidade expirada sem gravar. Uma nova abertura explícita pode encerrar a disponibilidade expirada do mesmo recurso e contexto, se não existir operação em curso. Não encerra automaticamente reservas ou resultados incertos. Processo interrompido mantém a reserva bloqueada; não existe reclaim, scheduler, retry ou catchup.

## Persistência e implantação futura

Migração aditiva `20261011223000_apuracao_cbs_coleta`, posterior à fundação de consumo. Acrescenta `ApuracaoCbsColeta`, `ApuracaoCbsTentativa` e `ApuracaoCbsArquivo`, com FKs compostas, índices de intenção/tíquete, reserva ativa única, domínios de estado e proteção de evidências finalizadas. Arquivo e identidade da coleta não podem ser sobrescritos. Não há backfill.

Aplicar a migração e gerar Prisma antes de publicar a interface. O código anterior permanece compatível com as tabelas adicionadas; rollback de código não deve apagar evidências. A chave de criptografia não é lida de variável genérica nem criada automaticamente por esta entrega.

## Limites de ativação

O router de produção continua sem transporte e sem proteção criptográfica injetados, portanto todas as capacidades externas ficam falsas. Não há flag de interface que contorne isso. As credenciais do SERPRO Integra Contador não são reaproveitadas.

Antes de ativar uma integração real, ainda é necessário implementar e homologar:

1. Provedor OAuth com cache, isolamento, coordenação de concorrência e limite de tokens; binding validado ao contribuinte e à credencial, além de gestão/rotação da chave de cifra.
2. Webhook HTTPS acessível e autenticação/correlação confirmadas com o provedor. HEAD comprova apenas disponibilidade. Nenhum webhook público foi aberto nesta entrega.
3. Política confirmada de hosts de download e transporte que fixe resolução DNS segura, impedindo endereços privados e rebinding. O adaptador atual exige allowlist explícita, HTTPS, ausência de credenciais na URL, limite de bytes/tempo e recusa de redirects; essas guardas não substituem a validação DNS para ativação.
4. Procedimento auditado para reconciliar uma reserva interrompida ou abertura incerta sem tíquete, sem repetir automaticamente a solicitação.
5. Fixtures de homologação que confirmem identidade/revisão dos itens, atualizações, exclusões, cobertura e precisão monetária, antes de normalizar ou conciliar valores.

As fontes e suas lacunas estão em [contrato CBS](apuracao-cbs-contrato-2026-10-11.md). Documentação pública de um endpoint não comprova habilitação operacional.

## Verificação

Os testes de transporte usam fetch injetado; os testes de persistência criam um PostgreSQL descartável. Nenhum teste chama endpoints fiscais, usa credenciais de clientes ou aplica migrações em produção.

```text
npm test -w @contabilidade/api -- --runInBand coletaCbs CbsClient apuracaoConsumo
node scripts/run-coleta-cbs-postgres.mjs <binários PostgreSQL Windows>
npm test -w @contabilidade/web -- --runInBand --runTestsByPath src/features/reforma/__tests__/coletasCbs.test.jsx src/features/reforma/__tests__/baseApuracaoConsumo.test.jsx src/features/reforma/__tests__/reforma.test.jsx src/api/real/__tests__/apuracaoConsumoApi.test.js
npm run build -w @contabilidade/web
```

A CI foi estendida com testes do adaptador/rotas e um job PostgreSQL exclusivo para a coleta. As verificações locais e as capturas ficam em `test-evidence`; a execução remota da nova CI depende da futura publicação da branch.

Resultado local final: **16 suítes/287 testes de API e 31 suítes/373 testes de interface aprovados (660 testes)**. PostgreSQL descartável: **196 migrações e dez grupos de verificações aprovados**, com cluster encerrado, em `test-evidence/coleta-cbs-postgres-1791761651066`. Schema, geração Prisma, auditoria de migrações, sintaxe, YAML da CI e `git diff --check` passaram. Build web aprovado, com avisos preexistentes de chunks/importações mistas. Inspeção visual em 1440 e 390 px sem overflow ou erros JavaScript; capturas em `test-evidence/coletas-cbs`. Evidências Jest: `cbs-etapa2-api.json` e `cbs-etapa2-web.json` nessa mesma pasta de evidências. Nenhum commit, push, deploy ou migração de produção foi executado nesta etapa.
