# Correção do fluxo, DRE e painel do cliente

Implementação autorizada em 08/09/2026, a partir da auditoria que identificou DRE zerada com Decimal, deslocamento de guias e ausência de transporte mensal do saldo.

## Entrega

- DRE aceita Decimal real do banco, mantém sinais/competência e informa rascunhos, valores inválidos e contas de resultado não mapeadas. Não converte ausência ou inconsistência em resultado confirmado.
- Hoje é definido pelo servidor. Competência e janela são navegação. Guias futuras permanecem no vencimento, atrasadas em aberto no mês corrente e pagas na data de pagamento. A previsão de DAS só é substituída pela guia correspondente, sem usar parcelas/competências diferentes.
- Saldo inicial informado por empresa e mês: novas versões preservam histórico, inclusive na remoção. Saldo projetado final passa ao mês seguinte, mesmo vazio ou em outro ano. A leitura considera o histórico desde a referência, não apenas a janela de meses visíveis.
- Sem saldo inicial não existe zero presumido. Resultado mensal e saldo projetado são colunas separadas; a DRE não recebe saldo de caixa. Valores do fluxo são normalizados por linha em centavos antes de chegar aos totais e telas.
- Cards e tabela recarregam após alterações; falha do fluxo tem aviso e retentativa. Formulário preserva preenchimento ao navegar, e visita do escritório não altera saldo. O mestre mantém a autorização administrativa existente.
- Relatórios do contador mostra o mesmo saldo, apenas leitura. CLAUDE.md raiz/API/cliente e contextos de fluxo/DRE/Relatórios atualizados.

## Validação antes do CI

- API integrada fluxo/DRE/HTTP: 15 suítes, 525 testes aprovados. DRE com Decimal real e contrato de serviço; saldo com zero/negativo, centavos, virada de ano, histórico anterior à janela e autorização.
- Frontend: 40 testes finais de cards/saldo/DRE e 12 de API/saldo passaram; 315 de rodada ampla anterior passaram e uma expectativa de texto foi corrigida na rodada final (contagens sobrepostas). Relatórios do contador: quatro testes com paridade do saldo final/diário.
- Schema validado e Prisma gerado em diretório isolado, sem alterar dependências compartilhadas. Auditoria de migrations aprovada.
- Navegador local com dados fictícios: saldo 5.000 em setembro; saldo final de setembro 18.600,45 e de outubro 29.790,45, preservando o anterior. Formulário verificado em 390×844, página com largura/conteúdo 375/375. Avisos DRE conferidos e códigos técnicos substituídos por frases legíveis.
- CI ampliado para toda a regressão dos dois portais, fluxo/DRE API e ensaios PostgreSQL reais de persistência/versões/saldo e DRE com Decimal, isolamento e estornos. Resultado da publicação será registrado no relatório de execução.

## Implantação e limites

Aplicar migration aditiva `20260908230000_cashflow_opening_balance` e gerar Prisma antes da API. Nenhum saldo inicial foi preenchido automaticamente para empresas reais. O usuário deve informar o valor disponível no início do mês de referência, antes das movimentações desse mês.

O acumulado é gerencial/projetado: o produto ainda utiliza convenções de recebimento de notas e estimativas. Não equivale a conciliação bancária. A validação específica dos valores atuais da Lente continua dependendo de competência e acesso autenticado; não foram lidos ou alterados lançamentos reais nesta execução. Nenhuma chamada SERPRO, emissão ou mensagem real foi realizada.
