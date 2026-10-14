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

## Apuração — hierarquia e texto, 14/10/2026

Pedido do usuário: apuração confusa e com texto demais. Revisão em árvore isolada baseada na main538ae2b, preservando alterações concorrentes do cadastro fiscal, regime do LP e backend no checkout de desenvolvimento.

Lista: filtros com rótulos, seleção/lote em área própria, contagens compactas sem cartões redundantes, instrução de preparação recolhível e estados de erro/carregamento explícitos. Tabela conserva rolagem local e abertura da empresa pelo teclado.

Empresa: competência/estado separados das ações; valores com peso moderado; referências/fórmulas consultivas recolhíveis. Relatório mantém origem, foto salva, limitações, ausência de valor e diferença entre cálculo local e Receita. Classificação separa motivo/ação da explicação e metadados. Fechamento/lote usam Modal compartilhado, preservando bloqueio durante operação e recuo da confirmação por Escape. LP mantém enquadramento, avisos e bases fiscais, com campos agrupados e tabela contida no celular.

Critério para futuras alterações: informações necessárias à decisão ficam visíveis; explicações gerais ficam sob demanda. Não repetir o mesmo total ou contexto em cartões/legendas. A próxima ação deve estar separada do diagnóstico e do material de referência. Não alterar cálculo, payload, autorização ou consequência fiscal para simplificar o visual.

Validação local: suíte apuracao+tokens com 33 suítes/378 testes aprovados antes dos últimos refinamentos visuais; testes dirigidos adicionais e build registrados nos relatórios locais. Capturas sintéticas desktop/celular em test-evidence/design-apuracao*, com limites por estado. Não houve consulta SERPRO, transmissão, pagamento ou mutação fiscal real. Capturas não equivalem a homologação integral de todas as combinações.

## Comparação tributária — 14/10/2026

Após a integração do PR181, a revisão preservou a comparação e o Fator R em um único expansível, inicialmente recolhido e identificado como Simulação, para não deslocar o relatório da apuração. Recolher mantém campos e resultados montados. RBT12 parcial aparece antes do Fator R; consequências e limitações continuam visíveis quando o estudo é aberto. Frases positivas idênticas por anexo foram removidas; motivos de indisponibilidade e tributos não considerados permanecem. Tabela com rolagem local e região acessível pelo teclado; campos e grades contidos no celular. Cálculos, dados, APIs e critérios de comparação inalterados.

Validação: 4 suítes/13 testes dirigidos aprovados, incluindo preservação de campos e resultados ao reabrir. 16 capturas sintéticas (390/1440): recolhido, Fator R, comparação, RBT12 parcial/ausente, exportação, ISS inválido e integração na aba real. Sem overflow de página ou erros JS; amostras inspecionadas. Evidência em test-evidence/design-comparacao. Sem consultas fiscais ou transmissão real; não representa homologação de todas as combinações fiscais.

## Planejamento e Situação fiscal — complemento de 14/10/2026

Pedido posterior do usuário ampliou a rodada da comparação. Planejamento: ações de abrir/salvar e nome do cenário depois das premissas, alterações não salvas e desfecho permanecem visíveis; seção Lucro Real identificada, pesos/tokens padronizados, grades/valores/tabelas contidos no celular. Nenhum motor, hook ou regra de cálculo alterado.

Situação fiscal: consulta e atalho de recálculo no cabeçalho; PDF na área do relatório salvo; datas adicionais recolhíveis; filtros com labels e ações de adicionar nomeadas pela origem. Estados de carga/erro anunciados; permissões de edição preservadas. Corrigida fuga horizontal do texto acessível da coluna de ações com ancestral posicionado no scroll local e largura da célula Detalhes; alvos móveis de 44px. Avisos de consulta paga, prazo de 4h, leitura salva, relatório antigo e possível e-mail no recálculo permanecem.

Evidências locais: design-planejamento (aba empresa com dados sintéticos e detalhes das ações) e design-sitfis-layout (salvo/vazio/carregando/erro/bloqueio/leitor/antigo/aviso, 390 e 1440). Sem overflow de página/erros JS nos estados finais. Suítes dirigidas passaram; execução combinada e build em test-evidence. Não houve consulta SERPRO, recálculo ou envio real. Cobertura sintética não certifica todas as permissões/desfechos em produção.

## Estados restantes de chat, Planejamento e Situação fiscal — 14/10/2026

Continuação multiagente sobre main37a635fd. Modal compartilhado: título600, quebra de títulos longos, botão Fechar32px no computador e44px no celular com foco visível. Chat: estado vazio da biblioteca sem mensagens duplicadas/instrução administrativa para perfil desconhecido; consumo indica carga, permite nova tentativa e identifica valores preservados como leitura anterior; nota interna explica bloqueios de permissão, serviço ou ausência de escopo sem modificar autorização.

Planejamento: salvamento sinaliza andamento, recusas conhecidas usam texto legível, erro anunciado como alerta, nomes longos contidos na lista. A falha ao guardar PDF mantém explícito que o cenário já foi salvo. Abrir/salvar são controles inline; não existe ação de excluir cenário neste consumidor. Situação fiscal: identificação do imposto antes de competência/valor/vencimento/descrição; seleção parcial de uma fonte no PDF tem checkbox intermediário; ação Excluir neutra antes da confirmação de perigo. Preservadas fontes vazias exportáveis, avisos de duplicidade, custos e permissões.

Evidências locais desta rodada: test-evidence/design-chat-estados, design-planejamento-estados e design-sitfis-modais, com componentes reais e dados simulados em390/1440. Os relatórios locais discriminam estados, testes e limitações. Não houve consulta fiscal, recálculo, envio ou autenticação de perfis reais em produção; a revisão não representa homologação de todas as combinações de dados e serviços externos.

Situação fiscal também traduz recusas conhecidas do middleware na apresentação, conservando mensagens humanas de validação/conflito. Validação dirigida: chat22 testes, Planejamento24, Situação fiscal22 e compartilhados/tokens37, com conjuntos possivelmente sobrepostos.62 capturas (14chat,18Planejamento,30Situação fiscal), sem overflow nos estados finais; inspeção direta amostral e detalhes nos relatórios locais. Um teste antigo longo de Planejamento excedeu15s sob concorrência; repetição com limite20s passou sem alterar asserções. Build web aprovado; CI da publicação valida o conjunto final.

## Continuação nos demais módulos — 14/10/2026

Base main2d9eeb12, revisão multiagente. Estorno de baixa migra do overlay próprio para Modal compartilhado: foco, Escape, retorno, rodapé persistente e bloqueio enquanto grava; valores deixam de ficar escondidos no celular. Pagamentos provisionados preserva tabela no desktop e apresenta campos empilhados no celular. Recusas conhecidas são legíveis, mantendo orientações específicas do servidor. Motivo, prévia, totais, confirmação e autorização contábil não mudam.

Agenda/obrigações bloqueiam edição de campos durante gravação; as ações das obrigações longas ficam no rodapé do modal e submetem o formulário correto. Grades contidas e retorno ao alcance individual secundário. CalendarioObrigacoesModal sem consumidor vivo fora de testes não foi reconectado. Guias: correções de valor/competência com valores antes/depois, estado ocupado e recusas legíveis. Importação de notas mantém processamento em segundo plano e avisos, com resultados longos legíveis.

Documentos/anotações: confirmações suportam nomes longos, downloads nomeados, carga anunciada, ações móveis e exclusão neutra antes de confirmar. Extrato do cliente encaminha foco ao resultado; tabelas de recusadas/descartadas usam espaçamento padrão e rolagem local por teclado. Papéis e escopos continuam determinados pelos consumidores/servidor; não criar capacidades por inferência visual.

Testes dirigidos e builds web/portal aprovados, com avisos existentes de bundle. Evidências locais: design-agenda-estados (16 capturas), design-guias-notas-estados (24), design-documentos-extrato (22) e accounting-confirmacoes, em390/1440. Relatórios discriminam estados e limites; inspeção direta amostral e medição de overflow/erroJS. Sem consulta, estorno, importação, envio ou autenticação real por papel em produção. Permissões simuladas não homologam todas as combinações de serviços externos.

Pendência de concorrência: nova organização de apuração/Planejamento no worktree altan-rbt12-release (HEAD7cd4f5d8 mais arquivos não commitados) estava em edição durante esta rodada. Preservada e pendente de revisão após estabilização; não faz parte desta publicação.

## Rotinas, Apuração e Consultas — continuação de 14/10/2026

Base main4ce50f72 (PR186). A estrutura posterior de Apuração foi revisada e preservada: ações junto da competência, tabela de anexo aberta, Fator R e comparativo. A pendência acima está superada para os componentes de Apuração examinados nesta rodada. Classificação por nota apresenta dados e seletor em blocos no celular; ações secundárias deixam de competir com Aplicar seleção. Acompanhamento do lote distingue carga, recusa, erro de atualização e resultado ainda desconhecido, sem disparar transmissão ou alterar polling.

Rotinas separa agenda, empresas e execução manual; agenda empilhada no celular, pesos e tokens consistentes, controles bloqueados durante salvamento. Corrigida orientação contraditória sobre dias inexistentes: o worker não executa naquele mês. Mantidos configuração salva, custo externo e ausência de repetição automática. Consultas coloca execução após parâmetros/empresas, simplifica textos e nomeia campos/estados. Falha na leitura do histórico de captura oferece somente releitura do histórico, sem criar nova captura.

A pedido explícito do usuário, removida a aba Guias não identificadas, seu componente, estados/handlers e métodos de cliente exclusivos. A URL antiga redireciona para Empresas; navegação não oferece o destino. Upload de guias na empresa e registros fiscais existentes permanecem. A remoção da aba não apaga dados do banco nem muda contratos backend.

Evidência local: 78 testes de navegação/rotas aprovados, inclusive URLs antigas; testes dirigidos dos três módulos e build web aprovados. Capturas de componentes reais com dados simulados em390/1440, relatórios design-rotinas-coverage.md, design-apuracao-classificacao-coverage.md e design-consultas/coverage.md. Permissões exercitadas como recusas simuladas; nenhuma consulta paga, transmissão ou mutação fiscal real. LP teve revisão estática sem mudanças. Os relatórios registram os estados efetivamente conferidos e não representam homologação de todas as combinações externas.

## Históricos, novo parcelamento e estados de Planejamento — 14/10/2026

Continuação multiagente após PR187. Históricos mantém tabela no computador e apresenta cada registro em campos no celular, sem exigir rolagem lateral para editar contas. Nomes completos, escopo neutro, ações compartilhadas e estado de gravação legível; filtros indicam seleção. Preservados handlers, alcance global/empresa e exclusão existente.

Novo parcelamento usa Modal compartilhado, com foco, retorno ao gatilho e confirmação de descarte que preserva o rascunho. Durante gravação, campos e saídas ficam bloqueados. Grades se adaptam à largura e textos/cores seguem tokens. Avisos de custo, memória global, composição e consequência contábil permanecem. Recusas conhecidas são legíveis; regras, cálculos e payload não mudam.

Planejamento conserva a estrutura posterior do PR186: cenários legíveis e alvos móveis, comparação com região acessível pelo teclado, geração do relatório com estado ocupado anunciado. Lista, gravação recusada, PDF de Documentos recusado após salvar e erro de impressão local foram exercitados com serviços simulados. Não houve nova homologação das páginas internas do PDF.

Evidências locais em historicos-estados (14 capturas), historicos-acoes (8), design-wizard-estados (18) e design-planejamento-periodo (22), nas larguras390/1440, com componentes reais e rede externa bloqueada. Promoção de histórico para Global também sinaliza gravação na linha afetada; recusas mantêm o registro. Sem overflow de página ou erros JS nos estados capturados, com inspeção visual amostral. Testes dirigidos e build web aprovados; relatórios locais discriminam limites e revisões posteriores. Permissões simuladas não equivalem à autenticação de todos os papéis em produção. Nenhuma gravação contábil, consulta fiscal ou emissão real foi realizada na validação.

Após integração do PR188, o aviso de pendências preserva o bloqueio da navegação durante transmissão. Sua ação de nova tentativa usa Button compartilhado com alvo44px e quebra de linha. O aviso fiscal e a leitura de pendências não mudam.
