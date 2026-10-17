# DESIGN_SYSTEM — Altan

## 1. Identidade a preservar

Interface de trabalho dark, com fundo azul-acinzentado profundo, superfícies discretas, texto claro, navegação roxa e ação primária azul. Manter marca, estrutura de navegação e significado das cores existentes. Não criar uma estética nova para cada aba; não transformar o escritório em uma sequência de cartões grandes, gradients ou painéis promocionais.

Fonte técnica: `apps/web/src/styles/tokens.css`. Os valores abaixo foram lidos nessa árvore em 16/10/2026. Na implementação, importar os tokens vivos; não copiar hexadecimais para CSS de telas.

| Papel | Token existente | Valor de referência |
| --- | --- | --- |
| Fundo da página | `--bg-page` | `#1A1B26` |
| Superfície | `--bg-surface` | `#24253A` |
| Superfície secundária | `--bg-subtle` | `#282A36` |
| Texto principal | `--text` | `#F8F8F2` |
| Texto secundário | `--text-muted` | `#AEB6D3` |
| Texto discreto | `--text-faint` | `#8794C9` |
| Divisória | `--border` | `#44475A` |
| Primária / hover | `--primary` / `--primary-hover` | `#2563EB` / `#1D4ED8` |
| Foco | `--border-focus` / `--accent-purple` | `#BD93F9` |
| Alerta bloqueante | `--state-danger` | `#FF5757` |
| Ação disponível | `--state-warn` | `#FFB347` |
| Concluído | `--state-ok` | `#69FF47` |
| Neutro | `--state-neutral` | `#A7B0C0` |
| Fechado | `--state-closed` | `#2DD4BF` |

Estados usam seus pares `-surface`. Não construir transparência concatenando texto ao valor de uma variável. Cores de regime são categoria, não severidade: cyan para Simples, orange para Presumido, purple para Real; pink identifica folha. Não pintar uma empresa inteira de vermelho porque sua apuração ainda não começou. Respeitar a semântica já registrada nos tokens: vermelho operacional para bloqueio; pendência ordinária em neutro e ação disponível em âmbar. Ação destrutiva usa o componente de perigo no contexto de confirmação.

## 2. Tipografia

- Corpo: `--font-sans`, peso 400. Rótulos e navegação: 500–600. Títulos: 600.
- Navegação e nomes conforme `--font-navigation`; marca conforme `--font-marca`. Inter permanece auto-hospedada onde já é utilizada. Não substituir a fonte do corpo inteiro.
- Preservar o tamanho do componente compartilhado. Alvo de revisão: corpo legível, metadados subordinados e no máximo três níveis de tamanho por contexto.
- Evitar todos os valores em negrito e cabeçalhos longos em caixa alta. Destacar o total ou o dado decisivo, não todas as células.
- Valores monetários alinhados à direita, com números tabulares quando disponível. Usar formato brasileiro: `R$ 1.234,56`; competência `09/2026`; data civil `20/10/2026`. Não converter data civil em UTC e deslocar o dia.
- `—` significa indisponível/não aplicável apenas quando houver nome acessível ou contexto explícito. Zero confirmado é `R$ 0,00`; falta de dados é `Não informado`.

## 3. Espaço e largura

Usar `--space-1` a `--space-6`: 4, 8, 12, 16, 24 e 32px. Raios existentes: `--radius` 10px e `--radius-sm` 8px. Não criar raios diferentes por aba.

Tabelas e matrizes usam `--content-wide` (90%) e `--content-gutter` (5%) no contexto desktop existente. Formulários e leitura usam `--content-max` (1200px) como teto, com grupos de campos menores quando isso facilita a leitura. Adaptar gutters no celular pelos padrões compartilhados. Não forçar 1200px em tabela larga nem seis campos de formulário lado a lado para ocupar a tela.

Uma borda delimita uma região funcional, não cada frase. Evitar painel dentro de painel dentro de painel. Separar assuntos por espaço/título/divisor. Não aumentar altura de linhas para compensar falta de organização. Linha com metadado pode crescer naturalmente; texto e ação nunca devem cortar.

## 4. Estrutura comum

```text
Cabeçalho da empresa: voltar · identificação · contexto · configurações/tarefas
Navegação principal e subnavegação existentes
Título da tela · competência/período · ação primária contextual
Alerta relevante, se houver
Resumo útil / filtros
Conteúdo de trabalho (tabela, formulário ou conversa)
Detalhe progressivo e histórico
```

Não repetir nome da empresa e competência em três painéis consecutivos. Repetir contexto é obrigatório em confirmação, documento exportado ou região que pode ser aberta isoladamente.

## 5. Componentes e contratos

Reutilizar `apps/web/src/components/ui/Button.jsx`, `Painel.jsx` e `Modal.jsx`. Antes de criar componente, procurar equivalente e seus consumidores. Extensão compartilhada exige teste dos consumidores afetados.

| Elemento | Padrão | Reprovar quando |
| --- | --- | --- |
| Botão | Uma primária por contexto; secundárias neutras; 32/40/44px conforme variante existente | Todos azuis, texto cortado, ícone sem nome |
| Ação em lote | Barra aparece após seleção; informa quantidade e alcance | Seleção da página tratada como todos os resultados |
| Cartão de indicador | Nome curto, número e unidade; abre o conjunto exato | Métrica decorativa ou contador sem destino |
| Badge | Texto curto, sem depender só de cor; detalhe acessível | Cor comunica informação que o texto não contém |
| Tabela | Identificação à esquerda, valores à direita, ação junto à linha | Coluna de botões domina o conteúdo ou página inteira rola horizontalmente |
| Filtro | Rótulo persistente; busca, filtros frequentes e limpar | Placeholder é o único rótulo ou filtro oculto muda total sem indicação |
| Campo | Label, valor, erro local e ajuda necessária | Ajuda longa permanente ou erro somente em toast |
| Estado vazio | Motivo e ação útil quando aplicável | Lista vazia com falha de API apresentada como nenhum registro |
| Modal | Título, contexto, corpo, consequência e rodapé | Modal explicativo para cada contador ou modais aninhados |
| Detalhe lateral | Inspecionar sem perder lista/seleção | Recria formulário incompatível com Modal existente |

Menus de ações pouco frequentes devem usar nomes concretos. `Mais ações` pode agrupar histórico/exportação/configuração; não esconder correção bloqueante ou próxima ação operacional.

## 6. Alertas e redução de ruído

Um alerta por causa consolidada no topo da região afetada, com quantidade e ação: `2 notas alteram a base transmitida · Revisar`. O detalhe contém documentos, datas e consequências. Erros de campo ficam no campo. Informações consultivas extensas ficam em `Ver critérios` ou detalhe, preservando avisos que mudam a decisão.

Não apagar advertência fiscal, custo de consulta, resultado incerto ou necessidade de confirmação para deixar a tela limpa. Não transformar todo dado parcial em banner repetido em cada cartão. Estado não resolvido pode ser visualizado de forma compacta, mas não desaparecer.

## 7. Responsividade e acessibilidade

- Validar 1440×900, 1920×1080, 768×1024 e 390×844; conferir também largura 360px e zoom 200% nas áreas críticas.
- Layout móvel empilha grupos por ordem de decisão. Tabelas densas mantêm rolagem local nomeada e acessível; itens simples podem usar lista compacta com os mesmos campos.
- Não ocultar vencimento, estado, empresa ou ação necessária para caber. Colunas secundárias podem migrar para detalhe.
- Alvos móveis de pelo menos 44px no padrão do projeto; foco visível; ordem de Tab acompanha a leitura; ícones têm nome acessível.
- Modal contém foco, recebe foco inicial apropriado, aceita Escape quando seguro e devolve foco ao gatilho. Durante operação, preservar explicação e estado ocupado.
- Critério interno de contraste: texto normal 4,5:1 e elementos essenciais 3:1; medir combinações reais, inclusive hover e disabled. A identidade da marca não justifica texto operacional ilegível.
- Respeitar redução de movimento. Anunciar sucesso/erro assíncrono sem deslocar foco durante edição.

## 8. Impressão e exportação

Tela dark; papel legível em fundo claro com marca no modo de impressão existente. Preservar período, empresa, origem, revisão, premissas e limitações. Cabeçalhos de tabelas repetem entre páginas; nenhuma coluna/observação pode sumir. Exportação não transforma desconhecido em zero ou simulação em apuração oficial.

## 9. Aceite do sistema visual

Uma tela passa quando reutiliza tokens/componentes, tem hierarquia clara, uma ação principal contextual, estados compreensíveis sem legenda permanente, foco íntegro, ausência de overflow da página e evidência visual desktop/móvel. Build aprovado ou screenshot isolado não substitui esse aceite.
