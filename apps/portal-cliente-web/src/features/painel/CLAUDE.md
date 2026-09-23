# Painel sem alertas de guias vencidas — 23/09/2026

O pedido atual remove o popup de ciência e o bloco de guias vencidas do painel, tanto no Fluxo quanto na DRE. Não renderizar esses avisos nem registrar ciência automaticamente. A aba Guias e os dados de pagamento permanecem; guias continuam compondo impostos e saídas do fluxo pelas regras existentes. O payload alertaDeGuias pode continuar chegando com o fluxo, mas não é apresentado no painel. Esta decisão substitui instruções antigas que exigiam popup/tabela permanente.

# Fluxo mensal — 20/09/2026

Pedido atual substitui a apresentação diária: quatro cards do mês selecionado, Entradas, Saídas (despesas + impostos, sem folha), Folha e Resultado (entradas − saídas − folha). Clique detalha o mês inteiro, inclusive linhas sem dia. Shared fluxoMensal usa a agregação existente; não muda motor, fontes ou procedência. Acumulado continua separado. Escritório somente leitura; cliente preserva a declaração de saída para conferência. DRE permanece restrita aos fechamentos contábeis.

# Painel, Fluxo e DRE — celular (16/09/2026)

Pedido atual: adaptar o portal cliente para celular e usar a paleta do contador. A paleta vem dos tokens globais; não fixar cores neste módulo. As decisões antigas de layout não impedem esta adaptação.

`painel-responsive.css` é escopado por `.painel-page` e `.painel-financeiro`, carregado pelo entrypoint depois do CSS global. Em 360/390 px, os cards empilham, controles quebram linhas e alvos têm pelo menos 44 px. Os dois meses e todas as colunas permanecem disponíveis; a rolagem é local, com a coluna do dia fixa e cabeçalho/rodapé preservados. As regiões de tabela são focáveis e nomeadas para rolagem pelo teclado. DRE tem cabeçalhos de descrição e valor, sem ocultar ressalvas ou contas não classificadas.

Não alterar cálculos, contratos, procedência ou referências de competência por causa do layout. Testes de ligação protegem navegação, leitura dos cards, fluxo e DRE; teste DOM não comprova geometria, que deve ser conferida no navegador.
