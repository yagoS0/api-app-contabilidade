# PR #288 — Caracterização da navegação de Apuração

## Escopo e referências

Atende ao [comentário de coordenação](https://github.com/yagoS0/api-app-contabilidade/pull/288#issuecomment-6901896581).
Base remota confirmada em 15/11/2026: `cbea0e52fb2d75327056067283759b3a73c9a3cc`.
Candidato produtivo: `9473df9cc8cc0d99e573848d3e81d9d4fc6d17c8` + somente testes e esta documentação.
O SHA de entrega é o head do PR que contém este registro; resultados hospedados devem ser conferidos nesse SHA.
Mesma branch/worktree P1. Nenhuma regra, endpoint, cálculo, autorização ou persistência de produção foi editada nesta rodada.

O diff produtivo do P1 continua limitado a `OperationsAlerts.jsx`, `OperationsCalculationDetails.jsx` e `operacoes.css`.
API, cliente HTTP, `OperationsPage`, `OperationsApproval`, motor fiscal e contratos contábeis não possuem alterações produtivas frente à base.
Normas: [arquitetura](../governance/ARQUITETURA.md), [plano diretor](../modules/plano-diretor-operacoes-apuracao.md), [registro P1](../governance/changes/2026-11-15-operacoes-clareza-p1.json).

## Matriz do caminho atual

Prefixo HTTP `/firm`; `:id` é a identidade da empresa/PortalClient, `:pa` a competência selecionada. Métodos do cliente estão em `apps/web/src/api/real/realApi.js`; rotas operacionais em `apps/api/src/routes/firm/operacoes.js`.

| Navegação/ação | Componente e método do cliente | HTTP e serviço | Autorização e efeitos atuais |
|---|---|---|---|
| Operações / indicadores | `OperationsPage`, `useOperationsEvidence`; `getOperationEvidence` | GET `/operacoes/evidencias?competencia=:pa` → `OperationsConsultas` | Empresas visíveis, leitura consistente; não calcula nem transmite. Três containers preservados. |
| Preparar cálculo NFS-e | `OperationsCalculationBatch`; `previewOperationsCalculation` | GET `/companies/:id/operacoes/:pa/calculo/previa` → `OperationsCalculationService` | ACCOUNTANT/FIRM_ADMIN conforme vínculo; diagnóstico local, não autoriza sozinho despacho fiscal. |
| Calcular explicitamente | Mesmo componente; `executeOperationsCalculation`, `getOperationsCalculationResult` | POST `…/calculo`, GET `…/calculo/resultado?requestId=…` | Reserva tentativa/revisão, coleta ADN, prepara RBT12, simula SERPRO e persiste cálculo. Não é motor puramente interno. Resultado incerto impede repetição automática. |
| Calculado → Conferência | `OperationsApproval` + `CalculationEvidence`; `getCompanyOperation`, `getApuracaoSnapshot`, `getAuditoriaNotas`, `getPgdasHistorico` | GET `…/operacoes/:pa`; `/companies/:id/apuracao-snapshot/:pa`; `/companies/:id/notas/auditoria?competencia=:pa`; `/companies/:id/pgdas/:pa/historico` | Leitura de fontes salvas; empresa, competência, revisão e auditoria precisam corresponder. Histórico não prova revisão atual. Abrir não confirma, simula nem transmite. |
| Confirmar apuração | `OperationsApproval`; `saveCompanyOperation` | PUT `…/operacoes/:pa`, `action=confirm` → `OperationsService.salvarOperacao` | Escrita ACCOUNTANT/FIRM_ADMIN e bypass admin vigente; revisão/fingerprint/requestId, Serializable e coordenação por empresa/competência. Grava confirmação operacional e registro da requisição; não transmite nem gera provisão. |
| Confirmado → Liberar e executar | `OperationsApproval`; `saveCompanyOperation` + `executeCompanyOperation` | PUT `action=release`, depois POST `…/executar` → `OperationsExecution` | Competência digitada, revisão nova, liberação única, revalidação de vínculo/contexto/pendências/procuração no despacho. Pode transmitir PGDAS ou completar documentos de declaração já existente. |
| Transmitido → documentos | `OperationsTransmissionTable` em `OperationsCalculationDetails`; `getOperationsTransmissionDocuments` e download | GET `…/transmission-documents`, GET arquivo vinculado; POST `/operacoes/transmission-documents/zip` | Leituras de arquivos armazenados, acesso por empresa e identidade/revisão por item. POST ZIP empacota leitura, não transmite. Ausência não vira documento disponível. |
| Aviso histórico → revisar empresa | `OperationsAlerts`, `InternalLink` | Link interno com empresa e competência; GET `/operacoes/avisos` | Contexto do aviso é histórico. Texto P1: “Transmissão registrada na época do aviso”. Não é confirmação fiscal atual nem comando de retificação. |
| Apuração externa | `OperationsExternalBatch`; `getOperationsExternal`, `saveOperationsExternal` | GET/POST `…/externa` → `OperationsExternalService` | Presumido comprovado no mês; versão/hash e histórico de tarefa. Concluir tarefa externa não transmite PGDAS. |

`requireFirmCompanyAccess` é a guarda real do router; serviços revalidam o ator onde previsto.
Leitura operacional admite STAFF, comandos exigem ACCOUNTANT/FIRM_ADMIN; o bypass admin existente não foi ampliado.
Autenticação de sessão é anterior ao router. O ensaio HTTP injeta identidade sintética e exercita a autorização real, não o login.
A diferença preexistente entre lote moderno e rotas antigas do #275 permanece; nenhuma harmonização de política foi feita.

## Evidências de caracterização e paridade

Ambiente: Windows, Node 20.20.2, PostgreSQL 16.15 em loopback, banco sintético `altan_rotinas_governance_test`, cluster exclusivo P1.
SERPRO, autenticação do provedor e armazenamento foram substituídos por doubles; chamadas não previstas falham. Nenhuma credencial produtiva, nota real ou mensagem foi utilizada.
A base foi exportada com `git archive` para diretório ignorado na própria worktree; somente os quatro arquivos de testes desta rodada foram copiados para ela.
Dependências locais foram compartilhadas por junção; lockfiles e pacotes compartilhados não diferem entre base e candidato. Nenhuma worktree anterior foi alterada.

| Suíte | Base | Candidato | Interpretação |
|---|---:|---:|---|
| Operações API + rotas operacionais/legadas de liberação | 264 aprovados / 4 ignorados | 264 aprovados / 4 ignorados | Mesmos casos e resultados; 21 suítes aprovadas. |
| PostgreSQL dentro da suíte API | 24 aprovados | 24 aprovados | Cálculo, lote, nova cadeia HTTP e reenvio controlado; sem transporte real. |
| Interface Operações completa | 445 aprovados | 466 aprovados | Todos os 445 nomes comuns aprovados; 21 testes adicionais do P1. Não são 466 testes idênticos na base. |
| Nova navegação com cliente HTTP real, versão final | 4 aprovados | 4 aprovados | Mesmas fixtures e asserções finais, inclusive documentação ausente após execução. |
| Governança + verificador | — | 40 + 5 aprovados | Diagnose 5.023 → 5.023, zero novas violações. |

As quatro exclusões API são duas caracterizações antigas intencionalmente ignoradas em `liberacaoLegadaAcesso.test.js` e duas integrações que exigem outro banco nominal (`altan_piloto_governance_test`). Não são declaradas executadas. O novo HTTP PostgreSQL executa a guarda canônica real para o fluxo de apuração. A suíte de reenvio PG teve sua variável habilitada no ensaio final (cinco casos), sempre com transporte falso.

### Testes novos ou ampliados

- `OperationsNavigationHttp.test.jsx`: página e cliente reais, fetch fechado; conferência e volta/foco na mesma etapa; confirmação PUT separada de liberação PUT e execução POST; empresa/competência/revisão; resultado desconhecido não repetido; evidência de outra empresa bloqueada; EXECUTED com documentos vazios não habilita extrato.
- `OperationsBatchService.postgres.test.js`: HTTP real → guarda real → serviços reais → PostgreSQL, com transmissão simulada no limite Axios. Confirmação sem chamada fiscal, revisão vencida 409, competência divergente 422, transmissão única, consulta documental sem SERPRO, replay 409 com mensagem preservada, vínculo inativo 403 e anônimo 401. Após negativas, conteúdo de AppSetting, guias e snapshot permanece idêntico; não apenas contagem.
- `OperationsEligibility.characterization.test.js`: Simples, Presumido, desconhecido, ausência, período parcial, futuro, encerrado, sobreposto, data inválida e fallback legado cadastral.
- `OperationsCalculationService.test.js`: sem movimento pode passar pela prévia; coleta/preparação resulta em REVIEW antes da simulação. Não força caminho feliz nem altera regra.

Coberturas existentes reexecutadas: Fator R sem folha, ausência de procuração, revisão/contexto alterados, reserva incerta, documentação parcial e identidade divergente, autorização revogada, apuração externa, concorrência manual/lote, Presumido concorrente e rollback.
Os resultados verificam contratos e efeitos observáveis; não constituem homologação tributária ou de transporte real.

Ensaios preliminares detectaram lacunas na própria fixture HTTP da interface (consulta de INSS manual não cadastrada e ausência do campo público `ok` na resposta documental). Foram corrigidas somente as fixtures. A última ausência falhou igualmente na base e na candidata; o ensaio final passou em ambas. Não foi tratada como defeito do produto. O cluster descartável precisou ser iniciado com sua porta explícita; foi encerrado ao terminar os testes, preservando os arquivos.

Reprodução: executar Jest diretamente em cada workspace, `--runInBand`, com padrões `features/operacoes/__tests__` no web e `application/operacoes/__tests__|routes/firm/__tests__/operations|routes/firm/__tests__/.*[Ll]iber` na API. Configurar os três URLs descartáveis `DATABASE_URL`, `ALTAN_GOVERNANCE_TEST_DATABASE_URL`, `TEST_CICLO_PG_URL`; habilitar `TEST_OPERATIONS_PG_URL` somente no destino exigido por essa suíte. Não usar banco real. Manifesto compacto: [navigation-review.json](evidencias-operacoes-p1/navigation-review.json).

## Limites e fluxo futuro

1. A prévia de cálculo não prova Fator R nem ausência de movimento: essas verificações ocorrem na preparação antes do despacho. Limite legado de clareza; não regressão P1.
2. Ausência de RegimeHistorico não bloqueia sempre: existe fallback restrito do cadastro Simples com data de opção anterior ao mês. Caracterizado, não promovido a política fiscal definitiva.
3. Procuração é exigida no despacho, não universalmente para abrir/conferir/confirmar.
4. DONE/EXECUTED não prova completude documental; documentos e histórico vinculados são evidências distintas. Resultado incerto permanece pendência, sem repetição automática.
5. Motor interno versionado, novos indicadores/denominadores, seleção nova de lote e o fluxo futuro completo de aprovação → consulta oficial → transmissão → conciliação → encaminhamento não foram implementados pelo P1. Sua ausência não é regressão desta entrega.
6. Teste UI e teste HTTP/PG são camadas complementares, não uma única sessão ponta a ponta de navegador contra servidor. Login, fila assíncrona real, credenciais e transporte reais não foram homologados; o HTTP novo usa o caminho síncrono existente. Lote/reserva/concorrência têm suítes separadas.
7. Não foram encontradas regressões P1 nos cenários exercitados. Limites preexistentes de foco ao fechar toda a camada, overflow móvel da página completa e verificações axe inconclusivas continuam no [registro anterior](operacoes-clareza-p1.md), sem alteração incidental.

## Governança, revisão e decisão

Somente caracterização/documentação nesta rodada; não houve nova extração funcional nem reexecução de executor para alterar produto.
Preservado o resultado real anterior do controlador: gates integrais da rodada 0 passaram, parecer sistêmico inconclusivo e repetição interrompida; **não se declara ready_for_human**.
Revisões independentes nativas de Fiscal/Operações e arquitetura/backend inspecionaram os testes. Recomendações de verificar corpo/status do replay e conteúdo antes/depois da negativa foram incorporadas.
Pareceres finais em 15/11/2026: `/root/p1_contratos` (Fiscal/Operações) e `/root/p1_arquitetura` (sistêmico/backend), ambos favoráveis sem achados bloqueantes. Conferiram os hashes dos quatro testes e o relatório; não reexecutaram as suítes, cujos resultados são do coordenador. A CI do SHA de entrega complementa esta evidência no PR. Aprovação técnica não equivale a autorização de integrar.

Rollback desta rodada: reverter somente os quatro arquivos de teste e os documentos/registro acrescidos, preservando os ajustes P1 anteriores. Nenhum reparo de dados, migração ou publicação é necessário.
Não houve merge, deploy, chamada fiscal real, envio de mensagens, limpeza de worktrees ou alteração de Auto Deploy. Encerrar após entrega para revisão humana; não iniciar P2.
