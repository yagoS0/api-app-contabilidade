# PGDAS-2026-B3.2 — FS12, cálculo e evidência histórica

Base: `2a2d350776beaf47317a6679b111f84b85fc3971`. Branch: `codex/pgdas-fs12-calculo-b32-20261117`. Aprovação da extensão aditiva: [coordenação do PR295](https://github.com/yagoS0/api-app-contabilidade/pull/295#issuecomment-6949257330). Desenvolvimento e banco descartável somente. Integração, publicação, migração produtiva e B3.3 dependem de autorização separada.

## Durabilidade caracterizada

`FechamentoService` substitui `ApuracaoSnapshot.idempotencyKey` e `_portalCalculo` ao recalcular. A reabertura preserva o snapshot anterior em auditoria na mesma transação, mas essa proteção não cobre toda substituição de cálculo. Um novo cálculo pode coexistir com o número da declaração anterior. Isso não comprova que a declaração usou o novo cálculo.

`PgdasHistoricoService` conserva versões documentais, não a relação causal com o cálculo/FS12. O ledger `SerproChamada` registra consumo e resultados técnicos, não essa relação fiscal. Não inferir associação por valor, número coincidente, PDF ou estado `transmitida`. Histórico sem vínculo permanece **DESCONHECIDO**.

## Fronteiras e contratos

Fiscal/Apuração é dono das duas estruturas novas. B1 decide janela e completude; B3.1 continua dono da confirmação manual autenticada. Aplicação coordena portas específicas; a composição injeta o validador legado de cálculo e o adaptador Prisma. Nenhum domínio importa Prisma, Express ou transporte.

| Operação interna | Garantia |
| --- | --- |
| `prepararFs12ParaNovoCalculo` | Resolve Company pelo PortalClient autorizado; lê contexto e última revisão; verifica série, política e hashes. Não libera transporte. |
| `vincularFs12AoCalculo` | Lê e valida o cálculo no servidor; exige referência FS12 explícita no cálculo, revisão/contexto atuais e unicidade. Não aceita snapshot enviado pelo navegador nem adiciona folha retroativamente a token antigo. |
| `consultarVinculoFs12DoCalculo` | Leitura histórica escopada à Company atual, independente do snapshot ou revisão corrente. Não escreve nem promove histórico a autorização. |
| `validarUsoFs12DoCalculo` | Reconfere acesso, contexto, última revisão e cálculo corrente; revisão substituída não autoriza novo ato. |
| `registrarFatoCalculoFs12` | Comando interno, sem rota pública; exige fato correlacionado lido por porta confiável. String, hash e alegação do navegador não são prova oficial. |

O adaptador de evidência fiscal padrão retorna ausência. Portanto, **não se registram tentativas/resultados fictícios neste B3.2**. Sua ligação ao transporte oficial permanece no B3.3. Também não se produzem novos cálculos oficiais de novembro/dezembro para alimentar a tabela: o bloqueio B3.3 é obrigatório. Os contratos de escrita são exercitados com cálculos sintéticos explícitos, sem backfill, e ficam disponíveis para a integração posterior autorizada.

Novo GET autenticado: `/firm/companies/:companyId/fechamento/:competencia/fs12/calculos/:calculoId`. Retorna `VINCULADO` ou `DESCONHECIDO`, vínculo quando existente e `autorizaEfeitoFiscal:false`; `Cache-Control:no-store`. Usa ACL canônica ACCOUNTANT e revalidação transacional. Nenhuma rota permite criar vínculo ou declarar resultado fiscal pelo navegador. Contratos anteriores mantêm campos; erros FS12 dos comandos recebem status explícito.

## Persistência aditiva

Migração `20261117000000_add_apuracao_fs12_calculos`:

- `apuracao_fs12_calculos`: empresa/PortalClient/PA, `calculoId` único, revisão FS12, contexto/política, `_portalCalculo` congelado e hash. FK composta para a confirmação B3.1, sem FK ao token mutável do snapshot. Não duplica PDF ou série mensal; não captura o número declaratório antigo do snapshot.
- `apuracao_fs12_calculo_fatos`: vínculo, tentativa, tipo, chave idempotente, origem/referência probatória, número/versão documental somente quando comprovados e instante servidor. Resultado requer tentativa do mesmo vínculo. Triggers impedem UPDATE/DELETE nas duas tabelas e validam identidade.

Estado operacional continua exclusivamente nos snapshots, reservas, leases e ledgers existentes. Ausência de fato significa ausência de evidência; não é dispensa fiscal. `TENTATIVA_INICIADA` representa fato local anterior ao despacho, não confirmação de recebimento remoto. `RESULTADO_INCERTO` não permite redespacho; confirmação/conciliação exige evidência oficial correlacionada. Não há retry, fila ou nova máquina de estados.

As operações aceitam o mesmo `tx` do coordenador para rollback conjunto, sem transação aberta durante HTTP. Escritas próprias usam Serializable; leituras usam RepeatableRead. Replay idêntico não duplica; conflito de revisão/identidade é recusado. Repetir vinculação depois de substituir revisão ou snapshot não reatribui o cálculo: consulta histórica permanece disponível.

## Matriz de caminhos e bloqueios

| Entrada | Até PA10/2026 | PA11/12/2026 | 2027 |
| --- | --- | --- | --- |
| Calcular no fechamento manual | Comportamento legado | Recuperação íntegra preservada; novo cálculo verifica confirmação e é bloqueado por B3.3 mesmo válida | Recuperação histórica preservada; novo despacho bloqueado por homologação pendente |
| Salvar/confirmar cálculo | Comportamento legado | Exige vínculo/revisão atual; permanece bloqueado antes de CAS até B3.3 | Bloqueado |
| Transmitir/retificar fechamento | Comportamento legado | Índice/conciliação permanecem; novo despacho recusado antes de marcar envio iniciado | Novo despacho recusado |
| Operações: prévia/cálculo | Comportamento legado | Motivo explícito na prévia; nenhuma coleta/reserva nova para simulação incompatível | Bloqueado |
| Operações: confirmar/liberar | Comportamento legado | Cálculo não transmitido tem impedimento; histórico documental mantém caminho | Mesmo limite |
| Lote/worker de execução | Guardas existentes | Herda serviços e limite final de transporte; nenhuma exceção por usuário, lote ou `forcar` | Bloqueado |
| Ciclo automático de coleta/cálculo | Comportamento legado | Recusa antes de nova reserva/coleta; tentativa anterior incerta retorna sem repetição | Bloqueado |
| `PgdasSimulacaoService`/script direto | Comportamento legado | Recusa antes de builder/despacho, inclusive transporte injetado | Bloqueado |
| `SerproHttpClient` direto | Comportamento legado com PA válido | Recusa TRANSDECLARACAO11 antes de cache/custo/auth/HTTP | Bloqueado |
| Assinaturas locais/períodos recusados | Preservado | Construção/hash continuam locais e permitidos | Sem despacho |
| Consultas de índice, documentos, DAS e histórico | Preservado | Não confundidos com novo `/Declarar` | Sem liberação implícita de declaração |

A guarda final usa serviço/envelope, não um booleano do chamador. `pa` e `_periodoApuracao` divergentes ou inválidos são recusados; o campo legado isolado válido permanece compatível. Payload, seleção de `folhasSalario`, Fator R, anexos e regime não foram modificados.

## Validação e limitações

Referência antes da alteração: 86 testes de contratos/recuperação e 26 HTTP/PostgreSQL B3/B3.1 aprovados. A mesma suíte de 86 passou após a mudança, com expectativas explicitamente alteradas apenas para os bloqueios temporais aprovados. Não chamar essa mudança intencional de paridade fiscal completa: até outubro permanece legado; novembro/dezembro antes despachavam nos doubles e agora são recusados.

Testes novos exercitam PA10/11/12/2027, ausência/zero/revisão substituída, contexto, isolamento e revogação, duas conexões, rollback conjunto, imutabilidade, idempotência, leitura após substituição e tentativa/resultado separados. Transporte e evidências oficiais são doubles; não houve ato fiscal. Resultados finais, pareceres e CI ficam no registro de governança e no PR no SHA correspondente.

O controlador `2026-11-17T13-46-04-903Z-853ba6cc` terminou `escalated`: executor bloqueado por EPERM em `lstat C:\Users\yagoa`, sem alterações. Principal e agentes nativos continuaram a implementação e as verificações autorizadas sem modificar permissões/gates. Não há `ready_for_human` do controlador.

Riscos que permanecem: confirmação manual não autentica folha externa; SHA não é assinatura; registros antigos continuam sem associação causal comprovada; persistência de um resultado remoto não é transação distribuída. Antes de retirar bloqueios no B3.3, revalidação FS12 e CAS devem usar a mesma transação e ser testados contra substituição concorrente; leitura validada isolada não concede autorização durável. A futura porta probatória precisa correlacionar a resposta real à tentativa exata, inclusive perda de resposta e conciliação. Nenhuma seleção de meses/remessa ou homologação2027 foi antecipada.

## Rollback e integração

Reverter a entrega não deve apagar tabelas/revisões/fatos ou tentar desfazer atos fiscais. Como o código anterior não possui o bloqueio global, rollback de código **não é estratégia segura para reabrir despacho afetado**: manter a guarda ou suspender os comandos antes de reverter o restante. Preservar migração aditiva e histórico; não executar DROP, backfill ou retificação. Implantação/migração produtiva exigem plano e autorização próprios.

Critérios de integração: revisão humana do diff e contrato; testes focais/PG16 e regressões relevantes; zero novas violações em diagnose; pareceres independentes; checks hospedados no SHA final. Esta entrega permanece draft e não autoriza merge, deploy, reativação do Railway ou B3.3.
