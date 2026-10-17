# Revisão contábil em desenvolvimento — 16/10/2026

Escopo: Lançamentos, Circular, Parcelamentos e Relatórios. Árvore `altan-revisao-produto-dev`. Dados de navegador fictícios; nenhuma gravação em produção, consulta fiscal ou mensagem externa.

## Direção e impacto

Consultados os quatro documentos fornecidos, AGENTS, a referência operacional central e CLAUDE dos módulos. R02, R03, R05, R10–R12, R16–R20 e R22 orientam as correções. Não há alteração de cálculo fiscal, contabilização, autorização, banco ou contrato de pagamento. V01–V08 continuam pendentes nas partes de política de negócio. A rejeição expressa do usuário às legendas redundantes prevalece sobre os exemplos antigos de texto auxiliar permanente.

## Matriz de cobertura

| Meta do plano | Diagnóstico e entrega em dev | Situação |
| --- | --- | --- |
| Lançamentos: ações agrupadas | Configurações, Import/Export, Funções, SERPRO e Filtro já agrupados em menus; criação inline e seleção/exportação preservadas. | Já atendido na base, preservado |
| Lançamentos: fechamento próprio | Fechar/reabrir agora exige resposta confirmada e estado correto; resposta vazia ou recusa não libera escrituração. Erro fica no painel e releitura não repete escrita. Recarga solicitada depois do sucesso. Confirmação nomeia fechamento contábil e preservação da declaração fiscal. | Implementado |
| Lançamentos: divergências/avisos | Pré-verificação mantém resumo âmbar visível; grupos de achados sob demanda. Divergência de fonte e guias impedidas por mês fechado continuam visíveis, com ações existentes. | Implementado/preservado |
| Lançamentos: baixo ruído | Retirado detalhamento permanente do painel estreito; atalhos, importações, parcelas, baixa e estorno mantidos. | Implementado |
| Circular: mês fechado não mascara guia | Removido fundo verde sobre toda a linha; fechamento indicado na primeira célula, cores das obrigações permanecem independentes. | Implementado |
| Circular: trimestre/anual e documentos | Matriz, subtotais, totais em aberto, extratos, recibos e detalhes da célula preservados. | Já atendido na base |
| Circular: principal/pago/acréscimos | `estadoGuia`, `pagamentoEfetivo` e procedência já separam guia consultada, baixa, cliente e SERPRO; recálculo permanece aviso, sem alterar principal contabilizado. | Já atendido, verificado pelos testes existentes |
| Parcelamentos: contrato e parcela separados | Novo parcelamento usa wizard; Guias anexa parcela; gestão e conferência preservadas, inclusive contrato sem documento e rescisão reversível. | Já atendido na base |
| Parcelamentos: fila sem documento/erro | As duas filas agora rejeitam resposta sem array de parcelas e `ok:false`; erro não vira ausência de trabalho. Ajuda sobre parcelas sem guia foi movida para expansão. | Implementado |
| Parcelamentos: débito automático | Contrato e pagamento continuam independentes; vencer não comprova débito. Não se alterou vigência/primeira parcela/exceções pendentes V06. | Existente preservado; V06 pendente |
| Relatórios: sem repetição por KPI | Cards deixam de repetir “Anterior: Sem dados” e variações sem base. Comparação indisponível/dados parciais usa aviso único com acesso que abre a cobertura. | Implementado |
| Relatórios: contexto duplicado | Empresa permanece no cabeçalho comum, removida repetição interna em Relatórios. Identificação continua no documento imprimível e em consumidores independentes. | Implementado |
| Relatórios: séries e valores ausentes | Gráfico e cálculo compartilhados preservados; ausência não convertida em zero. Período próprio e DRE restrita a meses fechados conforme CLAUDE posterior. | Já atendido na base |
| Relatórios: integridade e navegação | Detalhes da cobertura, pendências acionáveis, impressão e período mantidos; links existentes levam a lançamentos/notas/guias. | Preservado |

## Percurso da apuração à contabilização

1. Apuração/extrato alimentam circular e eventos de receita/provisão; confirmação de envio não é pagamento.
2. Guia processada entra no `GuideToProvisionService`; guia e tributo não são sinônimos em documento consolidado.
3. `procedenciaDoPagamento.pagamentoAlcancaOContabil` impede que origem CLIENTE confirme provisão contábil; compatibilidade legada permanece conforme regra vigente.
4. Guia recebida com mês fechado permanece em `GuiasPendentesContabilizacaoService`. Contabilizar exige empresa correta, revisão `updatedAt`, mês aberto e transação serializável. Repetição de item já contabilizado retorna `jaContabilizada`; alteração concorrente recusa, lançamentos exportados não são sobrescritos.
5. Circular distingue confirmação do pagamento de baixa, com principal/juros/multa efetivamente baixados; ação de baixa é explícita.
6. Fechamento contábil depende das conferências existentes. Reabertura altera somente seu domínio; agora a interface comprova a resposta antes de liberar e solicita recarga.
7. Relatórios consultam fechamentos e fonte contábil, sem usar envio de guia como evidência de resultado/baixa.

Nenhuma dessas inspeções equivale a transmissão SERPRO real. Testes de backend da cadeia são consolidados pelo agente principal; este incremento contábil não editou o backend.

### Ensaio PostgreSQL descartável

Executado `scripts/run-revisao-produto-postgres.mjs` com PostgreSQL 16 local, banco novo após migrations, sem rede externa. **11 verificações aprovadas**, cluster encerrado com sucesso. Evidências: `test-evidence/revisao-produto-pg-1792171858408/summary.json`, `fluxo-guias.log` e `stop.log`.

O extrato sintético de receita 100/DAS 10 alimentou o **gerador contábil real**, duas vezes: uma receita e uma provisão, sem duplicação. O fluxo persistiu aviso antes/depois do vencimento, recusou lembrete sem evidência de entrega da versão atual, deduplicou avisos concorrentes e reentrega do clique, recalculou guia sintética para 11, registrou mensagens e tokens, pediu data de pagamento e persistiu confirmação concorrente do cliente. A geração contábil posterior preservou principal 10, provisão ABERTO e zero baixa. A rota HTTP real da Circular e a fila de pagamentos exibiram origem/data do cliente; sem sessão, acesso recusado com 401. Sessão autenticada injetada no teste, vínculo/guarda real no banco.

Transporte Meta, documento fiscal e recálculo SERPRO foram explicitamente simulados; este ensaio não atesta entrega por provedor ou retorno fiscal externo. Nenhuma guarda de produção foi afrouxada. A única correção necessária no script foi atualizar a asserção do texto de espera já corrigido na interface de comunicação.

## Validação

- Testes novos de resposta vazia/recusada/estado contraditório na reabertura; sucesso recarrega; erro de leitura não confirma abertura.
- Teste novo de resposta malformada nas duas filas de parcelas.
- Teste de comparação aberta atualizado: sem repetição por KPI e cobertura realmente aberta pela ação.
- Capturas dos componentes reais em 1440 e 390: `test-evidence/revisao-contabil`. Oito estados iniciais sem erro JS ou overflow da página; tabelas conservam rolagem local.
- Prévia isolada: `http://127.0.0.1:5276/revisao-contabil.html`, somente DEV/mock; não é entrada do build de produção.
- Cinco suítes dirigidas aprovadas, 89 testes: fechamentoConfirmado, parcelamentoSincronizacao, analiseEmpresa, verificacaoDeLancamentos e renderCircularTab. Uma execução ampla concorrente foi interrompida por contenção da máquina; não conta como aprovada.
- A inspeção móvel encontrou estado vazio de Lançamentos cortado pela largura mínima da tabela; a largura/colunas agora se aplicam apenas quando existem lançamentos ou edição inline.
- As capturas não homologam autenticação de todos os papéis, consultas pagas, impressora física ou integrações externas. A consolidação final inclui regressão após as correções visuais.

## Histórico

16/10/2026 — correção técnica de confirmação/erro e redução de informação repetida. Sem migração e sem nova regra operacional. A origem das políticas fiscais/financeiras permanece no documento central; não foi criada uma cópia de regras conflitantes.
