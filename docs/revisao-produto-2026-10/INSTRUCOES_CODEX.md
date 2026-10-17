# Instruções ao Codex e plano faseado

## Missão

Revisar as telas do escritório Altan e integrar seus estados conforme este pacote, preservando a identidade dark. Entregar incrementos pequenos, verificáveis e coerentes. Não redesenhar cada aba isoladamente, não criar status manuais paralelos, não ocultar problemas por textos genéricos e não afirmar conclusão sem verificar a interface.

Esta entrega é documentação. A execução futura deve respeitar o escopo que o usuário solicitar, as decisões aprovadas e o estado real da branch escolhida.

## Antes de editar código

1. Ler os AGENTS.md aplicáveis, a fonte operacional viva integral, este pacote e os CLAUDE.md dos módulos afetados.
2. Identificar checkout/branch, alterações locais e trabalhos concorrentes. Não assumir que toda pasta `release` é a versão vigente; não integrar ou sobrescrever outra árvore por conveniência.
3. Reproduzir o problema quando ele é relatado; registrar evidência e separar fato de hipótese. Prints demonstram aparência, não retorno de API.
4. Inventariar componente, produtor do dado, projeção, consumidores, permissão e teste existente. Usar os pontos de entrada da seção 12 da fonte operacional como início, verificando se ainda existem.
5. Descrever regra afetada, resultado esperado e teste que demonstrará a correção. Se houver decisão V pendente, preparar proposta concreta e continuar trabalho independente.
6. Reutilizar tokens, Button, Painel e Modal. Não resolver organização simplesmente aumentando largura, introduzindo mais cartões ou adicionando legendas.

## Plano de execução

| Fase | Escopo | Dependências | Entrega e condição de saída |
| --- | --- | --- | --- |
| 0 — Inventário | Todas as telas, rotas, estados e consumidores | Checkout correto e fontes vivas | Mapa de componentes e dados, capturas atuais, defeitos reproduzidos, decisões identificadas |
| 1 — Contratos | Expectativa, documento/envio/pagamento, revisão e origem | V02–V07 onde alteram política | Projeção comum mapeada; testes de contagem/versão/concorrência; sem enum monolítico |
| 2 — Controles compartilhados | Cabeçalho, contexto, filtros, badges, tabela, modais e ações | Design system; contratos conhecidos | Padrões reutilizados; estados desktop/móvel e consumidores verificados |
| 3 — Carteira e operações | Empresas, filas, contadores, seleção e conferência por empresa | Fases 1/2; unidade e política aplicáveis | Cartão/lista/detalhe concordam; aprovação por revisão; erro parcial visível |
| 4 — Fluxo fiscal | Notas, apuração, transmissão, guias, extrato e reabertura | Conferência e guardas estáveis | Jornada integrada com provedores simulados; sem transmissão implícita ou duplicada |
| 5 — Contabilidade e comunicação | Anotações/WhatsApp, lançamentos, circular e parcelamentos | Evidência documental e estados de pagamento | Origem e contabilidade conciliadas; débito automático sem pendência documental falsa |
| 6 — Análise | Relatórios, situação fiscal e planejamento | Fontes, cobertura e versões conhecidas | Sem zeros fictícios; cenário isolado de ato fiscal; PDFs e responsividade verificados |
| 7 — Consolidar | Regressão integrada, onboarding aplicável, documentação e rollout | Fases entregues e V08 quando necessário | Matriz de aceite completa no escopo, registro de limites, reversão e release revisável |

Cada fase inclui testes e revisão visual. Não deixar todos os testes para a fase 7. As fases são uma ordem de dependência, não autorização para reformular tudo de uma vez. Correções independentes podem ser entregues antes, identificando sua base.

## Primeira fatia recomendada

Conectar a fixture de quatro expectativas conhecidas à carteira, Guias e Operações: exibir 3/4, anexar a quarta, enviar somente a pendente, simular falha por canal e recarregar. Isso comprova o contrato de estados antes de espalhar novos rótulos por todas as telas. Para DARF consolidado, aguardar definição de V03 em vez de inventar denominador.

Em paralelo lógico de planejamento, inventariar e reproduzir reabertura com resposta vazia/ausente e débito automático classificado como incompleto. A recomendação não exige agentes adicionais nem alteração simultânea de arquivos.

## Regras de implementação

- Não alterar fórmulas, autorização ou payload em uma refatoração puramente visual. Se a correção exigir mudança operacional, registrar explicitamente a regra e seus testes.
- Estado apresentado deve vir do domínio/projeção compartilhada, não de condições diferentes duplicadas por tela.
- Não tratar dados desconhecidos como zero ou dispensados. Não marcar sucesso antes da confirmação persistida.
- Garantir idempotência e conciliação de efeitos externos; simular timeout após processamento para testar o caso incerto.
- Contadores precisam de escopo e unidade. Falha de envio não transforma guia válida em ausente.
- Campos internos/nomes de API não vão para a UI como explicação. Usar mensagem útil e identificador de suporte.
- Manter rascunhos, foco, filtro e seleção válidos. Tratar respostas fora de ordem e troca de contexto.
- Preservar histórico. Mapeamento de dados legados deve manter origem, versão e evidência; não inferir informação que não existe.
- Não corrigir prints ou mascarar dados para simular funcionalidade concluída. Mostrar captura do produto real em ambiente controlado.

## Verificação técnica

Scripts confirmados nesta árvore: `npm run test -w @contabilidade/web`, `npm run test -w @contabilidade/api`, `npm run build -w @contabilidade/web`, `npm run lint -w @contabilidade/web`. Selecionar testes dirigidos com os parâmetros do runner configurado e conferir que foram efetivamente executados; o script atual permite ausência de testes, portanto código de saída zero sozinho não basta.

Executar build/lint pertinentes à alteração e verificar falhas preexistentes separadamente. Para mudança de componente compartilhado, incluir os consumidores afetados. Usar os scripts locais de evidência visual existentes quando compatíveis; verificar seu comportamento antes de executar. Não rodar scripts de produção, workers reais ou migrations como se fossem testes.

`git diff --check` verifica espaço/formatação, não função nem aparência. A documentação deste pacote pode ser validada por links, cobertura, consistência e diff; não requer executar a suíte do produto sem alteração de código.

## Implantação e reversão

Se a implementação alterar persistência, definir mapeamento de legado, compatibilidade temporária dos consumidores e reconciliação antes da ativação. Preferir mudança aditiva e rollout por capacidade existente. Não inventar feature flag que o projeto não possua sem necessidade demonstrada.

Antes da entrega funcional, registrar como voltar código/projeção preservando eventos e documentos. Reverter código não desfaz transmissão, envio ou pagamento externo. Em resultado incerto, conciliar a tentativa; nunca usar rollback visual como licença para repetir operação.

## Pronto para revisão

Apresentar arquivos alterados, regra afetada, comportamento antes/depois, testes efetivamente executados, capturas e limitações. Atualizar a fonte operacional e o histórico quando houver decisão nova validada; manter este pacote alinhado. Não encerrar com “layout melhorado” sem mostrar quais tarefas ficaram mais claras e quais estados foram verificados.
