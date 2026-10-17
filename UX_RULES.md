# ALTAN — Regras de UX, interações e estados

**Escopo:** contrato de usabilidade para qualquer agente que altere o Altan.

## Perguntas antes de qualquer alteração

1. Qual tarefa o contador pretende executar nesta tela?
2. Qual ação deve estar disponível imediatamente? Qual é excepcional?
3. Que informações ele precisa antes de tomar a decisão?
4. Qual fonte/evento sustenta status e números?
5. O que pode falhar e como o usuário retoma de forma segura?
6. Que outra tela precisa refletir o mesmo evento?
7. Esta mudança respeita componentes/tokens atuais?

## Fluxos e navegação

- Respeitar contexto contínuo `empresa → competência → processo → documento`; voltar preserva filtros relevantes, seleção e rolagem quando tecnicamente viável.
- Não usar um único 'status geral' para encobrir estados divergentes de obrigações distintas.
- Card acionável deve levar a lista filtrada com exatamente os itens contados.
- Linha expandida ou painel de detalhe são preferidos para descobrir *qual* guia ou nota gerou o status; não abrir modais excessivos.
- Use busca e filtro únicos por tela; estados operacionais podem ser facetas de filtro, não cartões duplicados.
- Distinga conteúdo de **competência**, **data de vencimento**, **mês contábil** e **data de pagamento** em rótulos e navegação.

## Mensagens e alertas

- Níveis: `bloqueante`, `revisão`, `informativo`; todo alerta inclui evento, objeto afetado, consequência, ação e resolução.
- Mostrar avisos temporários quando úteis, permanentes apenas se ainda há pendência; agrupá-los quando múltiplos.
- Não abrir alerta genérico 'nota posterior' sem comparar impacto sobre apuração; status deve ser auditável e passível de reconhecimento.
- Apuração aprovada e dados alterados: estado de revisão obrigatório antes de transmitir.
- Competência fechada alterada: contador de revisões e histórico em Contabilidade, não só linha colorida.
- Erros de envio: mostrar canal, última tentativa, motivo conhecido e opção de retentar canal afetado.
- Custos de consulta externa e limite de chamadas: sinalização discreta, confirmação se necessário, cache atualizado e política de atualização.

## Operações seguras

- Aplicar confirmação proporcional ao impacto, não em cada clique trivial.
- Bulk actions devem contar selecionados, válidos, inválidos e explicar quais serão pulados; apresentar resultado por item, não apenas 'sucesso' global.
- Retentativa é idempotente; transmissão com retorno desconhecido exige consulta antes de novo POST.
- Excluir oportunidade no onboarding: confirmar, verificar vínculos e preservar logs conforme política de retenção.
- Reabrir competência: persistir estado, confirmar permissões, apresentar efeitos; não permitir sobrescrita silenciosa de lançamentos.
- Recalcular guia: selecionar uma ou várias elegíveis, confirmar parâmetros e data, manter histórico de versões e não tocar em guias não selecionadas.

## Responsividade e acessibilidade

- Usar texto e ícone + cor para status. Alvos interativos adequados. Foco visível, navegação por teclado, botões com nome acessível.
- Sem scroll horizontal da página inteira quando tabela poderia ter scroll próprio ou colunas adaptadas.
- Layout no desktop compacto sem reduzir fontes e controles a ponto de prejudicar legibilidade; em telas menores, priorizar ações e informações centrais.

## Validação de dados

- `0`, `—`, `Sem dados`, `Não consultado`, `Não aplicável`, `Pendente`, `Sem guia exigível` são semanticamente distintos.
- Comparativos só existem com bases completas e comparáveis; diferenciar série temporal descontínua de zero.
- Totais contábeis devem demonstrar base, competência e componentes de principal, juros e multa, sem duplicar provisão e pagamento.
- Persistir origem (manual, extraído, SERPRO, calculado), timestamp, versão e usuário para operações críticas.

## Testes de UX obrigatórios em cada PR

- Tarefa principal completada sem navegar por três telas quando poderia ser contextual.
- Lista vazia, carregamento demorado, timeout, falha por item, usuário sem permissão, registro alterado por outro operador.
- Filtros e contadores reconciliados; copiar/baixar/abrir documentação funcionando.
- Visão de cliente com 1, 4 e dezenas de guias; parcelamentos com/sem débito automático; notas tardias; meses fechados.
- Comparação visual antes/depois em screenshots, mantendo padrões e features existentes.

## Definition of Done de UX

A alteração está pronta apenas quando interação real, fonte dos dados, estados, erro, acessibilidade, consistência visual e navegação foram verificados. Compilação e testes unitários sozinhos não bastam.
