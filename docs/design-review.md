# Revisão de design ALTAN

Este chat é dedicado à revisão de design a pedido do usuário em 13/10/2026. O padrão é o existente na aplicação, com prioridade para decisões posteriores registradas nos CLAUDE.md e para os tokens atuais. O apêndice antigo de cores em plano-mestre.md não substitui styles/tokens.css.

## Critérios para toda alteração de interface

- Hierarquia por espaço, tamanho e peso: corpo 400, navegação/rótulos 500–600, títulos 600. Evitar negrito em todos os elementos e caixa alta sem necessidade.
- Texto auxiliar só quando muda a decisão ou evita erro. Remover paráfrases do título e instruções óbvias; explicações longas consultivas podem ser recolhíveis. Manter consequências, custos, estados incertos, erros, confirmações e instruções necessárias visíveis.
- Uma ação primária por contexto de trabalho. Ações secundárias neutras; perigo na confirmação. Ações de seção próximas à seção; ações de formulário depois dos campos, na mesma ordem visual e de teclado.
- Usar Button, Painel, Modal e tokens existentes. Botões compartilhados: pequeno 32px, médio 40px, grande 44px, crescendo para acomodar texto. Alvos móveis precisam de espaço suficiente; não encolher o texto para caber.
- Campos com rótulos persistentes e sequência lógica. Agrupar assuntos com título e espaçamento/divisor; evitar grades com mínimos fixos que estouram o celular.
- Formulários usam largura de leitura; tabelas usam largura de trabalho. Rolagem horizontal, quando necessária, fica na tabela.
- Preservar foco visível, navegação por teclado, labels, erros e estados vazios. Nunca esconder problemas de layout com overflow global.
- A aparência não muda payload, cálculo, autorização, confirmação ou serviços externos.

## Acompanhamento neste chat

Automação `revis-o-cont-nua-de-design-altan`, horária. Detecta alterações acumuladas; não é um gancho instantâneo de cada salvamento. A revisão considera commits e arquivos não commitados. A base atual é `api-app-contabilidade`, mas worktrees do mesmo repositório também devem ser considerados.

Execute `node scripts/design-review-snapshot.mjs` para comparar os hashes com a observação anterior. O primeiro uso apenas estabelece o inventário. Após analisar os resultados, execute com `--save` para registrar a observação, mantendo pendências neste documento. Hash observado não significa tela homologada. O estado fica em `test-evidence/design-review-state.json` (ignorado pelo Git). Para outro worktree, execute o mesmo script com o diretório dele como argumento; cada árvore guarda seu próprio estado.

Não sobrescrever arquivos em edição ativa de outro chat. Registrar a pendência e revisar quando estabilizarem. A revisão recorrente avisa sobre correções, regressões relevantes, falhas ou decisões necessárias; não repete relatório sem mudança.

## Revisão inicial — 13/10/2026

Quatro agentes revisaram os componentes compartilhados, configurações, cadastro/cofre/perfil fiscal, notas, documentos/guias, comunicação, conferência/recorrências, plano de contas/rotinas/pendências e portal do cliente. Correções locais, ainda sem publicação.

Mudanças principais: tamanhos de botões e quebra de ações; grade móvel do cadastro; restauração dos fundos de Conferência por tokens válidos; endereço em sequência lógica; separação dos campos e ações no cofre e cadastro fiscal; posição da engrenagem em Notas; navegação de configurações sem duplicação; parâmetros SERPRO avançados recolhíveis; menos legendas repetidas; estados/configurações com pesos e cores discretos; formulário de extrato separado das ações.

Validação e capturas: `test-evidence/design-layout/`, geradas por `apps/web/scripts/verify-design-layout.mjs` usando somente servidor local em modo mock e bloqueio de rede externa. Os testes de tokens agora recusam qualquer token sem definição, sem a antiga exceção para fundos transparentes.

Conferência visual aprovada em 1440 e 390 px para oito páginas: configurações, atendimento, cadastro, SERPRO, plano de contas, rotinas, comunicados e planejamento. Sem vazamento horizontal da página, campos fora de contêineres alcançáveis ou erros JavaScript. Tabelas de Rotinas mantêm rolagem local deliberada. Comunicados foi conferido no estado de demonstração indisponível; não é validação visual do formulário conectado.

Portal: seis capturas em `test-evidence/design-portal/` cobrem Extrato, painel indisponível e painel com dados em 1440 e 375 px; sem overflow, CTA de 44px. Suítes dirigidas de estilos, Conferência/Recorrências, cadastros/perfil fiscal, Notas, Configurações/SERPRO, Guias/Documentos/Comunicados, Extrato, Plano de contas/Rotinas e campos de Planejamento passaram. Builds web e portal passaram com avisos de tamanho de bundle/imports mistos já existentes. A suíte completa do portal não foi concluída; não contabilizá-la como aprovada.

A captura do painel indisponível revelou texto destinado ao contador na tela do cliente. A mensagem foi corrigida exclusivamente para `portalCliente` e código `CONTABILIDADE_ABERTA`, orientando selecionar período encerrado e aguardar o escritório. Sete testes do painel passaram, inclusive resposta rejeitada, `ok:false` e preservação de outros erros. As capturas anteriores de painel indisponível documentam o achado original; não representam o novo texto. A lógica de disponibilidade não mudou.

Limites: a revisão de código não equivale à inspeção visual de todos os estados, modais e permissões. O onboarding/comercial está em edição concorrente e deve ser revisado depois de estabilizar. Fluxos fiscais externos e produção não foram exercitados. Não marcar a aplicação inteira como homologada com base apenas nos testes dirigidos.
