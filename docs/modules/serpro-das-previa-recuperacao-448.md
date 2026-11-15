# Prévia interna de elegibilidade DAS — 4.4.8

Base atribuída pelo Principal: `58edabc3dd5db84a7f3def98534f9918c50a2703` (PR284). Implementação local, sem recuperação, endpoint, UI, worker ou consumidor automático. A projeção445 e a apresentação446 permanecem inalteradas. Complementa as etapas444–447.

## Contrato

`avaliarElegibilidadeRecuperacaoDas448(input, { auth })`, em `apps/api/src/composition/previaRecuperacaoDas448.js`.

Entrada fechada: `companyId`, `competencia` AAAA-MM (ano diferente de0000), `servico` obrigatório GERARDAS12 ou GERARDASCOBRANCA17, `documentoId` opcional e `limit` inteiro1–100, padrão50. IDs aceitam1–128 caracteres alfanuméricos, hífen ou sublinhado. Campos desconhecidos, provas, ator, auth e comandos no input são recusados. A sessão vem exclusivamente do servidor e continua sujeita à guarda445/#275, inclusive vínculo ACCOUNTANT ativo e exceção admin existente. Não concede acesso global ao contador.

Operações coordena duas observações locais delimitadas. Cada observação começa com autorização canônica; a composição445 também preserva sua própria guarda. Documento é seletor candidato, nunca filtro do universo445. Documento inexistente e documento fora da empresa recebem a mesma classificação/lacunas/evidências, sem busca global. Resposta ecoa apenas o seletor fornecido.

Fiscal fornece chamadas, despacho e interpretação da resposta local através445; Guias fornece documentos/revisões/pagamentos445 e leitura adicional de histórico; Contabilidade fornece circular/fechamento/lançamentos445. Infraestrutura executa somente consultas locais. Nenhuma porta de comando é injetada. Frontends, portal, rotas, workers, cache/TTL, reservas, limpeza de duplicatas e contratos legados não são alterados.

O histórico adicional consulta AppSetting por prefixo empresarial, `value.companyId` e `value.documento.competencia`; não usa competência de pagamento. Confere chave/id e consulta guias referenciadas com filtro de empresa. Eventos órfãos permanecem visíveis como confirmação conhecida, sem presumir remoção nem associar outro documento por valor/hash. Recálculo documental registrado na guia atual conserva impedimento. Leitura vazia não prova ausência histórica; não há tombstone geral.

## Classificação e limites

| Evidência | Resultado da fronteira real |
| --- | --- |
| Reserva incerta/reservada, com ou sem cache | BLOQUEADO; lacunas continuam presentes |
| Pagamento, comprovante, baixa ou confirmação, inclusive órfã | BLOQUEADO |
| Competência contabilmente fechada, lançamento exportado, revisão divergente ou recálculo registrado | BLOQUEADO |
| Guia existente aparentemente equivalente | NAO_VERIFICAVEL: PDF e equivalência não certificados |
| Múltiplas guias, vínculo ambíguo, fonte indisponível/truncada | NAO_VERIFICAVEL, salvo bloqueio conhecido |
| Ausência completa de registros | NAO_VERIFICAVEL, nunca ausência comprovada de pagamento/histórico |

A política pura reconhece POTENCIALMENTE_ELEGIVEL e SEM_ALTERACAO_NECESSARIA somente com todos os atestados explícitos completos. Testes positivos são sintéticos. **A composição real atual não emite esses atestados**:445 não prova identidade fiscal da resposta, integridade PDF, ligação resposta–tentativa–documento, histórico integral ou ausência de efeitos financeiros. Portanto retorna BLOQUEADO/NAO_VERIFICAVEL. Nenhuma classificação autoriza escrita; `efeitosPermitidos` é sempre `[]`. Não há token executável nem booleano recuperável.

A chave do cache não é hash da resposta. Não baixar storage nem usar helper de cache que invalida. Históricos removidos sem evidência sobrevivente continuam desconhecidos. Colisões globais de hash/sourceFileId não são investigadas: isso poderia expor outra empresa. O teste de isolamento não é prova de detecção de colisão global. Confirmações sem competência documental identificada não podem ser associadas; a lacuna é explícita. Confirmações com tipo SIMPLES/DAS participam da evidência mensal, sem provar serviço normal ou de cobrança. DARF/INSS não são atribuídos ao DAS. Tipo histórico ausente gera lacuna não associável, sem inventar confirmação DAS. Igualdade de hash é exposta como hashDocumentalCoincidente, não como prova de revisão. A competência atual da guia também é confrontada com a competência documental histórica.

Compara-se internamente a representação determinística das duas observações (sem consultadoEm); não se publica fingerprint de aprovação. Bloqueio visto em qualquer leitura é preservado. Igualdade não prova snapshot transacional, imutabilidade do cache bruto nem ausência de mudança intermediária. A comparação alcança os metadados projetados445 e448, não bytes/valores omitidos pelas projeções. A segunda observação é parte fixa do protocolo, não retry de erro; não há terceira tentativa. Erro de autorização aborta. Erros das fontes445 permanecem falhas; erro da leitura histórica retorna quantidade desconhecida, nunca zero.

DTO contém classificação, impedimentos, lacunas e duas observações com momento, dez fontes identificadas por origem, estado da consulta, quantidade nullable, limite, truncamento e registros com campos explicitamente permitidos. Inclui estados de reserva/cache/despacho, identidade/revisão/hash documental, fatos de pagamento, fechamento, vínculos e logs. Confirmação substituída não significa documento substituído. Quantidades e metadados não constituem provas completas. Não contém rawPayload, resposta/base64/PDF, extracted integral, storage URL/chave, mensagem livre, dados de autor ou segredo. Motivos são códigos controlados. Quantidades são do recorte limitado, não totais universais.

## Evidências e validação

Regras preservadas: R01/R02/R06/R10/R12/R19/R20/R25/R26. Sem alteração de regra operacional, proposta fiscal, pagamento, provisão, exportação, vínculo ou fechamento. Risco alto por coordenação fiscal/financeira e autorização.

Testes de política e aplicação foram escritos antes do código produtivo. Tentativa de execução Node no sandbox falhou antes de carregar Jest: `EPERM: operation not permitted, lstat C:\Users\yagoa` (Node20.20.2). Não há resultado de testes aprovado pelo executor. Não houve ampliação de permissões.

Suítes novas: política pura (precedência/provas positivas sintéticas), aplicação (entrada fechada, guarda, duas observações, mudança/falha), adaptador histórico (escopo/órfãos/truncamento), composição/autorização e PostgreSQL16. A suíte PG usa apenas loopback com banco terminado em `_governance_test`, URL explicitamente igual a DATABASE_URL e opt-in ALTAN_TESTE_POSTGRES=1. Dados com UUID/hash próprios; fixture writes fora da medição; portas aceitam somente findMany/findUnique; SQL medido deve ser SELECT; snapshots antes/depois devem coincidir. Concorrência usa segunda conexão exclusivamente no fixture, sem hook produtivo. Transportes fiscais/mensagens são proibidos por doubles.

Execução a cargo do Principal, a partir de apps/api, sem dotenv produtivo:

```text
node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/operations/domain/__tests__/elegibilidadeRecuperacaoDas448.test.js src/modules/operations/application/__tests__/avaliarElegibilidadeRecuperacaoDas448.test.js src/modules/guides/infrastructure/prisma/__tests__/leituraHistoricoDas448.test.js src/composition/__tests__/previaRecuperacaoDas448.autorizacao.test.js src/composition/__tests__/previaRecuperacaoDas448.postgres.test.js
```

## Validação consolidada pelo Principal — 15/11/2026

- Caracterização anterior: ensaios C1–C10 da etapa447 aprovados; 63 testes da projeção445 aprovados. Base ampla: 1.330 aprovados, 2 ignorados, 42 snapshots. Quatro suítes inicialmente recusaram o nome do banco descartável; os 19 casos passaram após configurar exatamente altan_piloto_governance_test, sem modificar suas guardas.
- Candidata: 89 testes novos aprovados em cinco suítes, incluindo PostgreSQL16, composição pública com guarda real, isolamento, dados sintéticos, SELECTs e snapshots antes/depois. Respostas são permitidas apenas após sessão e vínculo; INACTIVE/REMOVED/STAFF/CLIENT recusados e exceção admin preservada. Segunda conexão altera pagamento entre observações; bloqueio permanece, sem hook de escrita produtivo.
- Regressão ampla: 105 suítes aprovadas, 1.416 testes aprovados, 2 conflitos409 em cenários antigos de fechamento, 2 ignorados, 42 snapshots aprovados. Havia validações PostgreSQL paralelas no ambiente sintético. A suíte inteira de fechamento foi repetida isoladamente: 32/32 aprovados, sem alterar código ou teste legado. O resultado inicial permanece registrado; não se extrapola uma garantia de concorrência para outros escritores.
- Contratos HTTP do piloto25/25 e fechamento/concorrência PostgreSQL10/10 aprovados. Governança88/88 e verificador5/5 aprovados. Diagnose5023→5023, zero novas violações; modo diagnose preservado.
- Uma seleção inicial pelo texto448 também alcançou o nome absoluto da worktree e foi interrompida; a validação focal final usa runTestsByPath explícito. Um teste de paridade inicialmente comparava o instante entre consultas distintas; corrigido para comparar as evidências, preservando timestamps no DTO.
- Revisões independentes de Fiscal/SERPRO, Guias, Contabilidade (/root/dominios448), segurança/backend (/root/seguranca448), Operações/arquitetura (/root/operacoes448). Achados de tipo tributário, hash versus revisão, competência histórica, motivos específicos e resumo de fontes incorporados. Logs finais e CI serão vinculados no PR.

Controlador2026-11-15T14-21-03-566Z-cb9e009f: planejador e executor concluídos; executor relatou EPERM Node. Principal interrompeu durante testing para incorporar os pareceres independentes, preservando journal e evidências. Estado persistido testing; execução **interrompida, não ready_for_human**. Principal executou as validações indicadas sem modificar gates, papéis, regras ou permissões. Aprovação da CI não substitui conclusão formal do controlador nem autorização humana de integração.

## Arquivos e impacto

- Composição interna previaRecuperacaoDas448; application/domain e ponto público específicos de Operações.
- Adaptador Prisma e projeção histórica específicos de Guias. Sem repositório genérico ou ponto público sem consumidor.
- Cinco suítes novas; documentação448, índice e registro de governança. Workflow focal inclui as cinco suítes no PostgreSQL16 existente, sem ampliar permissões.
- Nenhum escritor, schema, migration, HTTP, UI, worker ou integração existente foi modificado. Projeções445/446 e proteção275 permanecem intactas.

A classificação positiva existe somente no contrato puro com provas completas sintéticas. A fronteira real não dispõe desses atestados e retorna BLOQUEADO/NAO_VERIFICAVEL. Qualquer futuro fornecedor de provas ou consumidor de recuperação exige entrega e revisão próprias; não basta reutilizar uma classificação antiga.

Rollback: remover somente os novos arquivos448 após decisão de integração; nenhum dado/migration a reverter. Não remover worktrees, branches ou evidências anteriores. Escritor de recuperação, reparação contábil, resolução de reservas, publicação e atos reais permanecem fora do escopo e dependem de autorização própria.
