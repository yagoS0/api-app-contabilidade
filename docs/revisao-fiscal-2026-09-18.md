# Revisão funcional fiscal — 18/09/2026

Escopo aprovado: corrigir os problemas levantados na revisão de uso da área Fiscal, preservando o desenho existente. Implementação em desenvolvimento; sem publicação e sem chamadas fiscais reais nesta etapa.

## Trabalho e revisão

Duas frentes de implementação (Apuração; Notas/Auditoria/Portal do cliente), coordenação de Planejamento/Guias/Situação Fiscal e um agente juiz independente, somente leitura. O juiz revisou alterações e executou testes separadamente; os bloqueadores levantados foram corrigidos antes da conclusão.

## Comportamentos corrigidos

- Apuração: alterar receitas, atividades ou folha invalida a simulação da tela. O servidor exige vínculo do cálculo com empresa, competência, documentos e formulário. Salvar, transmitir, retificar e processar lote verificam o vínculo; chamadas concorrentes não podem transmitir duas vezes.
- Regime de caixa: recusa explícita enquanto o fluxo não oferece suporte integral; não simular em um regime e transmitir em outro. Períodos já aceitos são reutilizados.
- Troca de empresa/competência: respostas atrasadas não substituem informações de notas, auditoria, perfil fiscal, apuração ou Lucro Presumido.
- Notas: busca por nome não inclui predicado de documento vazio; documento do tomador participa da busca/resumo. Cancelamento na base limitado a emitidas. Falhas de leitura e captura têm tratamentos distintos.
- Auditoria: abrir nota nos achados e nas notas sem competência; reabrir competência fiscal com motivo e confirmação; marcar pendência conferida por endpoint próprio, sem confundi-lo com classificação. Reabertura não conclui automaticamente a pendência.
- Portal do cliente: preservar emissão em andamento e bloquear navegação que perderia seu resultado.
- Planejamento: preservar digitação/colagem durante carregamento e retomada de cenário; atualizar somente valores mensais automáticos. Fonte desaparecida vira ausência com aviso, nunca zero; valores manuais e foto salva permanecem preservados.
- Guias: avisos e resultados pertencem à empresa e navegação de origem, inclusive recálculo INSS. Limpar avisos ao mudar de tela.
- Situação Fiscal: atalho de recálculo abre a seção existente. Ao expirar o prazo, reler apenas o status salvo; nenhuma consulta paga automática.
- Mock: perfil fiscal, cálculo, fechamento, transmissão e conferência de pendência conservam estado por empresa. Notas de exemplo da auditoria abrem detalhes coerentes; snapshot e relatório novo acompanham o cálculo simulado.

## Evidências

Coordenação: 10 suites web / 89 testes e 2 suites API / 34 testes aprovados. Incluem digitação/colagem com resposta atrasada, fonte mensal ausente, zero/manual, troca de aba durante envio, prazo SITFIS e estado dos mocks.

Apuração: 10 suites web / 84 testes e 3 suites API / 57 testes aprovados. Juiz: 11 suites / 113 testes e 15 verificações independentes aprovados; repetiu a suite de transmissão após correção de reconciliação. Esses conjuntos se sobrepõem e não devem ser somados.

Conferência visual no mock: atalho Situação Fiscal abre/foca a área; Auditoria abre detalhe correto sem competência e mostra orientação; simulação habilita fechamento/envio e editar receita desabilita ambos. Não foi realizada transmissão real.

## Limitações verificadas

Recuperação de transmissão é conservadora: declaração original comprovada pode ser reconciliada. Retificadora sem confirmação, índice ainda vazio ou processo interrompido durante transmissão exigem recuperação operacional comprovada. Nenhum destrave/reenvio automático por tempo. Não apresentar essa função como recuperação integral desses casos.

Regime CAIXA permanece sem suporte integral neste fluxo. Esta revisão não implementa novo motor fiscal nem altera partidas contábeis automaticamente.

Notas/Auditoria: 6 suites web / 78 testes, 1 suite API / 11 testes e 3 suites portal do cliente / 18 testes aprovados. Data civil no detalhe também coberta, sem deslocamento para o dia anterior.

Compilação local do escritório (591 módulos) e portal do cliente (120 módulos) concluída. Restam avisos existentes de tamanho dos arquivos gerados/importações; nenhum erro de compilação. Checagem do diff sem erros. ESLint padrão da frente Apuração encontrou incompatibilidade de versões instaladas; verificação isolada no-undef passou, sem alterar dependências.
