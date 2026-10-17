# Baixa pelo cliente e correção de mês fechado

## Decisão e escopo

Em 16/10/2026, o usuário aprovou baixa direta após confirmação explícita do cliente, preservando o log, e a ação de correção de mês fechado com reabertura somente contábil. A referência operacional seção 21 (R25/R26 e T22–T30) substitui a proposta anterior V04. Não é autorização para executar baixas reais, enviar mensagens ou publicar esta versão.

O registro preserva quem declarou, canal, empresa, guia, revisão, valor e data informada. Trata-se de evidência da declaração do cliente; não de comprovante bancário ou confirmação da Receita. Confirmações legadas não recebem baixa retroativa em massa.

## Contrato implementado neste incremento

- Confirmação autenticada no portal e WhatsApp passa por serviço comum. Evidência imutável e estado de execução têm identidades separadas.
- Botões WhatsApp guardam a versão integral da guia na emissão. Documento ou composição alterados, inclusive com PDF idêntico, exigem confirmação atualizada. Tokens antigos sem versão não autorizam baixa nova.
- A baixa usa a data declarada e a composição confiável da guia, com principal, juros e multa separados. A confirmação não autoriza inventar contas ou composição ausente.
- Falha contábil, dados incompletos ou mês fechado conservam a confirmação com pendência retomável por identificador. Baixa concluída só é anunciada quando seus lançamentos persistem e correspondem ao principal, juros, multa e total confirmados. Divergência da composição do parcelamento impede a baixa inteira.
- Se corrigir a guia mudar sua revisão, o cliente confirma explicitamente os dados atuais. A nova declaração referencia a anterior, que permanece imutável; seu estado de execução fica substituído e não pode gerar baixa. Não se reaproveita consentimento para valores alterados, nem se convertem confirmações legadas ou baixas estornadas.
- Na contabilidade, reabrir com motivo, retomar a baixa enquanto o mês estiver aberto e depois conferir/fechar. Uma retomada concluída atualiza os lançamentos, totais, checklist e avisos da mesma empresa/competência.
- Ação “Corrigir mês fechado” exige motivo, permissão e revisão atual. Reabre apenas a contabilidade, invalida a conferência anterior e conserva snapshot anterior. Nova conferência resolve a ocorrência, preservando o histórico.
- Avisos em Contabilidade/Lançamentos identificam a competência e mostram ação e histórico. Estado financeiro, origem da confirmação e execução da baixa continuam distintos.

## Persistência e compatibilidade

Usa AppSetting com namespaces específicos, eventos somente por inserção e estado operacional separado. Não há alteração de schema nem migração de dados. Eventos não possuem expiração ou vínculo em cascata com a entidade operacional. Rotas de leitura/retomada exigem autorização e empresa correspondente.

A árvore isolada parte da versão anteriormente validada, com checkpoint local de regras aprovadas. Alterações anteriores do dev permanecem preservadas. As demais lacunas da auditoria do ciclo Simples Nacional não são declaradas resolvidas por este incremento.

## Validação

O registro executável do Orquestrador é a fonte de resultados, fingerprints, gates e revisões. Não tratar esta seção como aprovação técnica enquanto o estado não for `ready_for_human`.

O ensaio `apps/api/scripts/verify-pagamento-cliente-correcao-contabil-postgres.mjs` exige banco PostgreSQL descartável em loopback, desliga integrações e usa dados fictícios. Usa schema atual e reproduz índices parciais das migrations para verificar concorrência e rollback real. Não equivale a homologação de integrações externas ou implantação de migrations.

Critérios: duplicidade/concorrência, isolamento entre empresas e guias, mudança de revisão, legados, composição de encargos, mês fechado, falha na auditoria, nova conferência e atualização dos avisos; testes do portal/escritório e revisão visual desktop/mobile.

O ensaio PostgreSQL cobre DAS, divergência e retomada de parcelamento, reconfirmação concorrente e invalidação de checklist após alteração legada, além de o handler WhatsApp sem transporte externo e as rotas contábeis com sessão sintética. Não valida login real, entrega de mensagens nem a cadeia completa de migrations. Os adaptadores INSS e parcelamento possuem testes direcionados separados. A interface é inspecionada em modo demonstrativo, com dados fictícios, no Chrome local em larguras de 1440 e 390 pixels. A reconfirmação visual usa respostas sintéticas em memória; sua persistência e concorrência são verificadas separadamente pelo ensaio PostgreSQL.

A revisão independente reprovou a ausência de invalidação do checklist após baixa INSS/parcelamento durante correção. O executor corrigiu o ramo e acrescentou regressões antes da aprovação final. A rodada seguinte reprovou divergência entre guia e composição efetiva de parcela, origem contábil incorreta, recuperação de guia corrigida, orientação/atualização visual e reaproveitamento de checklist por produtores legados. Os pareceres e correções permanecem registrados no controlador. A revisão entre domínios também identificou que o adaptador real do portal descartava campos de confirmação: seu transporte e teste de JSON serializado foram incluídos no plano seguinte.

Validações anteriores aos gates finais: 16 cenários PostgreSQL aprovados; lint oficial do escritório com 1082 arquivos e zero erros/avisos; ciclo visual de correção e reconferência em desktop/mobile, oito capturas, recarga e nenhuma exceção de página. Evidências locais em `.altan-governance/decisoes/`. Esses resultados não substituem os gates completos e juízes do controlador.

Durante uma correção aberta, cada marca de conferência corresponde ao conteúdo atual dos lançamentos e linhas. Qualquer mudança desse conteúdo, inclusive por produtor legado sem evento individual, invalida as marcas efetivas e impede o fechamento até reconferência; obter um token atualizado não valida marcas antigas.

O histórico conserva snapshots completos na abertura e conclusão da correção; criação, edição, exclusão e baixas instrumentadas possuem eventos próprios. Isso não equivale a auditoria individual de todos os produtores legados do sistema. A identidade de quem abriu/concluiu e a comparação final permanecem registradas; ampliar rastreamento individual de produtores legados exige outro incremento.

## Rastreabilidade da revisão

A execução `2026-10-17T02-44-34-726Z-5ee2bfa0` registrou gates aprovados e reprovações independentes, encaminhando os achados ao executor. O bloqueio adicional no transporte do portal exigiu ampliar o plano de 68 para 70 arquivos. O controlador foi interrompido explicitamente para replanejamento, conservando pareceres, fontes e evidências; não recebeu aprovação simulada. A execução `2026-10-17T03-56-27-990Z-647f593c` parte do mesmo baseline original e verifica integralmente as alterações reaplicadas mais a correção do transporte. O estado desta última execução determina a aprovação técnica.
