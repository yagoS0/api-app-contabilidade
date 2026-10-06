# Fluxo mensal da carteira

Implementado em desenvolvimento em 06/10/2026. A tabela tem Empresa, Status, Apuração, Guias, Contabilização, Situação fiscal e Ações. Seleção em lote permanece como controle adicional.

## Regras

- Status indica a primeira etapa ainda pendente: Apuração → Obrigações → Guias → Contabilização → Importação → Concluído. Fechar o mês não esconde guias ou obrigações pendentes.
- Apuração separa cálculo conferido de transmissão. No Simples, observa o snapshot da apuração; operações externas podem ser confirmadas com evidência. No Presumido, cálculo e transmissão externa têm confirmações separadas. Abrir uma consulta de cálculo não registra conclusão.
- Guias mostram círculo vazio quando faltam, verde quando disponíveis e o canal do envio confirmado. Falhas e acompanhamento de parcelamento mantêm sinalização própria.
- Contabilização acompanha o fechamento. Importado exige confirmação dos lançamentos efetivamente importados no ERP; baixar/exportar CSV não basta. Importação parcial mantém Fechado e mostra a quantidade confirmada. Mês fechado sem lançamentos dispensa importação, mantendo Fechado.
- Evidências ficam vinculadas aos dados conferidos. Alterar lançamentos ou reabrir o mês invalida a confirmação correspondente de importação. Alterar a base da apuração exige nova conferência externa.
- Situação fiscal permanece independente. Parcelamento aparece em texto secundário; sozinho não comprova regularidade. Consulta antiga ou inconclusiva não recebe Em dia.

## Rotinas e agenda

Correção solicitada pelo dono: removidos o botão Rotinas do mês e os seletores adicionais de Status e Contabilização. As etapas são cadastradas como obrigações recorrentes na agenda existente, com regras, empresas vinculadas e conclusão individual. A lista oferece modelos de apuração/transmissão por Simples e Presumido, conferência de obrigações do Presumido, guias, fechamento e importação. O contador configura prazo interno e empresas antes de salvar; nenhum prazo fiscal é inferido. Tarefas específicas usam o cadastro normal da agenda.

Os verificadores CARTEIRA_* observam a mesma projeção da tabela, inclusive reabertura quando a evidência muda. A ação Conferir etapa abre a evidência da empresa e competência corretas; exportação de CSV continua sem confirmar importação no ERP. Essas obrigações não entram na própria dependência fiscal. Registros antigos e seu histórico são preservados; agendamentos legados deixam de duplicar a etapa quando ela já possui ocorrência nativa na mesma competência.

O Simples tem transmissão da apuração e só recebe a tarefa adicional de obrigações quando há obrigações específicas cadastradas. O Presumido mantém a conferência das obrigações do período. A lista de obrigações aplicáveis continua sendo configurada no cadastro/agenda existente; não se inferem declarações tributárias universais pelo regime.

Guias e fechamento são concluídos pela operação real. Confirmações externas exigem evidência; obrigações cadastradas pendentes não podem ser substituídas por uma confirmação genérica. Leituras não fazem consultas pagas nem enviam mensagens.

## Persistência e acesso

Migração aditiva `20261006220000_fluxo_carteira`: tabela CarteiraTarefa, vinculada à empresa, competência e chave da tarefa, com versão e histórico. Publicada na PR #110. A integração das etapas às obrigações usa as tabelas existentes e não exige nova migração.

GET/POST `/firm/companies/:companyId/fluxo-carteira[/:chave]` e GET `/firm/agenda/carteira` respeitam o escopo da empresa. Gravação exige ACCOUNTANT. Versão, conferência de evidências e transação serializável recusam gravações desatualizadas.

A projeção e a validação são compartilhadas pela API e pelo mock. O mock mantém tarefas durante a sessão; a API persiste no banco.

## Verificação

Testes de projeção, validação, acesso às rotas, leitura da tabela e calendário. O ensaio `scripts/testar-fluxo-carteira-local.mjs` usa registros sintéticos no banco local e cobre histórico, agenda, isolamento, importação parcial, alteração dos lançamentos, reabertura e concorrência. Remove somente os registros criados pelo próprio ensaio.

Prévia visual: `http://127.0.0.1:5173/carteira-dev.html`, exclusivamente com dados fictícios. Não é uma entrada do build de produção.
