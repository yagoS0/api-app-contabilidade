# Apuração da empresa — 14/09/2026

## Cartão de estimativa vazio — 17/09/2026

Pedido do usuário: o cartão “DAS pré-apurado pelo portal” com “não calculado” é ruído. Exibir o cartão somente quando `procedenciaDoDas().nosso.disponivel` for verdadeiro, inclusive zero calculado. Preservar o resultado oficial, a distinção entre simulação/transmissão e o diagnóstico de pendências existente; ausência de estimativa nunca vira zero nem impede o relatório. Ajuste em desenvolvimento, sem publicação nesta etapa.

A página apresenta faturamento/RBT12/DAS com procedência, anexo/faixa atual, notas consideradas e relatório. Tabelas completas de faixas, itens de cada grupo e diagnóstico do cálculo local ficam em expansíveis. Simulação, fechamento, transmissão e retificação continuam em FechamentoModal; após calcular, o modal gera o relatório e avisa o pai para reler, evitando uma segunda geração.

O extrato salvo vem de `getFechamento().dados.entregaPgdas.extratoSalvo`. Havendo registro, não mostrar “Buscar extrato”; exibir os dados/PDFs e manter “Atualizar na Receita” como ação explícita. Respostas tardias de outra empresa/competência não devem repor extrato/relatório antigos nem manter carregamento preso. Regressão: `pages/__tests__/extratoSalvo.test.jsx`.

Ausência de cálculo local não significa ausência de apuração oficial. Quando há snapshot oficial (simulado ou transmitido) ou declaração no extrato, recolher os avisos de classificação/cálculo local e identificar que a apuração tem retorno. Preservar distinção entre simulação e transmissão. Números da foto salva continuam os originais; leitura atual não os substitui. O texto “Nenhum valor oficial gravado neste relatório” descreve apenas a foto. Diagnóstico reconferido de cadastro resolvido não repete a recusa antiga.

Impressão abre/restaura os detalhes do relatório para incluir notas e limitações. Mantém uma única área de impressão, inclusive com o modal de fechamento aberto.

## Revisão de coerência da apuração — 18/09/2026

O fechamento exige identificador de simulação (calculoId). Editar receita, atividade, folha ou sem movimento limpa resultado e confirmação; operações em andamento bloqueiam os campos. Respostas de outra empresa/competência são descartadas. O hook recorta pendências pela competência e diferencia falha de leitura de ausência de cadastro. Premissa de serviços 16% do LP pertence à empresa.

No backend, simulacaoSerpro usa envelope {raw, _portalCalculo, _portalTransmissao?}: raw preserva a resposta integral; vínculo registra formulário, CNPJs e séries aceitas de receitas/folha. Salvar/transmitir exigem mesma empresa, competência, token e foto. Escrita condicional impede duas transmissões e simulação concorrente de substituir a foto aprovada; lote captura o token na criação. Simulações antigas precisam ser refeitas uma vez para fechar/transmitir. Nenhuma migração.

CAIXA é recusado antes da chamada fiscal (inclusive quando cadastrado e omitido no payload), pois o fluxo não tem suporte integral. Não converter silenciosamente em competência. Transmissão reutiliza as listas aceitas, inclusive vazias; não reconstrói RBT12.

Falha após iniciar envio pode ter resultado incerto: mantém bloqueio sem retry. Botão “Conferir envio na Receita” só consulta. Declaração original comprovada recupera estado; índice vazio/inválido não autoriza reenvio, nem declaração antiga comprova uma retificadora. Retificadora incerta e processo interrompido em transmitindo exigem conferência/recuperação operacional com comprovante; não existe desbloqueio automático por tempo.
