# Mensagens e onboarding — incremento local de 17/10/2026

Base solicitada: `2e5c00d`, mais ajuste de execução de testes da governança tratado separadamente pelo Principal. Nesta árvore consolidada, os doze caminhos autorizados foram copiados de `../altan-mensagens-revisada-20261017`; somente a reserva de conversão, sua expectativa unitária e este documento foram adaptados. Implementação preparada pelo executor; validação e revisão independentes desta fonte permanecem pendentes. Não houve publicação, commit, mensagens reais, uso de provedor/modelo pago, consulta fiscal, geração de Prisma ou acesso a produção.

## Consolidação e correção escalar — rodada 0

A execução integral anterior não foi aprovada: `onboardingRotas.test.js:371` esperava 409 e recebeu 400; depois a API encerrou por OOM com heap de 2 GB, sem concluir os demais gates. O diagnóstico recebido identifica que o mock de `updateMany` aplica `Object.assign`, armazenando `{ increment: 1 }` na versão. Ao reenviar esse objeto, `patchFicha` é recusado pelo schema antes de chegar ao conflito de domínio. A prova PostgreSQL anterior passou, mas não certifica esta fonte posterior.

A reserva de `converter` agora usa `data: { versao: registro.versao + 1 }`. Mantém integralmente `where: { id, versao: registro.versao, status: registro.status, portalClientId: null }` e o aborto quando `count !== 1`. Predicado CAS e atribuição pertencem ao mesmo UPDATE: um concorrente que perdeu a versão não atualiza a linha. Não houve alteração do teste de rota, schema, gates, configuração ou política. O unitário passa a conferir o objeto completo da reserva, inclusive todos os filtros e o valor numérico final. O verificador PostgreSQL foi copiado sem alteração e mantém conversão contra quatro produtores, rollback e asserções da versão final igual a 1.

Hash SHA256 de `OnboardingService.js` após o ajuste: `3A0B3FDCB36BBA9E44030F51D5CC8791ACA47F1B6EBA551ED25DE67D043E2222`. O hash anterior `AD39F4DCA21D874D7F6E69088D35D814220BB3AC9228F5061C320654A9E3D0E3` foi conferido antes da adaptação.

Evidências anteriores informadas pelo Principal, sem reexecução por este executor:

- `.altan-governance/simulation/dialogue-1792245222537`: cinco turnos entre cliente fictício e atendimento simulado, roteador/coletor/banco reais e modelo/transportes substituídos; rede externa zero, desconhecidos não inventados e handoff preservado.
- `.altan-governance/current-pg-1792245173219`: dez verificações PostgreSQL, incluindo conversão concorrente, rollback, proposta consultável/aceitável após checklist, observação e fase, coleta/handoff/consentimento. Revalidar após a mudança escalar.
- `test-evidence/onboarding-alinhamento-1792245028847`: jornada formulário/coleta → diagnóstico → proposta → contrato → pagamento → empresa/documentos. Revalidar na fonte final.
- UI/hook/teste idênticos por SHA256 à árvore `altan-mensagens-validacao-final-20261017`, para a qual o Principal relata 58 testes, duas verificações independentes, QA Chrome em 1440/390 e lint completo. Identidade de arquivos permite rastrear a evidência anterior; não equivale à execução dos gates desta árvore.

| Arquivo em `apps/web/src/features/whatsapp/` | SHA256 conferido nas duas árvores |
| --- | --- |
| `components/CompositorConversa.jsx` | `61F37AE38F6594463DA1D137474357073122D39A1F742ECE96A9B52AE75DF77A` |
| `hooks/useRascunhoServidor.js` | `66E5DAECE0F4A7664DA6ED1A7E7818D1AAD1943256DCD78C6344FD00237F0FF1` |
| `components/__tests__/descarteRascunhoConcorrencia.test.jsx` | `761347CB4A57312C403E59370F12699E45350394186038C7B46F400C10BF808E` |

Nesta rodada, `git status --short` confirmou a árvore limpa antes da cópia; a conferência posterior encontrou somente os doze caminhos autorizados. `git diff --check` passou, com avisos de normalização LF/CRLF, sem erro de whitespace. O hash da referência operacional canônica foi novamente conferido e permanece inalterado. Não foram executados Node/Jest/PostgreSQL/build nem o comando de planejamento neste subprocesso, conforme orientação explícita para não repetir o EPERM conhecido. O controlador deve executar a lista integral Jest em lotes pelo catálogo confiável, sem omissões, além dos gates e provas afetadas. Não há aprovação própria nem conclusão técnica de runtime por este executor.

Os registros abaixo descrevem a preparação e os limites herdados da árvore revisada; referências a comandos tentados e pendências anteriores não representam novas execuções nesta consolidação.

## Correções e impacto

- `OnboardingService`: concluir etapa condiciona a reserva a id/estado/versão, usa updatedAt para adquirir o lock e grava etapa e evento na mesma transação, sem incrementar a versão material da ficha. Observação/checklist não invalida fichaVersao de uma proposta enviada. Desistência exige estado/versão atuais e grava evento na escrita atômica. Conversão incrementa a versão; atualização também condiciona a escrita ao estado lido. Uma conversão concorrente não pode ser sobrescrita por etapa, desistência ou atualização atrasada. Documentos, vínculos e eventos anteriores são preservados.
- `ComercialService`: edição comercial revalida id/estado/versão na escrita transacional. Conversão concorrente causa 409 amigável, sem alterar fase/proposta nem criar evento. Auditoria e escrita permanecem atômicas; fase operacional não incrementa a versão material.
- `CompositorConversa` e `useRascunhoServidor`: descarte reserva a exclusão antes de aguardar PUT/DELETE. A prontidão compartilhada fica bloqueada durante toda a operação, inclusive para listeners e componentes remontados. A conclusão comunica o tombstone `{ texto: "" }`; falhas preservam conteúdo e oferecem conferência. A resposta da conversa A não limpa o texto de B. Edição só é aceita após o desfecho; não é exibida uma nova edição que `salvar` recusaria silenciosamente. Exclusão pendente participa do aviso de trabalho não concluído; cancelamento de sessão invalida callbacks antigos.
- `interpretacaoComercialWhatsapp`: somente o intervalo entre verbo de abertura e objeto passou a ser não guloso. “Olá, quero abrir uma empresa, ainda não tenho CNPJ” deixa de incorporar a negação cadastral ao match de abertura. Não há LLM, novas inferências de titularidade ou mudança de contratação. Negações verdadeiras, múltiplas intenções e IDs estáveis continuam tratados pelo interpretador existente.

Referência operacional consultada: fonte canônica `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`, SHA256 `c24fdc32afdafd83f7ec7702ae08f21d710ad4419f43befadae5ff2641ffd96f`, conferido nesta execução. Aplicam-se R02, R19–R23; R25 permanece preservada, sem alteração financeira. V08 e demais propostas pendentes não foram implementadas. Nenhuma regra operacional foi modificada.

Risco alto por concorrência e isolamento em comunicação/comercial. Domínios diretos: API, comercial, comunicação, web e documentação. O mapa conservador inclui consumidores em operações, guias, contabilidade e portal; não houve edição nesses consumidores.

## Rastreamento e cobertura preparada

| Área | Caminho real e evidência preparada | Limite |
| --- | --- | --- |
| Concorrência do onboarding | Rotas `firm/onboardings.js` → `OnboardingService`; unitários com barreira e CAS, verificador PostgreSQL com `converter`, `atualizar`, `concluirEtapa`, `desistir` e edição comercial reais, rollback de auditoria e consulta/aceite após checklist | Unitários não comprovam isolamento PostgreSQL; verificador precisa ser executado na fonte final |
| Coleta e handoff | `ProcessarEventoWhatsappService` → `ColetaComercialWhatsappService` → serviços de lead e ficha; `mensagensOnboardingIntegrado.test.js` | Registrador, canal e consultas periféricas substituídos no Jest; transporte sintético, persistência em memória |
| Resposta tardia e adversarial | Interpretação sintética adiada após intervenção humana; entrada duplicada/antiga; conteúdo indisponível; pedido de ignorar contador | Fixture do adaptador não é resposta observada de LLM nem avaliação de qualidade |
| Persistência e retomada | `verify-mensagens-onboarding-postgres.mjs`: registrador/roteador, menu, coletor, handoff e consentimento reais; banco loopback descartável, HTTP/fetch bloqueados | O script não foi executado pelo executor; sem prova de entrega Meta |
| Descarte e remontagem | Compositor/hook reais; DELETE adiado A→B/A→B→A, PUT lento, remontagem, erros, nova edição, listeners dos modos texto/anexo/retomar, sessão e isolamento de modo/conversa | DTO usa tombstone real. Não usa hipótese de `conteudo:null`. Testes DOM não substituem QA visual |
| Intenção comercial | Frase original, dados desconhecidos/negados em outra oração, negativas reais, abertura afirmada com transferência negada, múltiplas escolhas, correção/reversão, botão e assunto de terceiro | Assunto de terceiro continua classificação; não autentica pessoa nem autoriza operação |

O roteador real mantém precedência do humano, vínculo/escopo e invalidação da automação antes de autorizar IA. A coleta comercial curta não executa proposta/contrato/pagamento automaticamente, conforme decisões atuais em CLAUDE.md. O fluxo interno posterior conserva contrato aceito e conferência humana. A proteção de versão adicionada não altera preços, aceite, assinatura, consentimento ou pagamento.

`RascunhoAtendimentoService` já devolve `{conteudo:{texto:""}}` após exclusão: esse servidor não foi alterado. O fio em `pages/renderWhatsappPage.jsx` usa chave do interlocutor, justificando o teste com desmontagem/remontagem. `AnexoDaConversa` e `RetomarConversa` consomem o mesmo hook em modos separados; as guardas de salvar/prontidão cobrem a exclusão compartilhada sem misturar os modos. Os fluxos completos desses consumidores ainda exigem suas regressões existentes.

## Histórico: comandos tentados na árvore revisada

| Comando | Resultado real |
| --- | --- |
| `node scripts/governance/check.mjs plan --base 2e5c00d` | Bloqueado antes de executar: Node `EPERM`, `lstat C:\Users\yagoa` |
| `git diff --check` | Executado sem erro de whitespace |

Jest, PostgreSQL e build não foram executados nesta retomada: após o EPERM confirmado, não foram repetidas tentativas Node, conforme orientação do Principal. Os testes preparados precisam ser executados pelo controlador na fonte final. Nenhuma permissão foi alterada para contornar o bloqueio. Evidências da árvore anterior foram consultadas como diagnóstico, não como resultados aprovados desta fonte.

## Reprovações corrigidas nesta retomada

A implementação anterior não foi aprovada: incrementar versao no checklist tornava proposta ENVIADA indisponível, e ComercialService ainda permitia edição atrasada após CONVERTIDO. Os unitários acrescentados chamam os serviços reais e exercitam consulta/aceite depois de observação e conclusão; conflitos de estado e versão; persistência do retorno comercial; e falha de auditoria. O verificador PostgreSQL amplia a barreira de leitura para comercial versus converter real, preservação de fase/proposta/eventos, aceite persistido e rollback real quando a auditoria comercial falha. Ainda não há resultado desta execução para esses cenários.

A conversão não copia checklist de seu snapshot: altera apenas a etapa específica de CONVERSAO. Assim, o lock sem incremento material preserva as demais etapas e a proposta. O campo legado onboarding.proposta e a fase mantêm a semântica anterior; não substituem o snapshot aceito de PropostaComercial. Risco residual preservado: duas edições operacionais na mesma versão/estado ainda podem sobrescrever o mesmo campo pela ordem de gravação; este incremento protege o encerramento e a revisão material, sem inventar nova política de edição ou invalidar propostas por anotação operacional.

As evidências adaptativas, PostgreSQL e visuais relatadas pelo Principal na árvore anterior permanecem diagnósticas. A fonte de UI/interpretador foi reutilizada, mas a nova correção transacional exige renovar as provas afetadas. Não somar contagens antigas nem tratar execução anterior como gate desta árvore.

## Pendências de validação do Principal

Reexecutar testes dirigidos e gates na fonte final, incluindo testes existentes dos consumidores de rascunhos. Ler e executar o novo verificador somente em PostgreSQL local descartável já migrado, com sufixo `_governance_test`; ele não lê `.env` nem gera Prisma. O script conserva fixtures apenas nesse banco e produz transcrição de entradas/saídas reais dos serviços com transporte substituído.

Renovar as provas existentes de confirmação, multiempresa, coleta, entrega, canais, inbound/leases/handoff, rascunhos/intenção/push, comunicados, consentimento e pagamento do cliente/R25 conforme impacto. A jornada coleta → proposta → contrato → pagamento → conversão requer também os verificadores comerciais existentes e `verify-opening-company-postgres.js`, com fixtures isoladas. Contagens de execuções anteriores não devem ser somadas como cenários únicos nem certificadas para este diff.

A conversa adaptativa com agentes independentes, a revisão independente e sistêmica e o QA visual desktop/celular permanecem com o Principal. Este executor não delegou nem reiniciou o controlador. A mudança usa os componentes/tokens existentes, sem reorganização de layout; foi acrescentado estado textual de descarte, cuja apresentação ainda deve ser conferida visualmente.

Rollback de código deve abranger o conjunto deste incremento após revisão; não apagar eventos, documentos, vínculos ou baixar versões persistidas. Não há migração nova. Reverter a proteção de concorrência reintroduz o defeito conhecido e exige tratamento explícito antes de integrar.
