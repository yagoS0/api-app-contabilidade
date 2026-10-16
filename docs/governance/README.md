# Desenvolvimento pelo Orquestrador Principal

O usuário faz pedidos normais ao chat do ALTAN. O agente principal assume a coordenação:
descobre o escopo, aciona executores e juízes, executa testes, devolve reprovações para
correção e apresenta somente a síntese e decisões humanas necessárias. Não é preciso
escolher especialistas, nomear módulos nem executar comandos.

## O que está implementado

`scripts/governance/orchestrate.mjs` é um controlador Node executável. Usa o Codex CLI
autenticado na conta existente, em sessões separadas, com respostas JSON validadas.
Planejador e revisores recebem sandbox read-only; executor recebe workspace-write.
Não escolhe outro modelo, não usa chave API adicional e não habilita bypass/yolo.
Os perfis de `.codex/agents` são incorporados ao contexto de cada papel; o fluxo não
depende de o usuário selecionar perfis ou de descoberta automática da interface.

Fluxo efetivo: pedido → inspeção/planejamento → mapa transitivo → executor → testes
reais do catálogo → juízes dos domínios e técnicos → juiz sistêmico → registro.
Reprovação ou teste falho retorna ao executor com os achados. Há até duas correções,
limite de 40 chamadas e timeout por chamada. O processamento é sequencial por padrão,
com um único escritor. Sem consenso fundamentado, a entrega é escalada ao Principal.
O usuário recebe a decisão concreta que falta, não a tarefa de coordenar agentes.

Arquivos, resultados dos comandos, respostas dos agentes, fontes revisadas e fingerprints
ficam em `.altan-governance/runs/`, ignorado pelo Git. Não publique logs brutos: podem
conter pedido do usuário ou conteúdo do repositório. Uma trava impede dois controladores
na mesma árvore. Após interrupção, o Principal examina o journal e a trava antes de
iniciar nova execução; não há replay automático de ações incertas.

## Entrada automática e permanência

O bootstrap adiciona um bloco gerenciado aos AGENTS.md do workspace e das árvores do
mesmo monorepo, preservando o conteúdo anterior e guardando backups. Ele instrui o
agente principal a chamar o controlador automaticamente. Subprocessos não relançam
o Orquestrador. O usuário pode simplesmente pedir “Corrija a contabilização ao reabrir
uma competência” ou “Adicione um filtro na carteira”.

A instalação local aponta para a árvore canônica da governança. Em outro checkout,
o controlador usa o código desse checkout com mapa/gates canônicos quando ainda não
há cópia integrada. Não mova/remova a árvore canônica antes da integração. Para novos
worktrees locais, o Principal executa o instalador ou conserva AGENTS.md versionado.
Clones em outras máquinas precisam receber a integração da branch; não são alterados
remotamente por esta instalação local. Chats já abertos podem precisar reler AGENTS.md.

Detalhe interno para o Principal (não é uma etapa do usuário):
`node scripts/governance/orchestrate.mjs --request-file <pedido.txt> --root <checkout>`.
O Principal prepara o arquivo fora do código rastreado, escolhe árvore limpa para os
alvos, acompanha os logs e informa progresso. Alterações anteriores fora dos alvos
são preservadas; alvos já modificados precisam de isolamento/conciliação antes da edição.

## Testes e autoridade

`gates.json` relaciona domínios a comandos argv, sem avaliação de comandos retornados
pelo modelo. O controlador executa esses comandos e captura exit code/logs. Falha,
domínio desconhecido, revisão inconclusiva, edição fora do plano ou evidência obsoleta
impede prontidão. Gates de banco exigem PostgreSQL descartável loopback, com nome
terminado em `_governance_test`; o Principal prepara o ambiente quando necessário.
Testes adicionais específicos continuam sendo obrigação dos revisores e do Principal.

`ready_for_human` é conclusão técnica do incremento local, não permissão para merge,
deploy, mensagem, cobrança ou ato fiscal. O registro é derivado do controlador e
validado para o impacto executado; CI do PR ainda deve validar a alteração completa.
Mudanças de política, mapa, gates e configuração são bloqueadas para o executor comum
e tratadas pelo Principal com revisão independente específica. Decisões V01–V08
continuam pendentes; esta arquitetura não aprova regras de negócio.

O sandbox não é autorização operacional. O controlador detecta divergências; não é
uma barreira contra um administrador que altere código/política. Reviewers de IA não
substituem revisão humana exigida para integração de alto risco. Não há merge automático.

## Recursos do Codex e componentes adicionais

Verificado localmente: Codex CLI 0.162.0-alpha.17.2, login ChatGPT, `exec --json`,
`--output-schema`, `--output-last-message`, `--strict-config`, sandbox de leitura e
escrita. A execução real demonstrou leitura e edição por sessões diferentes.
No Windows deste ambiente, Node executado dentro do sandbox pode falhar em caminhos
de perfil (EPERM). Os testes são executados pelo controlador, que já detém a autorização
local, e os revisores inspecionam seus logs. Nenhuma permissão foi ampliada para contornar
esse limite; subprocessos permanecem com os sandboxes definidos.

O Codex fornece sessões, ferramentas e geração de respostas. O ALTAN acrescenta
encaminhamento por dependências, máquina de estados, lock, orçamento, catálogo de testes,
registro de evidências, verificação de versão e ciclo obrigatório rejeição→correção.
Subagentes nativos também estão disponíveis neste chat; foram usados para implementação
e auditoria. O caminho repetível adotado pelo controlador é a API de linha de comando.

Não há um daemon permanentemente acordado: a execução começa a cada solicitação ao
Principal. Não há mecanismo documentado que transforme todos os chats arbitrários do
aplicativo em um único chat obrigatório. A entrada permanente local é AGENTS.md + runtime;
os controles remotos continuam dependendo de rulesets/CI e integração do repositório.

## Validação e ativação remota

`npm run governance:test` verifica o controlador sem chamadas a modelos.
`npm run governance:acceptance -- --fixture-root <diretório-vazio>` executa agentes reais,
injeta uma falha declarada apenas no fixture, exige reprovação entre domínios, correção,
testes finais e juízo sistêmico. Não executa atos do produto nem altera a base real.
O teste de aceitação consome uso da conta Codex; não roda automaticamente em cada CI.

Para enforcement compartilhado: integrar a branch revisada, escolher CODEOWNERS reais,
ativar PR obrigatório/checks/revisão humana/invalidação de aprovação obsoleta e proteger
workflows e ambiente de produção. Essas configurações não foram presumidas nem alteradas.
O documento operacional canônico deve ser conciliado antes de integração em novos clones.

Fontes oficiais verificadas em 16/10/2026:
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/cli/reference
