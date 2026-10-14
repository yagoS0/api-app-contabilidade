# Apuração da empresa — 14/09/2026

## Comparação e RBT12 — 14/10/2026

A Apuração inclui comparação hipotética dos anexos I–V e Presumido pelos motores do Planejamento e mostra folha mínima e diferença acumulada para atingir 28%. Folha desconhecida não vira zero; remuneração para CPP é campo separado da FS12. Cenário não altera apuração. RBT12 usa os 12 meses anteriores ao PA, extratos PGDAS já salvos com prioridade por mês e notas locais como alternativa, sem duplicar fontes. Cache parcial é recomposto; relatório sem persistência não grava nem cache. Histórico oficial completo é identificado como EXTRATO_PGDAS; base incompleta continua PARCIAL_LOCAL.


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

## Organização solicitada — 14/10/2026

Apuração começa com competência, estado, ações e os cinco indicadores no mesmo quadro. A tabela do anexo fica aberta; Classificar fica no cabeçalho da seção. Fator R e comparação ficam visíveis, nessa ordem; a barra mostra progresso até 28% sem transformar folha desconhecida em zero. O cenário Simples híbrido é explicitamente planejamento sem estimativa, dependente das premissas de IBS/CBS. Relatório de faturamento fica em diálogo aberto pela ação superior; PDFs e atualização explícita do extrato continuam no topo. Avisos fiscais, erro de leitura e estado de transmissão não são removidos para limpar a página. Após alteração no fechamento, reler snapshot mantém o DAS salvo no indicador com sua procedência.
## Classificação selecionável — 14/10/2026

Classificar permite selecionar o tipo/anexo por nota ou selecionar em lote as notas da competência carregada. Sugerir apenas preenche opções disponíveis: a aplicação exige seleção explícita e o botão Aplicar classificação selecionada. Não cria regras globais nem altera outras competências. Servidor verifica empresa, competência, nota emitida autorizada e itens, e recusa competência fechada/transmitida/confirmada ou envio incerto. Pendências restantes são contadas no mesmo escopo.

Reclassificar preserva os números/foto anteriores, mas rotaciona a chave de reserva da apuração e invalida reutilização. A interface identifica DAS anterior, suspende carga efetiva e pede novo cálculo; não mostrar resultado antigo como atualizado. Concorrência coberta por teste de disputa de versão com mocks, sem alegar homologação transacional de banco real.

## Correção de ordem e concisão — preferência posterior do usuário

Ações imediatamente ao lado da competência, no mesmo flex, sem margin-left:auto nem grupo que empurre os botões à extrema direita. Estado/extrato dentro da identificação da competência; os cinco indicadores vêm logo abaixo, no mesmo quadro. Ordem estrita: quadro inicial → anexo com tabela sempre aberta e Classificar → Fator R com barra → comparativo. Não recolher tabela nem reintroduzir legendas explicativas, próxima faixa, repartição em chips ou referências expansíveis nesta tela. A variante compacta da tabela retira esses extras. Preservar somente estados fiscais, erros, ausência de dados e limitações de tributos que afetam os números, em textos curtos. Publicação permanece pausada por solicitação do usuário.
