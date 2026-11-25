# Apuração E2 — dependências de 2027, E1 e E3

Estado deste registro: planejamento verificável, sem aprovação funcional ou execução de testes. Autoridade: seção38 da referência operacional e autorização E2 de25/11/2026. Impacto operacional: nenhum; preserva bloqueios e explicita critérios pendentes. Não amplia escopo tributário nem autoriza produção.

## 2027

O seletor E2 está restrito a novembro/dezembro2026. A política B1 também conserva HOMOLOGACAO_2027_PENDENTE. A existência de série histórica válida, volume de custódia ou chave configurada não homologa uma competência futura.

| Dependência | Critério para incremento próprio | Evidência necessária |
| --- | --- | --- |
| Fonte oficial vigente | Conferir manual/versão, vigência e mudanças de exigência, janela e casos de abertura | Fonte oficial arquivada com data/hash e decisão delimitada, sem inferência pela continuidade de2026 |
| Contratos de simulação/entrega/consulta | Verificar serviço/versão/campos, remessa explícita, warnings e efeitos de cada operação | Matriz de contrato por cenário e homologação autorizada; consulta não presume prova causal |
| Política e revisão | Evoluir política versionada sem reinterpretar revisões/comandos históricos | Casos fronteira dezembro2026/janeiro2027, empresa nova, dados ausentes/zero e regime por vigência |
| Transporte e recuperação | Autorizar apenas combinações implementadas mantendo vínculo, guarda e custódia | T1/T2/T3a/T3b, concorrência, falhas, reinício e testes de não regressão nas competências2026 |
| Integração Operações | Reutilizar projeções e fluxo individual/lote, com motivo específico para não elegíveis | Navegador/API/banco, reload, isolamento, revisão obsoleta e permissões |
| Ativação concreta | Separar aprovação técnica de implantação e atos fiscais | SHA/CI, configuração de custódia/backup/chaves/volume, autorização concreta correspondente |

Não remover uma comparação de data ou ligar uma flag para apresentar2027 como homologado.

## Pendências E1 e responsabilidade E2

| Pendência | Etapa responsável | Critério e evidência para encerramento |
| --- | --- | --- |
| Cálculo em lote persistido | E2 Operações | Percurso API/PG real, empresas com sucesso/falha isolados, recarga completa e requestId/resultado persistido |
| Fator R e faturamento zero diretamente em Operações | E2 Fiscal/Operações | Formulário integrado; zero explícito distinto de ausente; revisão FS12; cálculo/apuração/transmissão pela mesma fonte |
| Simples com apuração externa | E2 Fiscal/Documentos | Evidência documental, origem externa explícita versus desconhecida, sem atribuição de autoria ou envio duplicado |
| Navegador/API/banco e reinício | E2 integrada | Login real sintético, infraestrutura real, fronteira fiscal simulada identificada, reload/restart e evidência por cenário |
| PostgreSQL antes ignorado | E2 dados e consumidores | Lista nominal das suítes realmente executadas e logs, sem transformar skip em aprovação |
| Provedor fiscal real | Homologação específica após autorização concreta | Cenários e permissões definidos, evidência real do provedor; simulação local não encerra esta linha |
| Permissões produtivas | Homologação específica após autorização concreta | Perfis/empresas/ações efetivos no ambiente autorizado; fixture de ACL local não encerra esta linha |

Todos permanecem pendentes até anexar prova real correspondente. Este documento não desloca entregas E2 para E3 por conveniência.

## E3 — efeitos completos de retificação

A E2 integra intenção, revisão, custódia, confirmação e pendências da retificação. A validação integral dos efeitos financeiros/contábeis permanece delimitada na E3 solicitada, preservando R25/R26 e histórico.

Critérios: declaração positiva e zerada; aumento e redução do tributo; DAS anterior pago; mês contábil fechado; retificações sucessivas; histórico de declarações/documentos/provisões/pagamentos; reconciliação da diferença sem duplicar cobrança, guia ou lançamento. Falha documental ou contábil deve conservar confirmação fiscal e produzir pendência própria vinculada à declaração. Não reabrir mês fechado, estornar pagamento ou apagar evidência por inferência.

Antes da implementação E3, conferir contratos vigentes, fontes de pagamento, provisões e políticas de fechamento; registrar decisões pendentes sem inventá-las. A evidência exigida inclui banco real sintético, concorrência/idempotência, regressão de Guias/Contabilidade e revisão independente. Nenhuma autorização real de retificação, cobrança ou publicação decorre deste plano.

## Incorporação completa — rodada 0 de 25/11/2026

Base de trabalho `fc48a3b5183976a7a8420ad422405622ca78e395`, descendente da E1 `3bb3f0bba27678268fc42a8be00637ab21b97d9a`. Foram incorporados os 103 caminhos não protegidos do inventário `.altan-governance/integration-overlay-expanded.json`, SHA256 `a42b33c16ecf7911d5225c499ceb3faf119479ea81e4300ee3cfe98a730c10ed`. Os 26 manifests e as 106 fontes tiveram seus hashes conferidos; os três destinos protegidos já estavam idênticos e não foram editados. Este complemento documental é posterior à aplicação do inventário e deve integrar a revisão final. Após a conferência dos hashes, foram removidas somente linhas vazias excedentes no fim de `PgdasSimulacaoService.js`, `FechamentoService.js`, `publicFs12.js` e `routes/firm/apuracaoV2.js`, apontadas por `git diff --check`; a nova execução terminou com exit 0. Esses quatro arquivos e este documento têm hashes finais diferentes dos candidatos, sem alteração funcional adicional pelo executor.

Fiscal é dono dos comandos, revisão FS12, interpretação e promoção da resposta; infraestrutura implementa reserva, cifra, stage e persistência. Operações coordena as ações e consome as mesmas operações da Apuração. Rotas autenticam o ator e delimitam empresa/competência. Guias e Contabilidade continuam consumidores distintos da confirmação fiscal; falhas posteriores não devem apagá-la. O schema acrescenta quatro modelos e relações, sem substituir modelos históricos. Preservam-se R01/R02/R04–R06/R19–R22/R25/R26, os limites de 2027 e a separação entre confirmação da folha, cálculo, conferência e transmissão. Compatibilidade efetiva depende das provas abaixo e das regressões dos consumidores.

O executor desta rodada está limitado a leitura e edição. Não executou testes, builds, imports da aplicação, Prisma, banco, navegador ou processos de fundo. A incorporação não é aprovação técnica. O registro `apuracao-e2-persistencia.json` descreve historicamente a preparação da fundação; seus comandos, limitações de escopo e resultados não são resultados desta rodada completa.

### Matriz nominal de aceite

Cada ID abaixo identifica um caso preparado em `apps/api/scripts/fs12-operations-e2e/cases.json`, com preparação própria para novembro e dezembro. A existência do caso não comprova execução. Estado de **todas** as linhas nesta rodada: **prova renovada pendente**. O Principal deve anexar resultado, fingerprint da fonte, competência e caminho de evidência por linha após a janela complementar, conservando falhas anteriores.

| ID | Caso identificado | Prova necessária para encerramento |
| --- | --- | --- |
| T156.1 | Histórico completo | Série confirmada, revisão e envelope correlacionados no fluxo real local |
| T156.2 | Histórico parcial | Lacunas recusadas sem zero inferido; complemento explícito persistido |
| T156.3 | Histórico ausente | Ausência visível e bloqueio até evidência completa |
| T156.4 | Empresa recém-constituída | Janela de abertura válida sem RBT anterior inventado; empresa antiga com regime tardio recusada |
| T156.5 | Sem folha | Declaração explícita e autoria, distinta de ausência de informação |
| T156.6 | Valores zero | Zeros na série, envelope, B32/B33 e recarga; `accept-calculation-http.mjs` prepara aceite HTTP/PG específico, ainda não executado nesta rodada |
| T156.7 | Sujeita ao Fator R | Folha e revisão vinculadas; percurso diretamente em Operações |
| T156.8 | Não sujeita ao Fator R | Série declaratória avaliada sem dispensa presumida |
| T157.1 | Divergência local/fiscal | Conflito e evidências preservados; fixtures MSG029/030 não comprovam MSG035/071 |
| T157.2 | Folha alterada após cálculo | Nova confirmação invalida autorização anterior sem despacho |
| T157.3 | Receita alterada após cálculo | Alteração real local impede uso do cálculo antigo |
| T157.4 | Revisão alterada antes de transmitir | Revalidação concorrente antes do marcador impede saída incompatível |
| T158.1 | Retorno tardio | Custódia na revisão de origem e recusa de promoção incompatível |
| T158.2 | Transmissão interrompida | Reinício real da API, recarga e conciliação sem retransmissão desconhecida |
| T159.1 | Processamento simultâneo | Dois processos independentes, mesma identidade e uma reserva/despacho |
| T159.2 | Lote com falhas parciais | Sucesso, rejeição e incerteza isolados e persistidos após recarga |
| T160 | Retificação FS12 | Intenção, reabertura motivada, revisão e custódia preservadas; E3 permanece aberta |
| T161 | Integração e regressão | Navegador/API/PG reais sintéticos, desktop/celular, ACL, rollback, reload/restart e catálogo integral original |
| T162 | Pendências E1 | Evidência por pendência da tabela acima; homologação real e permissões produtivas continuam separadas |

Ensaios complementares preparados: `apps/api/scripts/fs12-runtime/runtime.postgres.test.mjs` (T3b, rollback, revisão e processos), `apps/api/scripts/fs12-runtime/intent.postgres.test.mjs` (recuperação versus encerramento explícito), `apps/api/scripts/fs12-runtime-barrier/barrier.postgres.test.mjs` (barreira entre processos), `apps/api/scripts/fs12-stage-recovery/stage.postgres.test.mjs` (stage, rollback SQL e importação em outro processo). São provas de componentes quando executadas nesses limites; não substituem API completa/navegador. `PROCESS_RESTART_ONLY` no Windows não prova pane de SO/energia. A fronteira fiscal local é simulada; selfcheck do processo auxiliar não atesta sozinho o preload da API. Exigir bloqueio comprovado antes do certificado sintético e preservar a distinção entre resposta observada e prova causal. O procedimento manual autorizado/auditado para resultado inconclusivo precisa de evidência própria, sem transformar ausência em índice em liberação.

### Evidências históricas preservadas e passagem ao Principal

Os registros ignorados abaixo pertencem à tentativa anterior, não aprovam esta fonte e não devem ser somados como gate integral:

- `.altan-governance/e2-validation/summary-current.json`: estado `SUPPLEMENTARY_IN_PROGRESS_NOT_APPROVED`, fingerprint anterior `9f5483d69d65f8435168e8346490f03682b1732528919c3ade4cfbedae33920a`.
- `.altan-governance/e2-validation/postgres-fiscal-results.json`, `api-changed-focal.json`, `web-changed-focal.json` e `foundation-ddl.log`, no mesmo diretório: resultados anteriores com falhas, exigindo renovação após as correções preparadas.
- `.altan-governance/e2-validation/consumers-postgres.json`, `unit-process.log`, `postgres-runtime.log` e `postgres-transport-coordination.log`, no mesmo diretório: resultados parciais anteriores, sem aprovação transferida.
- `.altan-governance/e2e-evidence/e2-20261125-256d2053/transport-selfcheck.json`: selfcheck histórico, não prova do processo API desta rodada.
- `.altan-governance/runs/2026-11-25T13-51-45-207Z-dc81e8d8/`: tentativa interrompida antes dos gates originais; nenhum gate dispensado.

O Principal executa as provas complementares e o catálogo original nos limites originais, em PG16 loopback54661 próprio, sem reset de evidência anterior; os bancos com guards específicos continuam separados. Revisões independentes de domínio/técnicas e sistêmica, PR/SHA/CI e atualização desta matriz continuam pendentes. Não declarar `ready_for_human` por incorporação ou parecer estático.

Rollback: antes de aplicar migração, retirar somente o delta coordenado de código; após persistência, conservar tabelas aditivas, triggers imutáveis, stage cifrado, chaves históricas, reservas e vínculos. Não apagar evidências, editar checksums ou repetir efeito desconhecido para recuperar o serviço. Nenhuma migração foi executada por este delegado.
