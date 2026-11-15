# F1 — revisão 3: B adotada como direção, homologação pendente

**O usuário escolheu a Alternativa B — Área de Trabalho Focada.** Essa decisão aprova a direção visual/operacional, não homologa a F1 nem autoriza implementação funcional, integração ou publicação. Esta revisão atende ao [comentário técnico do PR #287](https://github.com/yagoS0/api-app-contabilidade/pull/287#issuecomment-6898377856) e ao pedido de finalização recebido em 15/11/2026.

Referência anterior: `84c550317cb04c661f14252a1f240ef40cd87dd1`. Mesma branch/worktree. O [plano técnico F0/F2–F6](../modules/plano-diretor-operacoes-apuracao.md) permanece **sem alteração** nesta revisão. Não iniciar P1/P2.

## Abrir a proposta atual

- [B refinada — protótipo navegável](plano-operacoes-b.html).
- [Comparação lado a lado com Operações real](comparacao-operacoes-b.html).
- [Validação automatizada e cenários medidos](evidencias-plano-operacoes-apuracao/f1-r3/validacao.json).
- [Alternativas R2 — histórico](comparacao-operacoes-f1.html). A não continua evoluindo.

Abrir os HTMLs no checkout, preservando os caminhos dos estilos/fontes, ou servi-los por HTTP somente em loopback na raiz. As interações são demonstrativas e sem API. Não existe execução fiscal, gravação de cadastro ou envio. A CSP bloqueia conexões externas.

## Referência visual obrigatória

Inspecionados o App real em `/companies?visao=operacoes&competencia=2026-10`, com Vite mock e sessão sintética, [OperationsPage](../../apps/web/src/features/operacoes/OperationsPage.jsx), [operacoes.css](../../apps/web/src/features/operacoes/operacoes.css), [OperationsCalculationDetails/TransmissionTable](../../apps/web/src/features/operacoes/OperationsCalculationDetails.jsx), [OperationsRoutineCompanies](../../apps/web/src/features/operacoes/OperationsRoutineCompanies.jsx), [instruções da Apuração](../../apps/web/src/features/apuracao-v2/CLAUDE.md), [norma arquitetural](../governance/ARQUITETURA.md), [design](../design-review.md), [DESIGN_SYSTEM](../../DESIGN_SYSTEM.md) e [UX_RULES](../../UX_RULES.md).

A composição real tem três containers, quatro distribuições e Rotinas como faixa horizontal; os overrides finais do CSS prevalecem sobre a antiga sidebar. A proposta preserva essa estrutura no resumo. Durante a tarefa, compacta os três containers e recolhe distribuições/rotinas temporariamente.

| Elemento | Decisão R3 |
| --- | --- |
| Containers | Apuração · Simples Nacional; Guias e pagamentos; Contabilidade. Rótulos propostos não alteram rotas ou contratos. |
| Indicadores | A calcular, A conferir, Confirmadas e Transmitidas. Identificação da etapa ativa e áreas móveis de pelo menos44px. |
| Trabalho principal | Tabela contextual; não criar página independente de Apuração. |
| Conferência | Área ampla na mesa de trabalho, com organização baseada na Apuração existente. Nenhum modal pequeno para toda a conferência. |
| Retorno | Resumo e mesma etapa preservam busca, seleção e origem compatíveis. Detalhe retorna ao gatilho e à posição da lista. |
| Guia/Contabilidade | Fatos e fluxos mantidos; ações do protótipo apenas explicam que permanecem fora da revisão visual de Apuração. |

As capturas do App atual e da proposta usam **dados sintéticos diferentes**. A comparação é de estrutura e experiência, não paridade numérica. Nenhuma tela produtiva foi acessada.

## Contexto permanente e navegação

O cabeçalho da tarefa permanece visível durante a rolagem: **competência, etapa, abrangência, quantidade selecionada, origem, capacidade e Voltar ao resumo**. O nome da empresa fica no título da conferência. O cabeçalho adapta-se ao celular; âncoras consideram sua altura para não encobrir o destino.

Contrato de navegação demonstrado:

- Mesma etapa, competência e capacidade: voltar ao resumo e reabrir preserva busca e seleção.
- Abrir detalhe para inspeção não transforma a seleção coletiva em comando da empresa aberta. Retornar conserva a seleção original.
- Preparar prévia individual define explicitamente somente a empresa do detalhe como alvo, substituindo a seleção incompatível.
- Trocar capacidade limpa seleção/prévia e informa o motivo; a busca atual pode continuar, sem ampliar o conjunto.
- Trocar competência limpa seleção, filtros e memória das etapas; setembro é **sem amostra**, não zero nem reutilização dos dados de outubro.
- Etapas mantêm conjuntos separados; voltar a uma etapa recupera somente seu contexto compatível. Nenhuma seleção é mesclada silenciosamente.
- Filtros mostram quantas empresas selecionadas ficaram fora da busca. Preparação usa somente os IDs selecionados.

Essas são interações do protótipo. Na implementação futura, servidor revalida autorização, revisão, empresa, capacidade e consistência; a memória da UI não substitui esses contratos.

## Tabela, seleção e origens

Colunas: seleção, empresa/competência/regime, situação/origem, resultado disponível, pendência/elegibilidade e próxima ação. No celular, a mesma informação fica em linhas empilhadas com seleção e Conferir. Resultado ausente não vira zero; motivo de elegibilidade é específico da capacidade.

O lote diferencia elegíveis, impedidas e **não avaliadas nesta amostra**. Não inventar bloqueio quando a fixture não demonstra a decisão. A leitura local de uma empresa sem procuração não é confundida com autorização para consulta SERPRO. Os valores de elegibilidade são apenas fixtures de apresentação e não devem ser copiados como política fiscal.

Origens:

| Origem | Demonstração | Limite |
| --- | --- | --- |
| Individual | Prévia da empresa aberta, alvo único e contexto explícito | Sem executar ou aprovar revisão |
| Manual em lote | Seleção explícita, elegíveis/impedidas/não avaliadas e retorno por empresa | Sem ampliar seleção ou ignorar impedimentos |
| Agendada | Mesmas capacidades, origem da agenda e condições por empresa | Configuração não ativa rotina, transmissão ou recuperação |

Futuramente as origens deverão coordenar os mesmos casos de uso, com identidade/autorização próprias. O atalho de cálculo atual pode chamar o SERPRO; o novo layout não o renomeia como cálculo puramente local. O contrato atual de lote não recebe seleção explícita: sua evolução continua condicionada ao planejamento técnico.

## Conferência e pendências

Horizonte demonstra: notas e receitas → anexo/fundamentação → Fator R/FS12/RBT12 → alíquotas/valores → comparação e divergências → evidências PGDAS-D → aprovação e histórico. Fontes, vigências, alíquotas e resultado que não existem na amostra são **indisponíveis**, sem inventar enquadramento ou imposto. Nenhum motor é implementado no protótipo.

A aprovação exige a revisão vigente pelo fluxo existente; a ação fica indisponível na amostra com folha incompleta. Na futura implementação, reutilizar componentes/casos de uso reais; não duplicar conferência ou motor.

Cada ocorrência mostra empresa/competência, o que aconteceu, causa comprovada ou desconhecida, consequência, responsável e próximo passo seguro. Informação, aviso, divergência, erro e bloqueio têm texto próprio, sem depender só de cor. O caminho de resolução é orientação demonstrativa, sem abrir ou modificar cadastro real.

## Situações especiais demonstradas

| Situação | Empresa sintética | Evidência e tratamento |
| --- | --- | --- |
| Simples Nacional | Aurora/Maré | Regime do período e base/revisão; não autoriza transmissão |
| Lucro Presumido | Ponte | Fora da automação PGDAS; obrigações próprias permanecem |
| Sem movimento | Brisa | Receita comprovada R$0,00; não implica dispensa ou elegibilidade de cálculo |
| Sem procuração | Cedro | Consulta oficial impedida; leitura local distinguida |
| Externa | Orla | Declaração manual sem recibo, sem transmissão/pagamento/contabilização comprovados |
| Parada | Pausa | Pausa operacional, sem dispensa fiscal |
| Cadastro incompleto | Estrela | Regime comprovado, atividade sem enquadramento; distinto de regime desconhecido |
| Recusa do cliente | Ipê | Recusa preservada, obrigação não apagada |
| Regime desconhecido | Nova | Vigência não comprovada, fora do universo Simples conhecido |
| Transmissão incerta | Serra | Revisão8 sem confirmação; recibo7 histórico não comprova a tentativa. Sem nova transmissão ou liberação de reserva |
| Folha incompleta | Horizonte | FS12 ausente, não zero; revisão não aprovada |

Universo sintético:11 empresas Simples +1Presumido +1regime desconhecido. Indicadores5/4/1/1: a única transmitida também está confirmada. Orla externa sem recibo não entra como transmissão comprovada; Serra incerta sai dos conjuntos de confirmação/transmissão atuais. São mudanças **das fixtures**, não dos predicados de negócio ou planejamento. Contadores não somáveis. Impedidas/a revisar abrange problemas por capacidades distintas, não uma máquina de estados única.

## Tokens, componentes e acessibilidade

Reuso de [tokens](../../apps/web/src/styles/tokens.css), CSS de Operações e marca transcrita de [LogoAltan](../../apps/web/src/components/ui/LogoAltan.jsx). Corpo em fonte do sistema; Inter local na navegação. Botões, bordas, densidade, foco, cores e raios seguem o padrão existente. O artefato HTML reproduz a apresentação, **não instancia os componentes React**.

Ensaios de teclado exercitam Enter nos indicadores, Space na seleção, retorno ao gatilho, navegação pelas âncoras e invalidação de contexto. Corrigida disputa de foco do protótipo: a abertura não retoma o foco por uma chamada atrasada depois de o usuário alcançar um controle. Tabelas largas têm rolagem local e indicação no celular. Leitor de tela e zoom200% não foram homologados.

## Capturas comparativas principais

| Estado | Desktop | Celular |
| --- | --- | --- |
| Operações real | [1440](evidencias-plano-operacoes-apuracao/f1-r3/atual-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r3/atual-390.png) |
| B resumo | [1440](evidencias-plano-operacoes-apuracao/f1-r3/B-resumo-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r3/B-resumo-390.png) |
| Tabela | [1440](evidencias-plano-operacoes-apuracao/f1-r3/B-conferir-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r3/B-conferir-390.png) |
| Lote | [1366](evidencias-plano-operacoes-apuracao/f1-r3/B-lote-1366.png) | [360](evidencias-plano-operacoes-apuracao/f1-r3/B-lote-360.png) |
| Conferência | [1440](evidencias-plano-operacoes-apuracao/f1-r3/B-conferencia-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r3/B-conferencia-390.png) |
| Contexto durante rolagem | [1440](evidencias-plano-operacoes-apuracao/f1-r3/B-contexto-rolagem-1440.png) | [390](evidencias-plano-operacoes-apuracao/f1-r3/B-contexto-rolagem-390.png) |
| Transmissão incerta | [1366](evidencias-plano-operacoes-apuracao/f1-r3/B-incerta-1366.png) | [360](evidencias-plano-operacoes-apuracao/f1-r3/B-incerta-360.png) |

O comparador oferece os demais estados nas quatro larguras1440/1366/390/360. São108 capturas:104 da B e4 do App real. As capturas R1/R2 permanecem históricas, não homologação atual.

## Validação e próximo ponto de controle

- 120 asserções de interação/contexto/teclado e108 capturas; sem erros JavaScript ou overflow global da B nos estados medidos.
- 93 testes de governança/controlador/verificador aprovados; diagnose sem novas violações. Links e governança estrutural conferidos; resultados/CI do SHA final ficam no PR.
- O App atual apresentou overflow em360px. Limitação registrada sem alteração funcional.
- Revisão independente UI/UX concluída: favorável tecnicamente, sem bloqueadores, sobre código, documentação, capturas e evidências. Parecer e correções registrados na governança/PR; não é homologação humana. Acabamento não bloqueante: alguns contadores ainda usam plural com quantidade1.
- Nenhum teste PostgreSQL adicional: não há alteração funcional/persistência. Testes antigos não são contados como execução desta rodada.
- Controlador funcional não iniciado no escopo documental; não declarar `ready_for_human`.

**Pendências humanas:** homologar visualmente a B refinada e, separadamente, decidir sobre integração do planejamento e autorização do primeiro incremento funcional. Predicados F2, cálculo, contratos oficiais, seleção de lote e concorrência continuam sujeitos aos critérios do plano técnico. Nenhum parecer ou CI autoriza funcionalidades, merge, deploy, consultas fiscais, mensagens ou reativação Railway.
