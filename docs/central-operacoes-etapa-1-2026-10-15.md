# Central de Operações primeira entrega

Implementação local de 15/10/2026 na branch `codex/central-operacoes-etapa-1`.

## Escopo entregue

- Nova visão Operações junto ao Calendário (Agenda atual) e Empresas. Link direto `/companies?visao=operacoes`; preserva sessão e navegação.
- Andamento por empresa e competência, com a mesma projeção de status da tabela Empresas. Operações não consulta tarefas/obrigações do Calendário, não usa suas datas e não altera seus componentes. Quadros e tarefas abrem pop-ups próprios; a resolução usa os destinos e ações existentes da empresa.
- Indicadores desta primeira entrega são empresas concluídas, apurações pendentes, pendências de guias e erros de envio. São contagens independentes, não parcelas somáveis. Não representam ainda aprovação humana de apuração ou sucesso fiscal. Falha de leitura aparece como indisponibilidade, não zero ou “Operando”.
- Configurações da empresa → Automação, rota existente de abas estendida com `/companies/:id/automacao`. Reutiliza `CompanyRotina`; não cria outra seleção paralela nem habilita nada por regime.
- Prévia da alteração, acesso por empresa, controle de versão, gravação transacional e registro de ator/antes/depois em AppSetting. Mesma solicitação repetida recupera o resultado salvo; corpo diferente com a mesma chave é recusado.
- A configuração geral de rotinas mantém horários e acompanhamento; seleção das consultas foi substituída por links à configuração de cada empresa. Salvar horários não manda nem sobrescreve as escolhas das empresas.

## API e persistência

`GET /firm/companies/:companyId/automacao` retorna somente rotinas, agenda salva e revisão; não expõe credenciais nem executa consulta. `PUT` recebe expectedRevision, requestId e alterações booleanas de rotinas; exige acesso ACCOUNTANT ou FIRM_ADMIN por empresa (admin global conforme middleware atual). A transação revalida o vínculo de operadores não-admin, recusa conflito e mantém auditoria no mesmo commit.

Não há migration nesta entrega. CompanyRotina continua sendo a fonte usada pelos workers atuais; AppSetting guarda a trilha/idempotência da alteração. O horário continua global por rotina, somente exibido dentro da empresa. Não foram adicionadas pausas universais, exceções por competência ou novo executor; habilitar/desabilitar tem o significado já existente de participação nas rotinas, não cancela chamadas em voo.

As rotas legadas permanecem compatíveis. Antes de ampliar o novo controle para pausas e despacho de efeitos, integrar todos os escritores/consumidores ao protocolo comum previsto no plano. A proteção transacional desta entrega não é certificação de concorrência de transmissão fiscal.

## Validação

- 67 testes web dirigidos aprovados: novos componentes, consistência com os status da tabela, separação de competências, erros, salvamento idempotente, navegação e regressões de configurações, rotinas e contexto de apuração.
- 8 testes API dirigidos aprovados: leitura sem habilitar, credenciais excluídas, gravação/auditoria, versão, idempotência, escopo e acesso revogado, mais serviço de rotinas existente.
- Build web aprovado; avisos existentes de tamanho de bundle/importação mista.
- Componentes reais conferidos em 1440, 768 e 390 px com CSS do aplicativo e API simulada: sem overflow ou erro JavaScript, prévia e salvamento exercitados. Capturas locais em `test-evidence/operacoes-etapa-1/` (ignoradas no Git).
- Nenhuma consulta fiscal, envio, dado de cliente ou configuração de produção foi usado no teste. Transações foram testadas com doubles; concorrência real PostgreSQL ainda será exigida antes da liberação em produção.

## Próximas entregas

Programação diária própria, independente do Calendário; aprovação operacional por versão, prévia persistida e liberação de apurações; política efetiva por competência e guarda de todos os efeitos; indicadores fiscais reais; adaptação documental de INSS; revisões de guias e pagamento informado. Esses itens permanecem no plano, sem botões que aparentem execução antes da implementação.

## Continuação: quadros e resolução de pendências

Layout aprovado aplicado aos componentes reais: quatro quadros clicáveis, tarefas compactas e Modal compartilhado com teclado e retorno de foco. Categorias contam dados locais reais; não usam números ou estados de aprovação da demonstração. Erros de envio vêm da mesma projeção de guias da tabela Empresas. Entrega bem-sucedida em outro canal prevalece sobre falha histórica, conforme contrato existente.

Pop-up mostra motivo e status fiscal separados. Abrir Guias e corrigir mantém empresa/competência; envio explicitamente confirmado reutiliza os callbacks da tabela e o guideId salvo. Recusa de reenvio WhatsApp bloqueia a ação; resultado incerto exige conferir histórico, sem retry. Mudança do documento entre prévia e confirmação bloqueia o envio. Abrir quadros, trocar competência e ler tarefas não consulta SERPRO nem envia mensagens.

42 testes dirigidos aprovados (Operações, chip de falha, navegação e horários). Componentes reais verificados em 1440, 768 e 390 px, incluindo pop-ups; sem overflow ou erro JavaScript. Build aprovado com os avisos preexistentes. Sem alteração nos componentes do Calendário, na tabela Empresas, nos estados fiscais ou na persistência dos documentos.

Limite desta entrega: aprovação/liberação de apurações e horários operacionais independentes ainda não persistidos. A tela mostra Tarefas pendentes, sem horário programado, em vez de fabricar uma programação diária. Nenhuma publicação em produção ou mensagem real foi realizada.
# Etapa 2 — confirmação, liberação e programação (15/10/2026)

Implementação local, ainda não publicada. Operações persiste confirmação, revisão, liberação e horário de conferência por empresa/competência. Estados são próprios de Operações e não substituem status fiscais nem de guias. Horários representam tarefas do escritório em Brasília; não ativam consultas, transmissão ou envio.

Rotas GET/PUT `/firm/companies/:companyId/operacoes/:competencia`, protegidas pelo acesso à empresa; escrita exige contador/administrador e revalida acesso dentro da transação. Persistência usa AppSetting com namespace `operations:v1`, separado das configurações SERPRO e do Calendário. Diário por requestId registra usuário, ação, antes/depois; transação serializável, revisão esperada e trava por empresa/competência. Repetição da mesma solicitação retorna o resultado salvo. Conflitos e falhas não são repetidos automaticamente.

A liberação em lote congela as empresas/revisões mostradas na prévia e grava por empresa. Uma falha interrompe o restante e informa quantas foram salvas. Ainda não há executor ligado a essa autorização; o fluxo fiscal existente continua sendo o caminho de execução. A interface informa esse limite expressamente. Não houve chamadas de DAS, extrato, SERPRO ou envio nesta etapa.

Confirmação exige cálculo salvo íntegro e compatível com os dados atuais, reutilizando RecuperacaoCalculo. Fingerprint local considera notas, cadastro, bases e snapshot. Leitura e escrita invalidam a aprovação exibida quando os dados mudam. Pendências posteriores ao fechamento bloqueiam confirmação/liberação. Auditoria original e evidência da confirmação anterior são preservadas.

Caso CDA confirmado pelo usuário: emissão em 03/10/2026, competência fiscal 09/2026 na nota. Reutilizar a captura e PendenciaPosFechamento existentes: revisão pertence a setembro; não mover para outubro, reabrir fechamento ou retificar automaticamente. A tela lista a pendência e liga à auditoria da empresa. A identificação depende da nota ser importada/capturada; não foi consultada a empresa real nesta sessão. Corrigida também a identificação de período transmitido quando a prova externa está em CompanyMonthlyCircular.pgdasNumeroDeclaracao.

Validação: testes de UI para confirmação/liberação separadas, persistência da programação ao remontar, bloqueio por nota retroativa e falha sem reenvio; testes do serviço e de pendências. Teste PostgreSQL descartável aplicou migrations e validou persistência, idempotência, conflito concorrente, programação, liberação, invalidação por pendência retroativa e preservação do estado fiscal. O teste real revelou a necessidade de converter o retorno void da trava consultada para text; corrigido em Operações e no serviço de ativação de consultas.

Limites seguintes: conectar liberação ao executor exige revalidação no momento de cada efeito fiscal; não consumir RELEASED como autorização eterna. Comparação de anexos mês a mês e explicação das divergências ainda são conferidas na central existente. A programação salva é conferência operacional, não agendamento de transmissão automática.

Resultado final desta etapa: 21 testes API e 45 testes web dirigidos passaram; build web passou com avisos preexistentes de bundle/imports. Teste PostgreSQL descartável passou. Prévia com dados simulados validada em 1440 e 390 px, incluindo pop-up, bloqueio por nota retroativa e liberação, sem overflow ou erros JavaScript. Capturas em `test-evidence/operacoes-etapa-2/`. A inspeção visual levou ao ajuste de contraste dos links e espaçamento/tamanho do campo de programação.

