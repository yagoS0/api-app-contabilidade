# ALTAN — Design system operacional

**Versão:** 1.0 · Diretrizes propostas; Codex deve auditar tokens/componentes reais antes de fixar valores.

## Princípios

1. **Ação antes de ornamentação:** dar destaque ao que precisa ser resolvido e aos números que orientam decisões.
2. **Minimalismo com densidade:** uma aplicação para contadores pode ter tabelas densas, sem ruído de textos, badges e cores em excesso.
3. **Reutilização:** primeiro buscar componente existente e token existente. Não inventar novas variantes por tela.
4. **Divulgação progressiva:** resumo no nível superior, detalhes sob demanda em linha expandida, drawer ou página dedicada.
5. **Consistência semântica:** mesma ação, mesmo rótulo, mesmo ícone, mesma posição e comportamento.
6. **Acessibilidade:** contraste, navegação por teclado, foco visível, área clicável adequada e estado nunca transmitido só por cor.
7. **Honestidade dos dados:** zero ≠ ausente ≠ não aplicável ≠ não consultado ≠ incompleto.

## Tokens: política, não valores inventados

- Inspecionar CSS variables, tema, bibliotecas e tokens reais; documentá-los em tabela com nome e uso. Criar novos tokens apenas quando lacuna verificada.
- Preservar base dark de alto contraste, divisores sutis e cor primária já usada; usar accent apenas na ação principal, seleção e foco.
- Verde para confirmação; âmbar para atenção; vermelho para falha/bloqueio; neutro para sem ação. Não criar verde em fundo de célula inteira como regra universal.
- Definir escala coerente de tipografia, espaçamento, raio e alturas a partir do projeto. Fonte monoespaçada/tabular apenas para números, datas e códigos quando útil.
- Usar largura fluida para tabelas e limites de leitura em textos longos; evitar páginas de relatório excessivamente estreitas em telas amplas ou formulários largos demais.

## Componentes obrigatórios a identificar ou padronizar

| Componente | Regra de uso | Anti-padrão |
|---|---|---|
| `PageHeader` | título, contexto, no máximo ação primária e poucas secundárias | título repetido ou várias barras redundantes |
| `PeriodSelector` | distingue competência, vencimento, referência contábil | diferentes seletores para o mesmo significado |
| `OperationalStatus` | rótulo curto + ícone e tooltip opcional | codificar estado só por cor |
| `SummaryMetric` | número, unidade, definição e drill-down quando acionável | cartão vazio/estático sem finalidade |
| `DataTable` | cabeçalho fixo quando útil, colunas alinhadas, seleção e paginação claras | texto multilinha em cada célula sem necessidade |
| `FilterBar` | busca + filtros relevantes + limpar | filtros duplicados em diferentes níveis |
| `InlineAlert` | perto do dado problemático, com ação objetiva | banner alto repetido em todas as visitas |
| `Drawer` | detalhes rápidos e histórico da guia | modal pequeno com muita informação |
| `Modal` | confirmação, edições simples e operações curtas | fluxo complexo de apuração em modal |
| `EmptyState` | indicar motivo e próximo passo, quando houver | vasto espaço vazio com texto genérico |
| `ActivityLog` | eventos datados, ator, mudança e origem | estados sem rastreabilidade |
| `DocumentActions` | visualizar, copiar, baixar, versão | botões repetidos em toda célula |

## Layout e hierarquia

- Por página: um contexto superior, uma ação primária, área principal de trabalho; resumo opcional quando faz diferença para execução.
- Cabeçalho da empresa é compartilhado, com nome, CNPJ, navegação e seleção de competência em posição uniforme.
- Não repetir nome da empresa no título do relatório quando já está no cabeçalho, exceto no documento imprimível.
- Evitar três toolbars consecutivas: agrupar ações por frequência; mover secundárias para menu sem ocultar ação crítica.
- Tabelas: primeira coluna com entidade; números à direita; datas e status consistentes; documentação/histórico em expansão. Não colocar valores longos como linha digitável inteira: truncar + copiar + detalhar.
- Gráficos apenas quando informam tendência válida; não conectar meses sem dados como se fossem zeros.
- Placeholders claros e estados vazios compactos. Expansões e drawers mantêm usuário no contexto de empresa/competência.

## Densidade de informação

- **Página inicial:** mostrar no máximo o necessário para identificar e classificar trabalho. Conteúdo detalhado no drill-down.
- **Central:** separar `Exigem ação`, `Acompanhamento`, `Automações`.
- **Guias:** dados prioritários = obrigação, valor, vencimento, pagamento, envio, revisão. Detalhes de transportes e versões sob demanda.
- **Apuração:** separar revisão operacional da simulação de alíquotas; esconder detalhes técnicos quando não relevantes.
- **Relatórios:** evitar repetir 'Sem base comparável' em cinco cartões; alertar cobertura no nível do conjunto.
- **Circular:** evitar fundos de células saturados e três linhas de texto por estado.
- **Planejamento:** parâmetros agrupados, orientação inline curta; exceções fiscais no disclosure associado.

## Estados visuais

| Situação | Apresentação |
|---|---|
| Confirmado / entregue / pago | ícone + rótulo curto; verde moderado |
| Exige revisão | âmbar, ação definida |
| Falha | vermelho, motivo e retry |
| Em processamento | progress/feedback textual |
| Sem dados | `Sem dados`, sem inferir zero |
| Zero | `R$ 0,00` ou `0` quando conhecido |
| Não aplicável | `Não aplicável`, tooltip opcional |
| Sem guia exigível | rótulo específico, sem badge de erro |
| Documento substituído | rótulo `Substituído`, vínculo nova versão |

## Formulários, modais e mensagens

- Labels permanentes e concisos; exemplos/placeholders não substituem rótulos.
- Erro no campo, imediatamente explicando correção; não colecionar mensagens extensas abaixo do formulário.
- Confirmar exclusão, transmissão, recálculo, reabertura e ações irreversíveis ou onerosas, conforme impacto.
- Modal simples: título de ação, campos essenciais, feedback, cancelar/confirmar; operação complexa em drawer amplo ou página.
- Toast não substitui registro persistente nem bloqueio do processo. Aviso crítico pode ter contador na navegação, detalhes e marca de revisão.
- Mensagens de WhatsApp/e-mail: status por canal, envio, entrega e confirmação; nunca pintar cliente como 'pagou' por mera resposta.

## Padrões de qualidade

- Testar com teclado, leitor de tela quando possível, daltonismo (forma e texto além de cor), resolução desktop comum e laptop menor, overflow e zoom 200%.
- Para cada alteração visual, screenshots antes/depois nas mesmas dimensões e com dados típicos + extremos (lista vazia, muita informação, nomes longos, status de erro).
- Não modificar tokens globais sem captura de impacto nas principais rotas.
- Evitar quaisquer ícones decorativos sem semântica, chips gigantes e legendas em duplicidade.

## Checklist do revisor

- [ ] A tarefa principal está evidente em 5 segundos?
- [ ] Há apenas um foco primário por contexto?
- [ ] Filtros, estado, erro e loading são consistentes?
- [ ] A mesma informação aparece repetida desnecessariamente?
- [ ] O usuário consegue abrir detalhe sem perder contexto?
- [ ] Todos os números têm unidade, base temporal e origem corretas?
- [ ] A interface funciona com dados grandes, vazios e inconsistentes?
- [ ] Estados são reconhecíveis sem depender de cor?
- [ ] Componentes novos são realmente necessários e documentados?
