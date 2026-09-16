# Apuração da empresa — 14/09/2026

A página apresenta faturamento/RBT12/DAS com procedência, anexo/faixa atual, notas consideradas e relatório. Tabelas completas de faixas, itens de cada grupo e diagnóstico do cálculo local ficam em expansíveis. Simulação, fechamento, transmissão e retificação continuam em FechamentoModal; após calcular, o modal gera o relatório e avisa o pai para reler, evitando uma segunda geração.

O extrato salvo vem de `getFechamento().dados.entregaPgdas.extratoSalvo`. Havendo registro, não mostrar “Buscar extrato”; exibir os dados/PDFs e manter “Atualizar na Receita” como ação explícita. Respostas tardias de outra empresa/competência não devem repor extrato/relatório antigos nem manter carregamento preso. Regressão: `pages/__tests__/extratoSalvo.test.jsx`.

Ausência de cálculo local não significa ausência de apuração oficial. Quando há snapshot oficial (simulado ou transmitido) ou declaração no extrato, recolher os avisos de classificação/cálculo local e identificar que a apuração tem retorno. Preservar distinção entre simulação e transmissão. Números da foto salva continuam os originais; leitura atual não os substitui. O texto “Nenhum valor oficial gravado neste relatório” descreve apenas a foto. Diagnóstico reconferido de cadastro resolvido não repete a recusa antiga.

Impressão abre/restaura os detalhes do relatório para incluir notas e limitações. Mantém uma única área de impressão, inclusive com o modal de fechamento aberto.
