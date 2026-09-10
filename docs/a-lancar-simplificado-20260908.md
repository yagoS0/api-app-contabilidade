# A lançar — simplificação e seleção em lote

Implementado na branch `codex/a-lancar-simplificado`, a partir de `origin/main` bf22dab4. Ainda não publicado.

- Removida a seção Só entra no fluxo e seu contador na entrada de A lançar. Os registros existentes não são apagados.
- Arquivos do WhatsApp e regras ficam em seções recolhidas. Conferência de contas e pagamento permanece na tabela.
- Seleção individual e seleção das linhas prontas da página (limite atual de 50). As contas editadas pelo contador são preservadas.
- Modal mostra linhas, datas, débito, crédito e total. Só a confirmação explícita envia. Resultados são individuais, sem repetição automática de sucessos ou respostas incertas.
- Bloqueios de competência fechada, conta inválida, falta de pagamento e possível duplicidade continuam aplicados. A correspondência com notas é consultada novamente antes de abrir o lote. A empresa do envio fica vinculada ao resumo.
- Projeções por série exigem despesa e pelo menos três ocorrências consecutivas observadas; nas séries mensais, são três meses. Declarações avulsas do cliente não entram como uma segunda fonte de projeção. Despesas lançadas mantêm sua fonte própria.
- A IA continua sugerindo contas editáveis, sem confirmar lançamentos sozinha.

Validação: 578 testes da interface (conferência e botão de entrada), 385 testes de fluxo de caixa e build Vite aprovados. Build mantém avisos de tamanho de bundle e imports mistos. Conferência visual local com dados mock: seleção de duas linhas elegíveis e resumo de R$ 1.065,00. Nenhuma contabilização real em produção.
