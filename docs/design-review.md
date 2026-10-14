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

## Segunda publicação de design — 13/10/2026

Revisão sobre a main atual após onboarding e atendimento, em checkout isolado. Inclui chat (estados legíveis, espaço das ações, prévia de anexos, canal preparado), cadastro de sócios/histórico com nomes acessíveis, grade móvel de parcelamentos, autocomplete contido, remoção da ação duplicada de parcelamento, Button da recuperação de sessão, estado vazio de upload sem duplicação, filtros responsivos do Laboratório e foco da confirmação de pagamento no portal.

Pendências do onboarding tratadas nesta publicação: seção complementar mantém abertura durante correção; folha/pró-labore usam os controles e agrupamento do modal; conciliação separa respostas legíveis de ações curtas neutras. Regras fiscais, envio, confirmação e payloads permanecem preservados.

Cobertura: revisão multiagente dos pontos de entrada de todos os módulos, testes dirigidos e CI da publicação. Chat e anexo conferidos em 1440/390 px com mock e rede externa bloqueada. A cobertura de inventário não implica homologação de todas as combinações fiscais, permissões ou estados de serviços externos. A revisão contínua acompanha futuras alterações e os estados que ainda não tenham evidência visual.

Validação final do onboarding: 34 suítes/266 testes aprovados; seis capturas dos estados de correção, conflito e conversão em 390/1440 px, sem overflow ou erros JavaScript. Fixtures e dados fictícios permanecem locais.


## Modais, seleção e suporte — 14/10/2026

Continuação multiagente sobre `061e7c8`, branch `codex/design-modais-suporte-20261014`. A solicitação desta rodada também autoriza corrigir o funcionamento da leitura e das demandas de suporte.

- Barra da seleção: operações separadas dos arquivos, limpeza no cabeçalho, ações neutras e disposição móvel. A prévia usa Modal compartilhado, começa pelos avisos fiscais e devolve foco ao gatilho ao fechar. Exportação CSV: períodos agrupados, empresas selecionadas em detalhe expansível, resultados separados e uma ação primária por etapa.
- Suporte: leitura confirmada invalida imediatamente lista e resumo; resposta antiga em voo não restaura contagem. Demandas encaminhadas têm Aceitar e Excluir demanda com confirmação; exclusão arquiva apenas a demanda indicada, preserva conversa/histórico e não envia mensagem nem reativa IA. O contador da fila atualiza após ação confirmada, independentemente do contador de mensagens não lidas. Permissões, carteira e disputa de atendente são verificadas no servidor.
- Certificado A1, exclusão de empresa e Excel: revisão de legibilidade, rótulos, avisos, rolagem, botões e comportamento de diálogo. Notas: estados de progresso e pendência inspecionados. Cofre: login longo deixa de alargar a página no celular; rótulos/avisos legíveis. Atividade fiscal não salva mantém consequência visível.

Evidência local: `test-evidence/design-selection/` (barra, prévia, carregamento, erro, vazio e CSV, 390/1440 px); `design-modais-cadastro-coverage.md`; `design-cofre-portal-coverage.md`; `design-suporte/` (fila, aceite, confirmação, erro e vazio). Componentes reais com dados simulados e rede externa bloqueada; nenhuma execução fiscal ou envio real. Scripts/fixtures `.local` não integram o produto.

Cobertura do portal nesta rodada: confirmação de cancelamento inicial/erro/ocupado e gaveta do dia vazia. Cobertura fiscal: bloco de atividades, vazio/carregando/erro/perfil derivado não salvo. ServiçosTributação, CadastroReforma e demais combinações de dados/permissões/serviços externos continuam pendentes de evidência visual. Inventário de módulos revisado não equivale à homologação visual de todos os estados da aplicação.

Validação desta rodada: suíte completa WhatsApp (38 suítes/310 testes), seleção/exportação (33 testes), tokens (14), modais/Excel/fila (42), backend de conversas/encaminhamentos (121), cofre/perfil (46) e portal (91), todos aprovados. Contagens de conjuntos dirigidos podem se sobrepor; não somar como total único. Build web aprovado, com avisos existentes de bundle/imports mistos.

## Continuação dos estados e modais — 14/10/2026

Base publicada: PR175/main3ad4ccc. Nova revisão multiagente em `codex/design-estados-restantes-20261014`, autorizada pelo usuário para publicação após validação.

Correções: captura de guias empilhada no celular, com campos/ações legíveis; classificação fiscal, procuração e modais contábeis usando Modal compartilhado; textos longos de notas e códigos fiscais visíveis; tabela de pendências com rolagem local; campo de reabertura padronizado; exportação SITFIS responsiva; sugestões fiscais com hierarquia discreta; estado vazio explícito da sugestão IA. Resumo de serviços fiscais recolhível evita repetir a lista do editor e avisos. Portal encaminha foco ao desfecho da emissão e à confirmação do lote, restaurando ao cancelar.

O padrão de teclado preserva contratos específicos: OFX continua sem fechamento por Escape; sugestões de conta consomem o primeiro Escape antes do diálogo. Confirmações sobrepostas suspendem o modal de origem. Avisos de consequências fiscais, custos, resultados incertos, escopos/permissões e confirmações continuam preservados. Nenhuma alteração de cálculo/payload fiscal, migration ou chamada externa de teste.

Evidências locais detalhadas: `test-evidence/design-fiscal-restante-coverage.md`, `design-fiscal-modais-coverage.md` e relatórios das frentes portal/serviços/accounting. Componentes reais com mocks, capturas em 390/1440 e rede externa bloqueada. Esta rodada inclui estados antes não vistos de emissão, fiscal, lote, serviços/reforma, notas/guias/SITFIS, agenda/obrigações/conferência e modais contábeis. Estados iniciais não homologam todas as permissões/combinações e nenhum teste representa emissão/transmissão fiscal real. Visualizador PDF nativo com documento real permanece fora da evidência visual; erro/carregamento foram cobertos. ReabrirCompetenciaModal órfão não foi reconectado: revisão foi no diálogo vivo de renderAuditoriaTab.

Validação central: 62 suítes/1080 testes de apuração-v2/calendário/obrigações/conferência, mais 11 testes dirigidos após ajuste do estado vazio da IA; builds web e portal aprovados com avisos existentes de bundle/imports mistos. As frentes registram testes adicionais, com contagens possivelmente sobrepostas. Fixtures `.local` e screenshots não fazem parte do pacote de produção.


## Permissões e modais pendentes — 14/10/2026

Base651e522, branch codex/design-permissoes-modais-20261014. Revisão multiagente autorizada para main/produção. Modais de exclusão/desfazer de parcelamento, composição declarada e guia de parcela migrados ao Modal compartilhado, com foco/retorno, suspensão da origem durante confirmação e campos bloqueados ao salvar. Tabelas, filtros e prévias contábeis ajustados para celular; mensagens de recusa de acesso traduzidas sem conceder permissões.

Correção do inventário anterior: AtoParcelamentoModal e DeclararComposicaoParcelaModal ainda tinham overlays próprios; a afirmação anterior de que todos os pendentes já usavam Modal não era sustentada pelo código. A migração ocorreu nesta rodada.

SITFIS agora apresenta Adicionar/Editar/Excluir registros manuais somente para ACCOUNTANT/FIRM_ADMIN, conforme a regra existente do servidor. Consulta e exportação permanecem disponíveis; papel ausente não habilita edição. Falha de leitura deixa de afirmar ausência de lançamentos. Teste do consumidor cobre VIEWER, ACCOUNTANT, FIRM_ADMIN e papel ausente. Auditoria conferida em consulta/contador/admin, sem mudança de regras.

Acesso do cliente ao portal: confirmação padronizada, motivo de bloqueio visível, aviso de recarga com dados preservados, foco no resultado de senha fictícia. Gates dos deep links de contatos/certificado testados sem montar editores restritos. App usa sessão admin/contador para canEditCompany; não confundir com o papel do cliente listado. Portal: ordem de campos e ação Entrar, foco na recuperação/redefinição e ao alterar e-mail; estados de empresa/sessão/acesso negado e papéis do cliente verificados com mocks.

Evidências locais: design-accounting-permissoes-coverage.md, design-fiscal-permissoes-coverage.md, design-acessos-permissoes-coverage.md e design-portal-acesso-coverage.md em test-evidence. 176 capturas (74 contábeis incluindo detalhes,30 fiscais incluindo PDF fictício,26 acessos,46 portal), larguras390/1440; medição sem overflow/erroJS e inspeção direta de amostras. Nenhuma operação fiscal, autenticação ou troca de senha real foi executada. PDF local fictício conferido; não equivale à compatibilidade de todos os PDFs reais.

Validação: accounting7suítes109 testes, fiscal7suítes64, portal5suítes14; central14suítes119 (SITFIS/guias/senha/tokens) e9suítes127 (acessos/configurações, antes teste adicional de revogação). Conjuntos se sobrepõem. Builds web/portal aprovados com avisos existentes de tamanho/imports mistos. CI completo verificado na publicação.

Limites: matriz de permissões é da interface e dos consumidores; não representa autenticação real de cada papel em produção nem homologação integral dos serviços externos. Sessão revogada durante chamada real, todas as combinações de dados, sucesso parcial de cada operação fiscal e estados restantes de guias/conciliação/extrato continuam fora desta evidência. Fixtures e screenshots não integram o produto.


### Estrutura do chat — continuação solicitada pelo usuário

O usuário relatou confusão acumulada no chat. A revisão visual confirmou o texto Atendimento esmagado em44px inclusive no desktop, retorno ao chat preso em38px, administração misturada no rodapé e dados do contato depois da jornada comercial inteira.

Reorganização: busca/lista antes da fila, Opções reúne administração/biblioteca/consumo preservando reservas e estimativas; offline permanece visível. Painel separa Atendimento de Contato e mantém formulários montados/rascunhos ao alternar. Cabeçalho usa botão textual no desktop e ícone acessível no celular. Ferramentas mostram canal antes das ações e Escape devolve foco ao botão+, sem desmontar envios pendentes. Motivos de bloqueio repetidos são agrupados e associados aos botões. A interface não envia mensagens automaticamente nem muda o contexto fiscal para resolver layout.

Manutenção: acrescentar cada controle na área correspondente (conversa; mensagem/arquivos; atendimento/contato; opções administrativas). Evitar novas faixas permanentes, ações duplicadas e texto auxiliar que repete o controle. Avisos de autorização, confirmação, destino alterado, resultado incerto e offline continuam visíveis; não recolher erros obrigatórios para limpar a tela. Componentes de envio e atendimento não devem perder estado ao recolher.

Evidência adicional:22 capturas em390/1440 (8 suporte full-app mock,8 fio compartilhado em contêiner da empresa,6 contexto comercial com componentes reais e API simulada), sem overflow horizontal/errosJS. Inspeção direta incluiu conversa, opções, ferramentas móveis e Contato. A fixture comercial cobre o estado inicial, não todas as etapas de contratação. Relatório local design-chat-contextos-coverage.md e resultados design-chat-structure. Suíte completa WhatsApp+tokens:43suítes331 testes aprovados; build web aprovado. Nenhum envio externo nos testes.
