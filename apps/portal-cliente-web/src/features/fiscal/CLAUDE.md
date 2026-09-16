# Telas fiscais no celular — 16/09/2026

`mobileFiscal.css` complementa os tokens e o CSS global, sem substituir regras fiscais. Carregar depois de `app.css`.

- Notas, Guias e relatório SITFIS conservam todas as colunas; `.fiscal-table-scroll` contém a rolagem, recebe foco pelo teclado e identifica a região pelo nome.
- `.emissor-mobile` permite nomes e sugestões completos, formulário em uma coluna, prévia sem posição fixa e botões de confirmação com alvo mínimo de 44px em telas até 600px.
- `.cancelar-nota-modal` conserva dados, justificativa, foco preso e confirmação explícita. Botões empilham no celular e o conteúdo rola dentro da altura disponível.
- Não usar largura fixa, esconder valores nem converter ausência de informação fiscal em zero para acomodar a tela.

Validação automatizada: suítes existentes de Notas, Emitir, Guias e Fiscal. jsdom não verifica dimensões; a conferência visual em 360/390px deve ser feita no navegador com dados mock, sem emissão ou consulta fiscal real.
