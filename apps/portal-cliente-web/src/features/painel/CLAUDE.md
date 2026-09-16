# Painel, Fluxo e DRE — celular (16/09/2026)

Pedido atual: adaptar o portal cliente para celular e usar a paleta do contador. A paleta vem dos tokens globais; não fixar cores neste módulo. As decisões antigas de layout não impedem esta adaptação.

`painel-responsive.css` é escopado por `.painel-page` e `.painel-financeiro`, carregado pelo entrypoint depois do CSS global. Em 360/390 px, os cards empilham, controles quebram linhas e alvos têm pelo menos 44 px. Os dois meses e todas as colunas permanecem disponíveis; a rolagem é local, com a coluna do dia fixa e cabeçalho/rodapé preservados. As regiões de tabela são focáveis e nomeadas para rolagem pelo teclado. DRE tem cabeçalhos de descrição e valor, sem ocultar ressalvas ou contas não classificadas.

Não alterar cálculos, contratos, procedência ou referências de competência por causa do layout. Testes de ligação protegem navegação, leitura dos cards, fluxo e DRE; teste DOM não comprova geometria, que deve ser conferida no navegador.
