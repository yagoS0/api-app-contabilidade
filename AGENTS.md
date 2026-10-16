# Interface ALTAN

Ao modificar a interface, siga os tokens e componentes existentes e os critérios de `docs/design-review.md`. Leia as decisões específicas em CLAUDE.md do módulo; decisões posteriores do usuário prevalecem sobre planos antigos.

Verifique pesos tipográficos, textos auxiliares, posição/tamanho de ações, sequência dos campos, separação de seções e responsividade. Preserve consequências, avisos fiscais, estados de erro e acessibilidade. Valide as telas afetadas em computador e celular quando houver mudança de layout.

Há outros chats trabalhando nesta árvore. Preserve alterações preexistentes e evite editar arquivos que estejam sendo alterados em paralelo. O chat de revisão contínua de design acompanha mudanças periodicamente; isso não substitui a validação da própria alteração.


## Governança multiagente do repositório

Antes de editar, leia `docs/governance/README.md`, `docs/governance/POLICY.md`
e a referência operacional indicada em `docs/governance/operational-reference.json`.
Leia também os AGENTS.md e as decisões CLAUDE.md aplicáveis aos arquivos-alvo,
mesmo quando a sessão começou na raiz. Não presuma que arquivos descendentes
foram carregados automaticamente. Instruções explícitas atuais do usuário prevalecem.

Use o mapa `docs/governance/domains.json` e execute
`node scripts/governance/check.mjs plan --base <commit-base>` para levantar impacto.
O mapa é conservador e não substitui rastrear imports, rotas, eventos e consumidores.
Ausência de mapeamento exige classificar o caminho antes de concluir a entrega.

O agente principal atua como orquestrador. Para mudanças funcionais, delegue a revisão
a subagentes independentes dos autores: revisor de domínio, revisores técnicos
necessários e revisor sistêmico quando houver impacto transversal ou risco alto.
Use os perfis em `.codex/agents/`; limite a três subagentes simultâneos e duas rodadas
de correção. Se a ferramenta não estiver disponível, declare revisão independente
pendente; não simule outros agentes. Não crie chats do usuário para delegar tarefas.
Um único agente escreve em cada arquivo por vez. Revisores somente inspecionam.

Registre objetivo, risco, domínios, regras afetadas, evidências, rollback e pendências
em `docs/governance/changes/<identificador>.json`. Um parecer técnico não autoriza
deploy, merge, mensagens, custos externos, atos fiscais ou alterações de produção.
Autorização já concedida para a ação concreta não precisa ser pedida novamente.
Prepare e valide tudo que independe de uma decisão antes de apresentá-la ao usuário.

Não alterar esta política para aprovar a própria entrega. Mudanças de governança
recebem revisão sistêmica e precisam da mesma revisão humana da integração.
Nenhuma regra operacional do produto é modificada pela adoção desta governança.

<!-- ALTAN-PRINCIPAL-ORCHESTRATOR:START -->
## Orquestrador Principal — fluxo permanente autorizado

O usuário conversa exclusivamente com o agente principal. Para pedidos de desenvolvimento
do ALTAN, o agente principal assume automaticamente a função de Orquestrador Principal;
não pede ao usuário para selecionar especialistas, caminhos, testes ou coordenar etapas.
Esta instrução autoriza acionar subagentes para executar e julgar o trabalho.

Antes de alterações funcionais, o principal lê a referência operacional e inicia o
controlador executável: node "scripts/governance/orchestrate.mjs" --root "<checkout de trabalho>" --request-file "<arquivo com o pedido>".
O próprio principal prepara o arquivo do pedido e escolhe uma árvore de trabalho
adequada, preservando alterações existentes. Não é tarefa do usuário executar comandos.
Se o checkout já contém scripts/governance/orchestrate.mjs, prefira esse runtime local
versionado; o caminho canônico acima serve de fallback para árvores ainda não integradas.
O controlador descobre escopo, aciona executores/revisores, executa os gates e retorna
reprovações ao executor. Somente o principal explica resultados e decisões ao usuário.
O principal acompanha o processo/logs, responde dúvidas e trata falhas ou limites.

Esta inicialização aplica-se SOMENTE ao agente principal que recebe a solicitação.
Se você é subprocesso/delegado/revisor do controlador ou recebeu uma tarefa delimitada,
execute somente seu papel: não relance o controlador, não delegue e não peça ao usuário
que coordene etapas. Alterações da própria governança exigem fluxo separado com revisão
independente pelo principal; o executor não pode mudar os gates para aprovar a si mesmo.

ready_for_human significa validado tecnicamente na versão indicada; não autoriza merge,
deploy, dados reais, mensagens ou atos fiscais. Preserve autorizações já concedidas
para o escopo concreto. Em falha, não simule aprovação nem contorne permissões.
Instruções operacionais e decisões atuais do usuário continuam prevalecendo.
<!-- ALTAN-PRINCIPAL-ORCHESTRATOR:END -->
