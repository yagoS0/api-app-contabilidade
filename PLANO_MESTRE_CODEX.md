# ALTAN — Plano mestre de revisão operacional e experiência do usuário

**Versão:** 1.0 — 16/10/2026  
**Destinatário:** Codex, agentes de implementação e revisão.  
**Escopo:** controle de empresas, operações, telas internas, fiscal, contabilidade, comunicação, relatórios e planejamento tributário.  
**Status:** especificação para diagnóstico; não confirma a arquitetura real do repositório.

## 0. Missão e limites

Evoluir o Altan para um ambiente de execução contábil integrado, consistente e minimalista. Corrigir regras de negócio, estados, integrações e UX sem descartar funcionalidades existentes. Preservar identidade dark e componentes existentes quando adequados; não produzir reformulação cosmética desconectada do fluxo.

**Obrigatório:** antes de codificar, inspecionar rotas, componentes, estilos/tokens, endpoints, modelos, migrations, jobs, filas, integrações, testes e logs. Mapear a origem de cada número e de cada estado. Apresentar diagnóstico, dependências, riscos e plano de migração; submeter proposta visual para aprovação. Nunca presumir APIs, regras tributárias, eventos, disponibilidade do SERPRO ou nomes de tabelas.

## 1. Arquitetura de informação

- **Nível 1 — Controle de empresas:** responder quais empresas exigem atenção, em qual competência, por qual obrigação; mostrar progresso sem sobrecarregar a linha.
- **Nível 2 — Central de Operações:** responder o que fazer agora e quais automações falharam; cartões clicáveis com contadores reconciliados às listas.
- **Nível 3 — Empresa:** análise e execução de documentos, apuração, guias, contabilidade, parcelamentos, comunicação e relatórios; manter contexto de empresa e competência.
- **Nível 4 — Detalhe:** histórico completo da obrigação/documento/guia/evento, em drawer ou página conforme complexidade.

Navegação interna atual: Anotações; Contabilidade (Lançamentos, Circular, Parcelamento, Relatórios); Fiscal (Notas Fiscais, Apuração, Guias, Situação Fiscal, Planejamento); Documentos. Avaliar consistência do singular/plural e nomenclatura, sem mudar URLs ou permissão sem transição.

## 2. Modelo operacional — fonte única de verdade

Não usar uma flag universal `concluido` ou campo `status` para representar todos os processos. Implementar ou adaptar modelo existente por **empresa + competência + obrigação + instância documental**, com eventos auditáveis.

Dimensões independentes:

1. **Aplicabilidade:** aplicável; não aplicável; indeterminada/necessita revisão. Ausência de faturamento, isoladamente, não implica ausência de obrigações ou de apuração sem movimento.
2. **Fiscal:** dados incompletos; notas validadas; apuração preparada; aguardando conferência; aprovada; transmissão em processamento; transmitida/confirmada; erro; revisão/retificação necessária; sem movimento declarado.
3. **Documental:** guia esperada; aguardando documento; disponível; substituída; dispensada pela modalidade; falha de geração.
4. **Comunicação:** não enviada; envio parcial; enviada por canal; erro; retentativa pendente. Controlar WhatsApp e e-mail separadamente.
5. **Financeiro:** a vencer; vencida; informação de pagamento pelo cliente; comprovante recebido; confirmado oficialmente/validado; divergência; recalculada/substituída. Não confundir 'entregue' e 'paga'.
6. **Contábil:** lançamento esperado; gerado; pendente de revisão; conciliado; registrado; fechado; alterado após fechamento.
7. **Automação:** agendada; executando; sucesso; resultado vazio; erro recuperável; erro bloqueante; pulada justificadamente; interrompida; reprocessamento pendente.

**Cálculos e contadores:** distinguir unidades (empresas, obrigações, guias, eventos, mensagens). Explicitar denominadores: `3/4 guias disponíveis`; `2/3 enviadas`; `1 enviada com falha`. Não contar guia de débito automático como documento exigível. Não perder obrigação porque não há guia. Não somar versões substituídas como guias distintas. Total dos cards deve bater com linhas filtradas e respeitar competência, permissões, empresa ativa e regime.

**Idempotência:** cada consulta, geração, transmissão, reenvio e lançamento deve ter chave lógica, resultado, timestamps, tentativas e marca de validade; impedir duplicidade e distinguir 'não consultado' de 'consultado sem resultados'. Reconciliar eventos assíncronos e reprocessamentos.

## 3. Fluxo Simples Nacional

`captura de notas → validação → preparar apuração → conferência humana → aprovação → transmissão PGDAS-D (conforme API efetivamente disponível) → confirmação/recibo → DAS + extrato → acompanhamento documental, envio e cobrança → comprovação de pagamento → contabilização e conciliação`.

- Validar existência/status, competência, duplicidade, cancelamento, substituição, valor e classificação tributária, com regras configuráveis por atividade e empresa. Alertas bloqueantes, revisão e informativos. Registrar `última sincronização` e `fechamento de base`.
- Nota emitida/cancelada/alterada após a transmissão: comparar com snapshot transmitido; gerar **alerta de avaliação de retificação**, não retificar automaticamente nem presumir que toda nota posterior obriga retificação. Reavaliar períodos subsequentes quando houver reflexo no RBT12.
- Conferência: receita por atividade, segregação/anexo, RBT12, fator R quando aplicável, regime de caixa/competência, retenções, valores externos, notas consideradas e excluídas, período de captura, alíquota, imposto e diferenças. Aprovação individual e em lote apenas das empresas elegíveis; revisão bloqueia avanço daquela empresa, não de todas.
- Guardar snapshot de entrada, usuário, data, versão dos parâmetros e hash/identificadores dos documentos conferidos. Mudança material invalida aprovação anterior.
- Transmissão: não confundir envio HTTP com confirmação oficial; persistir protocolo/recibo e evitar repetir tentativa com resultado indeterminado antes de consultar retorno.
- Extrato é evidência e insumo de lançamentos de receita/provisão, sem obrigatoriedade de aparecer como badge na tabela principal. Distinguir lançamento proposto, aprovado, contabilizado e estornado. Prevenir duplicidade.
- Empresas sem receita podem exigir transmissão sem movimento; status `transmitida sem DAS` é possível, diferindo de `não apurada`.

## 4. Gestão de guias universal

Guias podem ter origem em Simples, consulta a débito externo, folha/DCTFWeb, parcelamento, importação manual, recálculo. Cada guia deve referenciar obrigação, origem, competência do fato, período de vencimento, código, principal, acréscimos, total, status documental, situação de envio por canal, pagamento, versões e anexos.

- **Cobertura:** `esperadas`, `disponíveis`, `faltantes`, `enviadas`, `com falha`, `pagas`; permitir drill-down e filtros. Parcela em débito automático continua obrigação financeira, mas não exige subir/enviar guia se não há documento exigível.
- **Envios:** guardar tentativas, IDs de provedor, horário, canal e resultado (fila, aceito, entregue, falhou), não tratar disparo como entregue. Retentar seletivamente sem duplicar no canal bem-sucedido.
- **Acompanhamento:** lembretes de pré-vencimento, vencimento e pós-vencimento, condicionados ao status e consentimento/canal. Resposta de cliente não é comprovação automática. Registrar comprovante ou consulta oficial quando disponível; revisões humanas quando necessário.
- **Recálculo:** seleção por guia; elegibilidade, origem e API aplicável; preservar histórico/versões, documento anterior, juros, multa, novo vencimento e total. Só alterar a guia selecionada; status de outras guias intacto. Bloquear reenvio inadvertido de versão substituída; contabilizar diferenças sem duplicar principal.
- **Sem guia:** valor resultante de regra de aplicabilidade, dados fiscais, folha, tributo e forma de pagamento. Permitir importação manual e correção supervisionada. Marcar `sem guia exigível` distinto de `guia ainda não obtida`.

## 5. Lucro Presumido

Fluxo conforme escopo atual: `apuração externa → consulta de tributos por competência → obter e validar guias → contabilização de tributos → envio → acompanhamento`. A consulta agendada no dia **16** é uma regra operacional do escritório, **não prazo tributário universal**. Execução antecipada é permitida. Se resultado completo, válido e sem alteração posterior, pular reconsulta do dia 16 daquela combinação empresa/competência/tributo; se parcial, ausente, inválido ou falhou, tentar novamente. Permitir reconsulta manual consciente e registrar versão. Diferenciar tributos mensais e trimestrais. A ausência de retorno não equivale a ausência de débito.

## 6. Parcelamentos

- Cadastrar contrato ou receber parcela avulsa antes do contrato ser contabilizado; marcar vínculo/contabilização pendente, sem bloquear envio quando aplicável.
- `Forma de pagamento = guia | débito automático | outra` determina documentação exigível e controles de cobrança.
- Em débito automático: não gerar pendência de subir guia; monitorar ocorrência e confirmação do débito, inadimplência, insuficiência de saldo e regularização quando houver fonte confiável.
- Separar contrato, parcela, comprovante, lançamento contábil e baixa. Uma parcela pode estar paga e ainda não contabilizada.
- Conciliar parcela avulsa posteriormente com contrato sem duplicar guia/pagamento; permitir alteração/estorno auditados.

## 7. Competências fechadas

Reabrir competência deve alterar estado persistido e permissões reais, não só a interface. Para alteração permitida após fechamento, registrar antes/depois, motivo, autor, data e processos impactados; incrementar contador de pendências na aba Lançamentos/Contabilidade até reconhecimento, preservando trilha de auditoria. Evitar usar cor como único sinal. Bloquear automações que sobrescrevam lançamentos fechados sem política explícita. Definir regras específicas para fechamento fiscal vs contábil.

## 8. Revisão tela a tela (observações dos prints; validar com código)

### 8.1 Controle principal de empresas

**Observado:** chips extensos `DAS E-mail e WhatsApp`, `INSS E-mail e WhatsApp`; coluna Status compete com Apuração/Guias/Contabilização; incongruências aparentes entre `A apurar` e guias já enviadas.

**Alvo:** tabela densa e legível; resumo numérico de progresso com denominador por empresa (`3/4 disponíveis`, `2/3 enviadas`), estado de apuração, situação contábil e próxima ação calculada. Expansão da linha ou drawer para lista individual das guias, envios por canal, pagamentos, erros e justificativa. Separar situação fiscal de consulta federal de status de apuração. Linha navegável acessível, sem repetir botões 'Acessar' quando dispensáveis. Comparar status reais com respectivos eventos; nunca alterar fatos apenas para 'parecer coerente'.

### 8.2 Central de Operações

**Observado:** cards com números (concluídas, apurações, guias, erros, notas); área grande 'empresas nas rotinas', calendário e tarefas disputando atenção.

**Alvo:** agrupar em `Exigem ação`, `Em acompanhamento`, `Automações`; cards compactos e clicáveis com filtro equivalente e contagens reconciliadas; mostrar erros de importação, notas tardias, apurações para conferir, guias a obter, pendentes de envio e erros por canal. Área de rotinas em lista compacta com última execução, próximas execuções, empresas elegíveis/puladas/erro e acesso ao log. Calendário e tarefas em seção separada. Empty/loading/erro explícitos; evitar `Carregando rotinas...` permanente.

### 8.3 Anotações e WhatsApp

**Observado:** divisão em duas colunas útil; anotações, pedidos e mensagens competem por espaço. **Alvo:** preservar conversação ampla e histórico; sidebar com pendências/anotações priorizadas, marcadores de urgência discretos; diferenciar pedido do cliente, nota interna e evento operacional; ações previsíveis; falhas e pendências de pagamento contextualizadas; confirmação de pagamento não deve registrar baixa automaticamente. Manter registros de entrega e data.

### 8.4 Lançamentos

**Observado:** três níveis de toolbar, chips e filtros antes da tabela; sidebar mistura 'Mês sem faturamento' e fechamento; cabeçalhos e ações densos. **Alvo:** toolbar principal com ação primária, filtros e menu de ações secundárias; tabelas de lançamentos com grupos claros e balanço débito/crédito; fechamento contábil em painel coerente; avisos pós-fechamento com contagem e lista de diferenças. Evitar confundir status fiscal de faturamento com fechamento de escrituração. Garantir importação/exportação, atalhos, batch actions e estornos.

### 8.5 Notas fiscais

**Observado:** banner alto de 1 pendência, várias ações, cinco pequenos cards, filtros e tabela. **Alvo:** zona compacta de auditoria com contador e CTA de revisão; alertas junto às notas envolvidas, não bloco permanente desproporcional; separar captura/validação/emissão/importação em ações organizadas; consolidar totais com rótulos precisos (emitidas, recebidas, canceladas, falhas); não confundir data de emissão com competência. Evidenciar notas pós-fechamento ou pós-transmissão com impacto e ação adequada.

### 8.6 Circular (nova tela)

**Observado:** matriz anual por mês de DAS, INSS/CPP, faturamento, total em aberto, extrato; células inteiras coloridas, múltiplas linhas de texto, badges laterais de 'Aberto/Fechado', somatórios trimestrais. Há exemplo de INSS com 'Valor pago' diferente do valor principal e DAS vencido.

**Alvo:** preservar matriz ano × mês e subtotais trimestrais; reduzir saturação de fundos de célula; priorizar números alinhados à direita, status compacto e detalhes em popover/drawer; controles de ano sempre no mesmo padrão; não exibir `—` ambiguamente sem tooltip (sem dados, não aplicável ou zero); destacar diferença entre valor original, pago, atualizado, juros/multa e saldo. Célula pode exibir `R$ X · Pago` ou `R$ X · Vencido`, com detalhes no clique. Faturamento não representa pagamento; não usar fundo verde de linha inteira por mês 'Fechado' se isso mascara pendência específica. Extrato/recibo como ações agrupadas de documentos. Demonstrar competência versus vencimento, que pode ocorrer no mês seguinte; especificar regra das totalizações trimestrais. Não lançar baixa contábil sem comprovação.

### 8.7 Parcelamentos (nova tela)

**Observado:** grande espaço vazio, frase `Nenhum parcelamento cadastrado`, filtro mensal e longo accordion de conferência. **Alvo:** empty state útil com botão criar e opção conciliar/importar guia avulsa; visão por contrato com modalidade (inclusive débito automático), situação, parcelas a vencer/vencidas, saldo e contabilidade; drill-down para parcelas e comprovantes; pendências de contabilização explícitas. Accordion de operações secundárias sem esconder ações frequentes.

### 8.8 Relatórios (nova tela)

**Observado:** cabeçalho repetido com nome da empresa; aviso de comparação indisponível, aviso de dados parciais e card `pendências da base`; cinco KPIs exibem 'Anterior: sem dados' e 'Sem base comparável' repetidamente; gráfico com base temporal rala. **Alvo:** mostrar um banner discreto único de integridade/cobertura dos dados com link para detalhes; remover repetição por KPI quando todo o período não tem comparação; claramente distinguir dados incompletos de resultado zero; seleção de período consistente e visível; somente mostrar tendências e variações comparáveis quando base suficiente; gráficos não induzirem falsa continuidade sobre meses sem dados. KPIs e análises de clientes, resultado e tributos com unidades e definições explícitas; permitir exportação/ impressão sem ruído.

### 8.9 Apuração (nova tela)

**Observado:** painel alto com cinco ações lado a lado, indicadores, tabela completa das 6 faixas de anexo e seção extensa de Fator R mesmo quando simulação não muda atividade. **Alvo:** fluxo guiado de `base → validação → conferência → aprovação → transmissão/resultado`, com CTA principal contextual e botões secundários agrupados. Priorizar receita, RBT12, anexo, alíquota/estimativa, DAS e estado da conferência. Detalhes das faixas e parâmetros em disclosure sem esconder o enquadramento usado; Fator R só com destaque principal quando elegível/relevante; não exibir barra de progresso 'indisponível' simulando cálculo. Separar dados estimados/simulação do retorno oficial. Confirmar a nomenclatura/semântica de 'Calcular/Fechar'.

### 8.10 Guias (nova tela)

**Observado:** cabeçalho `Vencimentos de Outubro` com competência Setembro; 3 guias, inclusive competência Agosto vencida; ações subir/consultar/marcar vazio, pendências antigas; tabela tem status entregue (2/2) e aberto, linha digitável extensa, recalculado indicado apenas por ícone/valor pequeno. **Alvo:** separar visualmente competência tributária e data de vencimento, com filtro explícito; barra de resumo `esperadas / disponíveis / enviadas / pagas / vencidas`, mantendo documentos individuais; status distintos documental, envio e financeiro; mostrar origem, versão de recálculo e acréscimos de forma reconhecível; linha digitável truncada com copiar e detalhe; bulk actions apenas para seleções elegíveis; `Marcar vazio` não substitui cálculo automático de obrigação. `Pendências anteriores` deve abrir filtro contextual sem misturar silenciosamente períodos.

### 8.11 Situação Fiscal (nova tela)

**Observado:** status de relatório federal, última consulta, PDF oficial, filtros e seções 'Contabilidade', 'Receita Federal', 'Dívida ativa — PGFN'; botões 'Adicionar' em grupos. **Alvo:** explicitar origem/escopo e atualidade da consulta, inclusive custo/rate limit antes de ação onerosa; status geral não equivale a cada pendência; agrupar por órgão/origem e vencimento/gravidade; diferenciar informação consultada de registro local/manual; exibir divergências entre dados oficiais e contabilidade sem sobrescrever ambos; detalhar ação possível por item. Evitar botão `Recalcular guia` genérico desvinculado da guia selecionada e da API adequada.

### 8.12 Planejamento tributário (nova tela)

**Observado:** formulário largo, dados de premissas no mesmo plano, muitas observações em laranja, comparação de lucro real/Simples e fator R, campos vazios de lucro real e checkboxes. **Alvo:** criar estrutura `Premissas → Cenários → Comparativo → Sensibilidade/Relatório`; grade responsiva de campos por grupo, ajuda contextual e validação inline; separar dados extraídos do cadastro de hipóteses editáveis, com data e origem; alertas deduplicados e hierarquizados; indicar 'simulação' e insuficiência de dados, não tratar cálculo como aconselhamento definitivo; modelar múltiplas atividades e exceções sem confiar só no CNAE. Não colocar orientação fiscal extensa em lista persistente: usar tooltip/disclosure próximo da premissa correspondente. Cenários com IBS/CBS devem identificar ano e regras de transição e fonte normativa validada.

### 8.13 Documentos e onboarding

Inspecionar telas não anexadas e aplicar mesmo sistema. Onboarding: exclusão de oportunidade com confirmação, permissão, registro e tratamento seguro de vínculos. Documentos: organizar tipos, origem, competência, versão e estados; sem criar cards só por estética.

## 9. Regras de implantação

**Fase 0 — Descoberta:** inventário técnico; diagrama de dados/eventos; captura de screenshots baseline; matriz tela × ação × estado × fonte × teste; proposta de nomenclatura; plano de risco.

**Fase 1 — Design system:** consolidar tokens/componentes, estrutura padrão de cabeçalho, controle de competência, indicadores, tabela, status, alertas, modal/drawer e empty states. Testar acessibilidade e larguras comuns.

**Fase 2 — Motor de estados e integração:** reconciliação dos modelos existentes, regras de aplicação/contagem, origem de eventos, idempotência e logs, flags por empresa; migrations não destrutivas.

**Fase 3 — Tela principal e central:** primeiro vertical slice completo com estados corretos e filtros acionáveis.

**Fase 4 — Fiscal:** Notas → Apuração → Guias → Situação Fiscal → Planejamento, com testes de API e fluxos.

**Fase 5 — Contábil:** Lançamentos → Circular → Parcelamentos → Relatórios; confirmar semântica de competência/vencimento/baixa.

**Fase 6 — Comunicação, onboarding, documentos e regressão:** WhatsApp, e-mail, alertas, tarefas, acessibilidade, performance e responsividade.

**Ritual por fase:** apresentar diagnóstico e mock/wireframe antes de codar; pequena alteração por PR; screenshots antes/depois; lista de funções preservadas; critérios de aceite e testes, autorização para mudanças irreversíveis. Não refatorar tudo de uma vez.

## 10. Critérios gerais de aceite

1. Nenhum número da tela principal diverge do detalhamento sob mesmos filtros.
2. Empresa com 3/4 guias disponíveis apresenta 3/4, identifica guia faltante e não afirma que todas foram enviadas.
3. Apuração sem movimento e ausência de DAS são identificadas separadamente.
4. Guia via débito automático não cria pendência de upload nem envio; pagamento ainda é monitorado.
5. Recálculo de DAS não altera INSS nem parcela; mantém documentos antigos e novos, acréscimos e vínculos contábeis.
6. Confirmação do cliente não dá baixa sem evidência definida pela política operacional.
7. Reabrir competência altera dados persistidos; eventos pós-fechamento geram alerta auditável.
8. Consulta antecipada completa no Lucro Presumido é pulada no dia 16, mas falha/parcial não.
9. Nota posterior gera análise comparativa e alerta adequado, não retificação cega.
10. Contagens dos cards levam a listas filtradas com o mesmo universo.
11. Interface segue `DESIGN_SYSTEM.md` e `UX_RULES.md`, sem badges, avisos e toolbars arbitrários.
12. Todas as ações assíncronas têm loading/resultado/erro, retry seguro e trilha de eventos.
13. Sem perdas de recursos existentes, sem duplicidade de lançamentos/guias, com cobertura de testes e revisão visual.

## 11. Cenários de testes obrigatórios

- 4 esperadas; 3 disponíveis; 2 enviadas; 1 envio falhou; 1 pagamento confirmado.
- Empresa zero receita, mas PGDAS-D sem movimento exigível; empresa zero receita com folha/pro-labore e INSS exigível.
- DAS não aplicável; DAS ainda não obtido; consulta realizada com resultado vazio; consulta nunca realizada.
- Guia recalculada com juros/multa e substituição, outra guia da mesma empresa intacta.
- Guia vencida, confirmação de pagamento via WhatsApp, validação oficial pendente.
- Cliente informa não pagamento; cronograma de lembretes respeita estado atualizado.
- Parcelamento sem contrato contabilizado; conciliação posterior; débito automático falhou.
- Erro de envio WhatsApp com e-mail entregue; retentativa somente do canal com falha.
- Transmissão de apuração com timeout após envio; recuperação sem duplicação.
- Nota cancelada/emitida depois da transmissão e com impacto no RBT12.
- Alteração de lançamento em competência fechada; alerta contabilização; auditoria.
- Consulta do Presumido no dia 14 válida e completa; rotina do dia 16 pula; consulta parcial reexecuta.
- Mês sem dados versus mês com faturamento zero nos relatórios e circular.
- Mesma guia aparece no mês de competência e mês de vencimento sem contagem duplicada.

## 12. O que Codex deve devolver antes de implementar

1. Mapa da arquitetura real e arquivos afetados.
2. Matriz de divergências `requisito → comportamento atual → causa → solução`.
3. Proposta de modelo de eventos/estados e estratégia de compatibilidade/migração.
4. Inventário de design/tokens/componentes e wireframes das telas priorizadas.
5. Plano por PR, estimativa de riscos e testes específicos.
6. Perguntas de negócio apenas quando bloqueantes, com opções e impactos.

**Não declarar concluído por compilar:** comprovar fluxo ponta a ponta, consistência entre telas, teste de regressão e revisão visual.
