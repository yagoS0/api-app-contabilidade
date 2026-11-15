# DAS/SERPRO — avaliação documental da recuperação local 4.4.7

## Estado, base e limites

Avaliação consolidada em 15/11/2026 (America/Sao_Paulo), base `0d3c2f0cd136246cfad6cb8f67f2dd1802efd878`. Principal confirmou origin/main e main publicada nesse SHA e o squash merge do PR #283 via GitHub. Branch `docs/ddd-serpro-das-recuperacao-avaliacao-447`, worktree exclusiva `worktrees/ddd-serpro-das-recuperacao-avaliacao-447-20261115`, conforme AMBIENTE.md; árvores/branches anteriores preservadas. O executor do controlador produziu a investigação documental inicial; o Principal consolidou lacunas, testes sintéticos e evidências com revisores independentes.

**Não há implementação de recuperação nem de prévia. Elegível significa potencial para elaborar uma proposta, nunca autorização de escrita.** As condições futuras abaixo são propostas técnicas, não novas políticas operacionais aprovadas. Nenhum caso real foi classificado.

Foram consultados o snapshot operacional completo fornecido na tarefa, AGENTS.md, CLAUDE.md e instruções pertinentes, a política e a arquitetura do repositório, além das etapas [4.4.4](serpro-das-recuperacao-conciliacao-444.md), [4.4.5](serpro-das-conciliacao-leitura-445.md) e [4.4.6](serpro-das-pendencias-446.md). O hash da fonte operacional indicada em `worktrees/altan-regras-operacionais/REGRAS_OPERACIONAIS.md` foi conferido: `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`, igual ao snapshot informado. Decisões operacionais posteriores prevalecem sobre descrições históricas de módulos.

Documentação sem impacto operacional: preserva R01/R02 (identidade e incerteza), R04–R06 (reabertura e efeitos independentes), R10–R12/R16 (documento, envio e pagamento), R19/R20 (evidência persistida, revisão e repetição) e R25/R26 (confirmação do cliente e proteção contábil). Não decide matriz fiscal nem pendências de negócio.

O diff final contém documentação, registro de impacto e ensaio sintético sob docs; não modifica código produtivo, testes preexistentes, schema, migrations, contratos HTTP, UI, CI, controlador, políticas, proteção #275 ou comportamento de GERARDAS12/GERARDASCOBRANCA17. Não executa consulta fiscal, retry, recuperação, prévia, limpeza, pagamento, contabilidade, worker, mensagem, publicação ou alteração de permissões. Não lê `.env`, credenciais, banco ou documentos reais. As validações realizadas pelo Principal estão discriminadas no encerramento, separadas das evidências históricas e dos testes futuros ainda necessários.

## Evidências e leitura do estado atual

As referências de código abaixo são relativas a `apps/api/src/` e foram inspecionadas estaticamente na base. Resultados históricos descritos em 444/445/446 pertencem àquelas entregas, não são testes reexecutados em 447.

| Fonte | Constatação e consequência para a avaliação |
| --- | --- |
| `composition/conciliacaoDas445.js`; `modules/operations/application/consultarConciliacaoDas445.js` | Consulta interna com capacidades de leitura e autorização anterior às fontes. Observações independentes, sem snapshot global; falhas produzem `items:null`; limite 1–100, padrão 50. Não fornece decisão de escrita. |
| `infrastructure/security/autorizarLeituraConciliacaoDas445.js` | Reutiliza FIRM e `requireFirmCompanyAccess({minRole:'ACCOUNTANT'})`; sessão separada da entrada. Não confundir acesso à carteira moderna com autorização desta leitura. |
| `modules/fiscal/infrastructure/prisma/leituraConciliacaoDas445.js` | Ledger escopado por empresa, competência, PGDASD e serviço; cache somente pelas assinaturas selecionadas; despacho confere empresa/reserva. Ausência no recorte não prova ausência global. |
| `modules/fiscal/domain/evidenciasConciliacaoDas445.js` | Interpreta cache com `contribuinteCnpj:null`; vigência é comparação do TTL, não certificação de identidade/conteúdo. Reserva pendente mantém incerteza mesmo com cache. |
| `modules/guides/infrastructure/prisma/leituraConciliacaoDas445.js`; `modules/guides/domain/evidenciasConciliacaoDas445.js` | Exclui parcelamentos e prefixo PARC-, admite upload e sourceFileId nulo. Serviço não restringe guias mensais. PDF é presença/referência com `conteudoVerificado:false`; versão de pagamento não é token de correção. |
| `modules/accounting/infrastructure/prisma/leituraConciliacaoDas445.js`; `modules/accounting/domain/evidenciasConciliacaoDas445.js` | Circular e lançamentos têm leitura própria. Candidatos DAS sem sourceGuideId não provam associação; linhas podem truncar; fechamento bloqueia dimensão contábil, não a leitura. |
| `application/fiscal/serpro/SerproHttpClient.js` | Lê cache antes de autorizar nova reserva; guarda resposta antes de finalizar ledger. Falha entre esses passos pode conservar evidência parcial. Chamar o cliente não é uma capacidade exclusivamente local: cache ausente pode alcançar rede. |
| `application/fiscal/serpro/SerproRespostaCache.js` | TTL de uma hora; gravação usa upsert por hash e limpa expirados best-effort. `lerResposta` pode apagar cache com contexto atualizar. Não serve como leitor read-only da futura prévia. Guarda especial da simulação TRANSDECLARACAO11 não deve ser generalizada aos dois serviços DAS. |
| `modules/fiscal/application/persistirDocumentoDas.js`; `composition/persistenciaDocumentoDas.js` | Funil existente escreve Guide por serviço legado, preserva campos de pagamento selecionados e atribui datas de captura. Não é operação de prévia nem prova de auditoria atômica de recuperação. Reaplicá-lo sem desenho específico poderia atribuir uma consulta recente a evidência antiga. |
| `application/guides/atualizarGuiaComEvidencia.js` | CAS por updatedAt, com releitura/mesclagem até quatro tentativas. Evita determinadas perdas concorrentes na guia; não une guia, circular, ledger, auditoria e contabilidade em uma transação global. |
| `modules/fiscal/infrastructure/prisma/circularDasCapturado.js`; `modules/accounting/application/contabilizarDasCapturado.js` | Captura separa documento, circular, acréscimos e gerador. Modo somenteDocumentos lê circular e pula geração; modo completo pode persistir fatos antes de erro contábil. Reexecutar captura completa não é recuperação documental isolada. |
| Documentos 444/445/446 | Caracterizam reutilização sem reparo contábil, limpeza legada que não filtra PAID, leases distintos de reservas fiscais, limites de logs e consulta operacional sem comandos. Essas caracterizações não comprovam incidência em dados reais. |

## Donos, consumidores e compatibilidade

O domínio direto desta entrega é documentation. Os contextos abaixo são afetados apenas pela análise de um contrato futuro; nenhuma API pública ou dependência muda nesta etapa.

| Contexto dono | Fato sob sua responsabilidade | Consumidores preservados e fronteira futura |
| --- | --- | --- |
| Fiscal/SERPRO | Interpretação da resposta, serviço e evidência fiscal | Captura, ledger/cache e Operações; sem alteração de transporte, TTL, reserva, consulta ou interpretação dos serviços. |
| Guias/Documentos | Identidade, conteúdo, revisão e custódia documental | Guias, projeções, envio, tracking e pagamentos; documento local não comprova envio/pagamento. Futuro comando deve preservar histórico e vínculos. |
| Contabilidade | Provisão, composição, baixa, exportação e fechamento | Razão, circular e Lançamentos; recuperação documental não gera lançamento nem reabre mês. Campos compartilhados da circular não transferem autoridade entre domínios. |
| Operações | Coordenação e apresentação de observações | Consulta 445, apresentador e modal 446, execução manual e workers atuais; sem novos botões, estados de conclusão ou chamadas automáticas. |
| Identidade e Acesso | Sessão, papel, vínculo vigente e escopo empresarial | Mantém #275 e guarda 445. Nenhuma permissão nova por existência de cache, guia ou acesso à carteira. |
| Comunicação | Reserva/envio e evidência da revisão entregue | Nenhum envio, recibo, acompanhamento ou consentimento é criado pela recuperação local proposta. |

## Matriz de elegibilidade para proposta

Classificar a **operação pretendida**, não a empresa inteira. Elegível é condicional à comprovação de todos os requisitos do caso; Bloqueado indica impedimento conhecido; Não verificável indica evidência insuficiente. A leitura pode continuar autorizada mesmo quando uma escrita futura estaria bloqueada. Impedimento conhecido não desaparece por falha de outra fonte: conservar ambos os motivos.

| Caso observado ou sintético | Classificação da futura proposta local | Motivo e destino |
| --- | --- | --- |
| Resposta local íntegra, vigente, identidade integral comprovada, ausência documental comprovada, autorização atual e fontes completas/coerentes, sem conflito ou reserva pendente | Elegível, condicional | Pode fundamentar proposta limitada a materialização documental. Nenhuma escrita autorizada; 445 sozinho não fornece todas essas provas. |
| Documento já existe com a mesma identidade, revisão e conteúdo comprovados | Elegível para conclusão sem alteração | Proposta deve indicar ausência de efeito necessário. Não atualizar datas, inserir outra guia ou reparar contabilidade por consequência. |
| Cache presente e guia não encontrada no recorte, sem prova de identidade/conteúdo/completude | Não verificável | Cache e ausência no recorte não bastam. Identificar correlação e universo documental antes de propor materialização. |
| Cache expirado, ausente ou órfão; ledger legado sem correlação segura | Não verificável | Não estender TTL, varrer globalmente, reconstruir resposta ou buscar no provedor. Evidência expirada permanece histórica, sem elegibilidade automática. |
| Reserva reservada/incerta com ou sem cache/PDF | Bloqueado para proposta executável no recorte conservador inicial | Manter análise descritiva; resolução da reserva é trilha separada. Cache não a resolve e não autoriza retry, finalização ou novo despacho. |
| Guia sem circular, com identidade documental comprovada | Elegível apenas para proposta de investigação da lacuna fiscal | Não há documento faltante a recriar. Reconstituição de campos fiscais da circular exige incremento próprio e análise de consumidores; não chamar gerador. |
| Circular sem provisão ou captura com accounting.ok:false | Bloqueado para reparação pela recuperação documental | Encaminhar para conferência contábil independente. Ausência de provisão exige leitura completa; log completed não resolve. |
| Guia reutilizada, DTO contábil vazio ou entriesGenerated:0 | Não verificável quanto à contabilidade | Reutilização comprova somente o fato local identificado. Não inventar sucesso, falha ou ausência de provisão. |
| Competência contábil fechada | Bloqueado para alteração contábil; proposta documental dependente de impacto ainda não verificável | Consulta permitida. Primeiro recorte conservador não propõe escrita que afete valores/revisões da competência fechada; R26 não pode ser executada implicitamente. |
| Guia paga, confirmação de cliente, comprovante, baixa ou exportação vinculada | Bloqueado para substituição/limpeza no recorte inicial | Preservar R25/R26 e referências. Pode-se descrever o estado; avaliar substituição requer contrato e revisão próprios, sem migrar evidência para nova revisão. |
| Múltiplas guias/revisões, divergência de hash/valor/número ou vínculo contábil ambíguo | Não verificável; conflito identificado bloqueia alteração | Não escolher simplesmente a mais recente, combinar valores ou excluir duplicatas presumidas. |
| Parcela, acordo ou prefixo PARC- | Bloqueado neste escopo DAS mensal | Identidade e obrigação distintas. Nem mesmo tipo SIMPLES autoriza incorporar à recuperação mensal. |
| Empresa, competência, serviço, documento ou conteúdo comprovadamente divergente | Bloqueado | Não corrigir identidade por inferência; DAS normal e cobrança não são intercambiáveis. |
| PDF apenas referenciado, bytes não validados ou composição ausente | Não verificável | Presença não demonstra integridade nem principal/juros/multa. Não inventar valores ou efetuar download externo. |
| Fonte falhou, limite/linhas truncados ou versões mudaram durante leitura | Não verificável | Não converter falha em ausência, zero ou unicidade. Nova análise local exigirá escopo autorizado e evidência completa. |
| Resposta fiscal negativa identificada | Bloqueado para fabricar guia; fato fiscal limitado à resposta | Não tratar erro/PDF ausente como dispensa. Ausência legítima não pede recuperação documental inexistente. |
| Sessão ausente, conta cliente, vínculo/papel insuficiente ou revogado | Bloqueado antes da leitura | Recusa fatal, sem expor evidências. Exceção admin é somente a já existente. |

Nenhuma linha concede elegibilidade a registros reais nesta entrega. Para o primeiro incremento futuro, escolher materialização de documento ausente é uma delimitação técnica sugerida, não autorização nem política definitiva de substituição.

## Mapa de dados e lacunas

| Dado necessário | Disponível na leitura atual | Lacuna para uma proposta segura |
| --- | --- | --- |
| Empresa, competência fiscal e autorização | Entrada normalizada e guarda por empresa | Company e PortalClient não podem ser confundidos. Comprovar identidade integral da resposta/documento, sem usar vencimento como competência. |
| Serviço, tentativa, assinatura e despacho | Ledger e marcador local escopados | Hash de envelope não é recibo, prova de cobrança nem vínculo inequívoco de documento. Sem chamada correlacionável, cache órfão não é descoberto. |
| Resposta e validade | Cache interpretado e expiraEm | DTO omite resposta bruta; mesma chave pode receber upsert. Exigir fingerprint do conteúdo observado e origem temporal, não apenas assinatura/TTL. |
| PDF, hash e custódia | Presença de bytes/referência, hash quando válido | Não há validação de conteúdo na 445; referência storage não garante disponibilidade/integridade. Avaliar leitura local autorizada própria, sem fetch remoto implícito. |
| Identidade documental e revisão | ID, número, sourceFileId, updatedAt e versão de pagamento | Versões de pagamento, correção e entrega têm semânticas distintas. Não reaproveitar um token para autorizar outro fluxo. Vínculo entre resposta e guia pode não existir. |
| Valores e composição | Valores locais como strings, circular e linhas limitadas | Não há certificação de principal/juros/multa nem de precisão suficiente para reparar contabilidade. Sem arredondamento ou zero substituto. |
| Pagamento e evidências históricas | Estado local, referência de comprovante, eventos e estado separado | Evento/estado não prova baixa atual. Entrega, reservas de comunicação e histórico integral não são cobertos pela 445; faltam portas próprias antes de qualquer substituição. |
| Circular, provisão e fechamento | Identidade mensal, updatedAt, fechamento, vínculo direto ou candidato legado | Vínculo ausente não se resolve por coincidência de competência/valor. Leitura não garante estabilidade do fechamento ou ausência de alterações concorrentes. |
| Execução e coordenação | Logs e observações locais | completed e lease vencido não comprovam conclusão global; não destravam reserva fiscal. Não existe transação única entre essas evidências. |
| Unicidade e ausência | Limites e truncamento explícitos | Filtro documentoId esconde outros candidatos; serviço não filtra guias. Mesmo uma fonte sem truncamento cobre apenas seu predicado, não todos os históricos necessários. |

Uma futura prévia não pode consumir apenas os achados humanizados da 446 como prova: eles são apresentação derivada, com paginação local. A 445 é ponto de partida para diagnóstico, não pacote suficiente para aplicação. Retenção de respostas, validação de conteúdo, leitura completa e estratégia transacional precisam de desenho posterior; não adicionar essas capacidades nesta etapa.

## Autorização e contrato conceitual da prévia interna

Contrato apenas conceitual, **read-only e não HTTP**. Não se cria função, endpoint, DTO versionado executável, tela ou consumidor nesta entrega.

Entrada proposta: empresa e competência obrigatórias, serviço explícito para o candidato, referências locais de tentativa/cache/documento quando comprovadas e finalidade delimitada. Sessão autenticada do servidor em contexto separado; não aceitar ator, papel ou autorização afirmados pelo payload. Identificadores apenas restringem o escopo. Uma evidência não pode ampliar a empresa autorizada.

Antes de ler evidência, reutilizar a política atual da 445: conta FIRM e guarda por empresa com mínimo ACCOUNTANT, vínculo vigente e exceção admin existente. Preservar #275, sem importar a política global distinta do lote moderno. A autorização para ler não concede autorização futura para escrever. Procuração/poderes fiscais, pausa operacional e permissão interna são dimensões distintas: ler uma evidência local não consulta nem valida poderes no provedor, tampouco autoriza ato fiscal.

Saída conceitual proposta:

- Identidade/finalidade, base da avaliação, momento da observação e consistência declarada.
- Classificação por candidato e por operação, motivos, fontes observadas e lacunas; sem `podeExecutar:true`, token de autorização ou conclusão global de conciliação.
- Evidências com IDs, hashes quando comprovados, versões e origem temporal; conteúdo sensível minimizado, sem bytes, resposta bruta, storageKey, credenciais ou mensagens livres.
- Diferença hipotética por campo e contexto dono, ou nenhuma alteração necessária; campos não demonstráveis ficam desconhecidos. Não produzir um payload pronto para gravar a partir de valores presumidos.
- Requisitos faltantes, conflitos e efeitos expressamente excluídos: reserva, consulta, envio, pagamento, circular contábil, provisão, baixa, fechamento e limpeza.

Capacidades permitidas futuramente: autorização, leituras locais escopadas e interpretação pura, com relógio explícito. Nenhuma capacidade de upsert, delete, update, reserva, auditoria persistida, fila, rede ou parser remoto. Não chamar SerproHttpClient, `lerResposta` legado, captura, escritor documental ou gerador para montar a prévia. Não usar flag “simulação” em escritor como substituto de ausência de capacidade de escrita.

Falha de autorização é fatal; falha de fonte é explicitamente indisponível, sem retry automático e sem lista vazia inventada. Truncamento, filtro restritivo, expiração ou inconsistência impedem conclusão positiva que dependa dessa fonte. A prévia não adquire lease nem altera cache/TTL, status de reserva, datas de consulta ou logs de negócio. Qualquer necessidade futura de persistir a análise/auditoria de leitura precisa de escopo separado, pois deixaria de ser estritamente read-only.

## Concorrência, CAS e auditoria de eventual aplicação

Esta seção lista requisitos a avaliar antes de um comando futuro, não garantias implementadas. A prévia não congela o banco; nem mesmo leitura em snapshot substituiria revalidação no momento de aplicar.

1. Identificar o conjunto de precondições: empresa, competência, serviço, conteúdo da resposta, revisão documental, ausência/presença de candidatos, pagamento, vínculos, fechamento, estado de reserva e autorização atual. Associar fingerprint determinístico à versão da proposta e ao diff; hash é detecção de mudança, não autorização.
2. Relê-las sob fronteira transacional definida pelos donos. CAS da Guide por updatedAt é insuficiente para detectar inserção concorrente quando ainda não há guia, alteração de cache, pagamento ou fechamento. Demonstrar unicidade/isolamento e coordenação com escritores atuais, inclusive ausência e múltiplos candidatos. Não prometer que um lock novo ignorado pelos legados resolva a disputa.
3. Se qualquer fato material mudar, recusar a aplicação e exigir nova análise. Não reutilizar automaticamente as quatro tentativas de mesclagem do helper legado para aplicar uma proposta cuja aprovação ficou obsoleta. Retry de banco não pode virar retry fiscal ou nova intenção.
4. Se futuramente autorizada, escrita documental e auditoria obrigatória devem ter atomicidade comprovada; falha da auditoria desfaz a escrita. Passar a mesma transação às portas, sem fallback para Prisma global. Se armazenamento de bytes estiver fora da transação, definir staging/finalização e falhas antes de afirmar atomicidade; estratégia ainda pendente.
5. Auditoria proposta: autor autenticado, instante real da recuperação separado do instante da evidência original, motivo, empresa/competência, referência e hash da origem, identidade/revisões antes/depois, campos alterados, decisão e versão da proposta, correlação idempotente e resultado. Preservar eventos anteriores; não fabricar consulta recente, recibo, pagamento ou autoria histórica.
6. Idempotência proposta deve distinguir repetição da mesma intenção de tentativa conflitante. Repetição comprovada devolve o fato já persistido sem novo documento/evento; mudança de conteúdo ou revisão recusa. Interrupção após commit exige leitura do resultado próprio, não reaplicação cega. Nenhum status de reserva fiscal é alterado para facilitar isso.

Teste PostgreSQL sintético com escritores concorrentes, rollback e interrupções seria necessário para demonstrar essas propriedades. Não foi executado pelo executor e não há estratégia de aplicação homologada.

## Três trilhas que não se substituem

**Recuperação documental local:** reaproveitamento eventual de evidência já custodiada para suprir uma lacuna documental comprovada. Não é reemissão, recálculo, consulta ou nova captura fiscal. Campos fiscais da circular, se necessários, exigem proposta específica; não executar o caminho completo por conveniência.

**Conferência contábil:** investigação da provisão, composição, vínculos, baixa, exportação e fechamento por Contabilidade. Documento recuperado não prova razão correto e não autoriza repará-lo. R25/R26 permanecem íntegros; confirmação do cliente e correção de mês fechado conservam suas ações e provas próprias.

**Resolução de reservas:** investigação de resultado externo incerto, prova suficiente e decisão auditável em fluxo separado. Cache, PDF, sucesso local, tempo decorrido, lease expirado ou log completed não encerram a reserva nem autorizam repetição. Nesta avaliação a reserva pendente impede avançar para proposta executável do recorte inicial; a descrição das evidências continua possível. Não definir aqui endpoint, expiração, liberação manual ou consulta de conciliação.

## Critérios para aceitar ou rejeitar um próximo desenho

Os cenários abaixo são critérios propostos, não resultados de testes.

| Critério | Aceitar como evidência técnica | Rejeitar |
| --- | --- | --- |
| Isolamento e autorização | Guardas reais, empresa correta, revogação e conta cliente recusadas antes de evidências | Papel/ator vindo do payload, autorização herdada do seletor ou política #275 alterada |
| Inércia da prévia | Somente leituras; banco antes/depois idêntico; doubles que falham em rede/escrita/fila | Cache limpo, TTL renovado, log de negócio gravado, reserva adquirida ou chamada oculta |
| Suficiência da evidência | Identidade e conteúdo comprovados, fontes completas, versões coerentes, motivos explícitos | PDF presente tratado como validado, ausência por filtro/truncamento ou falha convertida em zero |
| Reserva incerta | Continua incerta; nenhuma saída/retry; diagnóstico separado | Cache/PDF ou prazo usado para finalizar/liberar reserva |
| Duplicidade e revisão | Mesmo documento produz proposta sem alteração; conflito impede proposta executável | Mais recente vence automaticamente, duplicata presumida removível ou guia de parcela incorporada |
| Compatibilidade financeira | Pagamentos, comprovantes, envios, provisão/exportação e fechamento preservados | Migrar confirmação à nova revisão, gerar baixa/provisão, marcar envio ou reabrir mês |
| Concorrência futura | Corrida com criação, pagamento, documento, fechamento e cache detectada; falha auditável sem parcialidade | CAS apenas de Guide apresentado como garantia global ou aplicação da proposta antiga após retry |
| Temporalidade | Origem antiga e data real da eventual recuperação separadas | Reprocessamento apresentado como nova consulta oficial ou revalidação fiscal |
| Relato de validação | SHA, comandos/resultados reais, limites e evidências independentes identificados | Contagem histórica declarada como teste desta etapa ou aprovação inventada |

## Próximos incrementos — não iniciados

1. Principal concluir testes sintéticos aplicáveis à base, registro e revisões desta avaliação. Parecer documental não autoriza implementação.
2. Mediante escopo próprio, desenhar e testar somente a prévia interna read-only: portas mínimas, identidade/conteúdo, completude, consistência e autorização. Decidir como obter evidências locais faltantes sem incorporar capacidades de escrita/rede. Não ampliar HTTP/UI 446 por consequência.
3. Somente após avaliação e autorização específicas, considerar um comando documental mínimo, com auditoria, CAS/ausência concorrente, idempotência e reversão que preserve evidências. Definir explicitamente campos, custódia de bytes e impactos em projeções antes de implementar.
4. Tratar separadamente conferência/correção contábil, recuperação de campos fiscais da circular, reservas incertas e eventual preservação de duplicatas/histórico. Nenhuma dessas trilhas começa por este documento.

Pendências técnicas: prova de identidade resposta–documento; leitura integral de evidências; correlação legada; retenção e integridade local; política de propostas obsoletas; coordenação com escritores existentes; atomicidade de bytes/auditoria. Pendências de decisão: alcance exato de uma primeira escrita, tratamento de documentos pagos/fechados e evidência suficiente para conciliar reservas em fluxo próprio. Não presumir decisões a partir de viabilidade técnica.

## Lacunas adicionais confirmadas pelo Principal

### Identidade não certificada pelo parser/cache

`buildPgdasGuidePayload` atribui CNPJ e competência dos argumentos do chamador (`interpretacaoDas.js:293–296`), mesmo com metadados divergentes na resposta; decodificar base64 não vazio não valida estrutura PDF. Os ensaios C1–C3 reproduzem isso com texto sintético não PDF. `DOCUMENTO_NA_RESPOSTA_LOCAL` não comprova identidade nem integridade fiscal.

O schema de `SerproRespostaCache` contém somente chave/resposta/expiraEm: não há reservaId, envelope, instante próprio de captura, geração imutável ou hash da resposta. A chave é hash da **requisição canônica + rota**, não do PDF/resposta nem recibo fiscal. Upsert substitui a resposta da mesma chave. O ledger conserva empresa/CNPJ/competência/serviço/rota/assinatura, mas não o envelope completo/data de consolidação nem ligação exclusiva resposta–tentativa; várias tentativas podem compartilhar assinatura. Não reconstruir envelope usando cadastro ou relógio atuais. A prévia precisaria comprovar a cadeia resposta → tentativa → identidade fiscal → bytes → revisão, usando prova adicional de origem quando disponível; assinatura isolada e dados atribuídos pelo parser nunca bastam.

`Guide.sourceFileId` e `Guide.hash` são únicos globalmente, não por empresa/período/revisão. A identidade da captura usa serviço/CNPJ/competência/número saneado e fallback `sem-documento`; saneamento/fallback podem colidir. Não tratar conflito P2002 como prova de duplicata recuperável, associar documento de outra empresa ou expor sua existência. É necessário distinguir colisão de identidade, conteúdo repetido e intenção já concluída, sempre no escopo autorizado.

### Documento ausente, removido e substituído

`Guide` usa pdfBytes/storageKey/storageUrl; não possui fileKey nem tombstone geral/cadeia imutável completa de versões. Não se distingue historicamente nunca criado de apagado/substituído com uma consulta vazia. A limpeza legada pode remover guia paga, e `AccountingEntry.sourceGuideId` tem `onDelete:SetNull`: um vínculo ausente pode ser consequência de remoção.

Eventos de confirmação são append-only em AppSetting; porém `pagamentos` da445 só procura IDs das guias atuais e retorna vazio sem guias. **Confirmações órfãs não aparecem nessa leitura.** Portanto cache + zero guias + histórico de pagamentos vazio na445 não comprova ausência de pagamento anterior. Filtro documentoId, serviço ou limite também não prova ausência do conjunto completo.

Complemento da matriz:

| Cenário | Classificação proposta | Evidência necessária |
| --- | --- | --- |
| Resposta íntegra/identidade comprovada mas ausência histórica desconhecida | Não verificável | Histórico completo de versões, remoções e evidências sobreviventes; hoje não demonstrado genericamente. |
| Remoção/substituição conhecida, mesmo com PDF antigo no cache | Bloqueado para restauração automática | Decisão humana delimitada sobre a intenção histórica; autorização não substitui evidência ausente. |
| Cache+ausência comprovada de guia mas confirmação/baixa órfã ou SetNull | Bloqueado para qualquer alteração de evidência/vínculo financeiro; demais aspectos não verificáveis | Investigar origem e revisão com Guias/Contabilidade, sem recriar comprovante ou associar razão por inferência. |
| Assinatura compartilhada entre tentativas ou metadados/PDF conflitantes | Não verificável; divergência comprovada bloqueia | Prova de proveniência e revisão; não escolher por timestamp/valor isolado. |

Histórico confiável/tombstone ou evidência equivalente é requisito de desenho futuro, não migration proposta ou iniciada nesta etapa. Sem prova suficiente, `HISTORICO_DOCUMENTAL_INSUFICIENTE` permanece explícito. Guia válida já existente pode receber conclusão sem alteração; a **criação/substituição** fica bloqueada, inclusive para upload que já supre a necessidade.

### Especificação mínima adicional da prévia proposta

Entrada fechada sugerida: companyId, competencia, servico obrigatório (somente GERARDAS12/GERARDASCOBRANCA17), reservaId, assinatura candidata, documentoId opcional e limite1–100 (padrão50). Sessão autenticada em contexto separado. Referências são seletores, não provas; documentoId não pode restringir a busca de sucessores/histórico necessária à avaliação. Campos desconhecidos, executar, forçar, atualizar e retry são recusados. Nenhum contrato HTTP atual é alterado.

Saída proposta, ilustrativa e não implementada:

```json
{
  "contrato": "proposta-previa-local-das-447",
  "classificacao": "NAO_VERIFICAVEL",
  "motivos": ["HISTORICO_DOCUMENTAL_INSUFICIENTE", "VINCULO_RESPOSTA_TENTATIVA_NAO_COMPROVADO"],
  "reserva": {"estadoObservado": "ok", "resolucao": "NAO_REALIZADA"},
  "consistencia": "OBSERVACOES_INDEPENDENTES_SEM_SNAPSHOT_GLOBAL",
  "efeitosPermitidos": []
}
```

Classificações por candidato: ELEGIVEL_CONDICIONADO/BLOQUEADO/NAO_VERIFICAVEL, com provas comprovadas/ausentes/não verificáveis e motivos; fonte falha usa quantidade null, nunca zero. Nenhum token de escrita, booleano recuperavel/conciliado ou comando. Não retornar bytes/base64, rawPayload, extracted integral, storageKey/URL, credenciais ou mensagens livres. Eventual parsing **local** precisa contrato de tamanho/CPU/formato e minimização; falha nunca permite parser/rede fiscal remotos. A 445/446 continuam intactas.

### Condições suplementares de uma eventual escrita

Primeiro recorte sugerido: restituição estritamente documental somente quando comprovadamente necessária, sem substituir revisão vigente, tratar reserva ou produzir efeitos contábeis/comunicação. Não reutilizar captura/funil/limpeza: `somenteDocumentos` não torna o fluxo puramente local; a captura pode emitir, persistir circular/acréscimos, e o funil de Guias contém hook contábil. Esses caminhos não são prova de isolamento.

`versaoPagamentoGuia` exclui vencimento e updatedAt (C10). `revisaoDocumentoGuia` de envio acrescenta vencimento, e o token da correção tem outra semântica. Nenhum é CAS universal. Eventual plano deve fixar identidade fiscal, geração/hash da resposta, bytes/hash, revisão/updatedAt, conjunto documental, pagamentos/comprovantes, vínculos e autorização atual. CAS perdido exige recusa/nova prévia; não mesclar silenciosamente uma aprovação obsoleta. Proteger **ausência** exige coordenação/unicidade/isolamento com todos os escritores, não apenas CAS da linha inexistente.

Faltam ensaios PostgreSQL descartáveis de criação concorrente, pagamento/comprovante/revisão após prévia, colisão global de hash/sourceFileId, auditoria com rollback, storage/banco sem transação conjunta e crash antes/depois do commit/resposta. A chave idempotente futura precisa ligar origem imutável, identidade, intenção e resultado auditável; repetir depois de commit deve devolver o fato já persistido sem nova guia/auditoria/transporte. Esses ensaios de uma recuperação inexistente **não foram executados nem declarados aprovados**.

Autorização humana específica futura é necessária para implementar prévia, implementar escritor, restaurar documento removido/substituído, selecionar revisão conflitante, tratar documento pago/prova, corrigir vínculo/provisão/baixa/fechamento, resolver reserva incerta, consultar serviço externo ou publicar/ativar. Cada autorização limita-se ao caso/escopo concreto e não supre prova técnica ausente. Nesta etapa, a autorização termina em avaliação, testes sintéticos e PR em rascunho.

### Fontes verificáveis na base

- [Cache e efeitos do leitor legado](../../apps/api/src/application/fiscal/serpro/SerproRespostaCache.js), [ordem de cache e ledger](../../apps/api/src/application/fiscal/serpro/SerproHttpClient.js), [modelos e relações](../../apps/api/prisma/schema.prisma).
- [Parser puro DAS](../../apps/api/src/modules/fiscal/domain/interpretacaoDas.js), [montagem da requisição](../../apps/api/src/application/fiscal/serpro/SerproPgdasdService.js), [captura legada](../../apps/api/src/application/fiscal/serpro/CaptureSerproGuidesService.js).
- [Leituras de Guias/pagamentos445](../../apps/api/src/modules/guides/infrastructure/prisma/leituraConciliacaoDas445.js), [projeção contábil445](../../apps/api/src/modules/accounting/domain/evidenciasConciliacaoDas445.js), [CAS legado](../../apps/api/src/application/guides/atualizarGuiaComEvidencia.js), [funil de Guias e hook contábil](../../apps/api/src/application/guides/GuideService.js).
- [Versão de pagamento](../../apps/api/src/application/guides/ConfirmacaoPagamentoClienteService.js), [revisão de envio](../../apps/api/src/application/whatsapp/EnvioDocumentoGuiaWhatsappService.js), [autorização445](../../apps/api/src/infrastructure/security/autorizarLeituraConciliacaoDas445.js), [observações sem snapshot](../../apps/api/src/modules/operations/application/consultarConciliacaoDas445.js).
Tipos/validação propostos: entrada objeto simples; companyId/reservaId obrigatórios e documentoId opcional são strings opacas `[A-Za-z0-9_-]{1,128}`; competencia string `AAAA-MM` com ano não0000 e mês01–12; servico string no enum fechado dos dois serviços; assinatura string SHA-256 hexadecimal64; limite inteiro1–100, padrão50. Resolver reserva e assinatura dentro da empresa/competência/serviço, recusando referências incoerentes. Relato de evidência insuficiente não permite ampliar escopo nem aceitar campo desconhecido. O contrato é proposta a aprovar; não altera validações, funções ou contratos HTTP existentes.


## Validação desta avaliação e limites do controlador

Ambiente local: Node20.20.2/npm10.8.2; dependências do lock instaladas só nesta worktree com `npm ci --ignore-scripts --no-audit --no-fund`; client Prisma gerado localmente, sem migration/conexão. Nos testes Jest, DATABASE_URL foi um sentinela sintético loopback porta1, não uma base real. Nenhum banco, cluster antigo ou serviço fiscal foi usado.

| Evidência executada em447 | Resultado | Alcance |
| --- | --- | --- |
| [Ensaio puro C1–C10](evidencias/serpro-das-447.test.mjs), `node --test docs/modules/evidencias/serpro-das-447.test.mjs` da raiz | 10/10 | Identidade atribuída, nãoPDF aceito, projeção cache, reserva incerta, expiração histórica, storage só referenciado, vínculo contábil ambíguo, completed, falha/truncamento e versão de pagamento. Importa funções reais puras; não implementa algoritmo de recuperação. |
| 10 suítes Jest existentes selecionadas, comando reproduzível abaixo | 159/159; 42/42 snapshots | Contratos12/17, respostas reutilizadas, reservas/cache, captura sintética444, seleção/autorização445, projeção e handler446. HTTP/DB/credenciais são doubles conforme cada suíte; não é ensaio de recuperação produtiva. |
| Governança: check.test, orchestrate.test, bootstrap.test, data-gate.test, run-jest-batches.test | 88/88 | Catálogo/controlador; não concede autorização operacional. |
| Verificador: verificar.test.cjs e fronteiras.test.cjs | 5/5 | Análise estática e fixtures do verificador. |
| Diagnose com mesmo verificador/parser sobre fonte da base arquivada de Git e candidata | 5023→5023; zero acréscimos | Legado preservado, sem nova dependência produtiva. Primeira tentativa local omitiu schema do arquivo-base e falhou tecnicamente; repetida após incluir schema exato da base, sem alterar baseline/verificador para ocultar achados. |
| Referência operacional local e fallback CI | SHA256 e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f | Caminho físico canônico e hash reconciliados, conforme AMBIENTE.md. |

Comando das suítes existentes (PowerShell, da raiz; configurar DATABASE_URL sentinela descrito acima):

```powershell
Push-Location apps/api
node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/application/fiscal/serpro/__tests__/dasRecuperacao444.test.js src/application/fiscal/serpro/__tests__/dasInterpretacao441.test.js src/application/fiscal/serpro/__tests__/respostasReutilizadas.test.js src/application/fiscal/serpro/__tests__/serproHttpReserva.test.js src/application/fiscal/serpro/__tests__/capturaReutilizacao.test.js src/composition/__tests__/conciliacaoDas445.selecao.test.js src/composition/__tests__/conciliacaoDas445.autorizacao.test.js src/modules/operations/application/__tests__/consultarConciliacaoDas445.test.js src/modules/operations/presentation/__tests__/apresentarPendenciasDas446.test.js src/routes/firm/__tests__/pendenciasDas446Http.test.js
Pop-Location
```

Controlador `2026-11-15T13-12-48-474Z-96021036`: quatro chamadas, uma rodada, planejador/executor/gate governança e revisores documental/sistêmico concluídos; retornou **ready_for_human para o documento inicial**, fingerprint `ddd95e71b6922bc87f851ce6736f265f8a43aabdbde47bc1b2b524fea62feaae`, hash do documento inicial `45b5e2b32efa282451cbdbf8272e3e4d117d5a82ab4d3b796b6c24f94eb1a8c7`. Não houve timeout ou gate contornado. Warnings de hooks/snapshot de shell ocorreram sem falha da rodada. O registro runtime gerado permanece histórico e inalterado.

**Limite:** o classificador por caminhos considerou somente documentation/low, e o controlador não executou caracterização DAS nem selecionou os seis papéis de domínio. O Principal elevou a avaliação a high pelo tema, executou os testes acima e solicitou revisões independentes específicas de Fiscal/SERPRO, Operações, Guias, Contabilidade, segurança e arquitetura. Complementos e teste-evidência posteriores mudam o fingerprint; o ready_for_human do runtime **não certifica a candidata final**. O registro447 e os pareceres finais identificam essa candidata. Não alterar status persistido, gates ou permissões para simular aprovação.

Logs privados em `.altan-governance/`: `caracterizacao-base.json/.log`, `caracterizacao-447.log`, `governance-test.log`, `architecture-test.log`, `architecture-baseline.json`, `architecture-diagnose.json` e diretório da execução. Não publicar prompts/logs brutos. A CI hospedada será identificada no PR; sucesso local não é sucesso remoto. Não houve novo ensaio PostgreSQL, crash de worker, investigação de casos reais ou prova de idempotência do escritor futuro. Essas limitações impedem aprovar recuperação agora, sem impedir esta avaliação documental.

Rollback: reverter somente os arquivos deste PR (avaliação, ensaio sintético, índice e registros documentais de impacto/runtime); sem dados/migrations a desfazer. Preservar worktree, logs privados, dependências e árvores antigas. PR exclusivamente em rascunho; sem merge, deploy, reativação do Auto Deploy, implementação futura ou ação operacional. Aguardar autorização humana própria para qualquer próximo incremento.
