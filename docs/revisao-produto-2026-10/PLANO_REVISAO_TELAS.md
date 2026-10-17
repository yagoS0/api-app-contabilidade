# Plano de revisão de telas

Todos os itens abaixo são especificações de revisão futura. Referências R/V pertencem à fonte operacional existente; referências IMG estão no [catálogo visual](REFERENCIAS_VISUAIS.md). A aprovação de aparência não aprova cálculo fiscal, política de envio ou alteração de dados.

## TELA-01 — Controle de empresas

**Base:** relato do usuário e R01–R22; print inicial não recuperado. Problemas relatados: empresas do Presumido exibem apenas número sem progresso esperado; execução de rotina/upload/envio não se reflete com clareza na tabela; falhas de comunicação ficam difíceis de localizar.

**Proposta:** manter a tabela como primeira superfície de controle. Colunas essenciais: empresa, regime, competência/contexto, apuração, guias, comunicação e próxima ação. Identificadores e metadados ficam subordinados ao nome. Não expandir a tabela com todas as informações fiscais. O resumo de guias abre detalhe inline, conforme proposta já registrada na seção 18 da fonte viva.

**Exemplo fictício:** Empresa A · Presumido · 09/2026 · Revisada · `3/4 disponíveis` · `2 enviadas · 1 falha` · Conferir envio. No detalhe, mostrar a guia faltante e os canais da guia que falhou; não inferir que esses contadores formam conjuntos exclusivos.

**Comportamento:** R08/R09 definem expectativa e unidade; V03 permanece necessária para consolidações. Estados financeiros não sobrescrevem disponibilidade documental. Aplicabilidade incompleta exibe `A verificar`. Sem guia exigível conserva ação de inclusão excepcional. Clicar na empresa e clicar na ação têm alvos distintos; selecionar linha não navega.

**Aceite:** T01/T06/T07/T10/T12 da fonte viva; inserção manual válida muda o resumo sem executar rotina; recarga mantém resultado; filtro da carteira e detalhe concordam; nomes longos não escondem ação; uso por teclado e celular sem rolagem horizontal global. Cobrir Simples, Presumido, Real, empresa sem receita com folha e parcela em débito automático.

## TELA-02 — Central de operações

**Base:** relato e R19–R22; print inicial não recuperado. Problema: grupos misturam pendências documentais, comunicação e erros; cartões precisam sintetizar trabalho e levar a uma fila útil.

**Proposta:** cabeçalho com competência e atualização; cartões compactos para apurações pendentes, guias faltantes, envios pendentes, erros ativos, notas processadas e notas posteriores. Cada cartão contém número e unidade. Selecionar filtra a tabela na mesma página; filtro ativo fica visível. Outras competências ficam em grupo separado. Configuração de rotinas não domina acompanhamento.

**Fila:** empresa, competência, item, etapa, motivo, responsável quando disponível, atualização e próxima ação. `Erros ativos` precisa de etapa e causa legível; um número vermelho sem destino não serve. Resultado de lote persiste na tela mesmo se a empresa sair do filtro após sucesso.

**Conferência:** tabela com revisão por empresa, receita/base, anexo aplicado, mudança de anexo, divergências das notas, fechamento das notas com data, valor apurado e diferenças relevantes. Contador aprova ou devolve cada empresa para revisão. Liberação final resume somente empresas revisadas e versões correspondentes; não aprovar itens fora da página sem declarar alcance.

**Modais:** execução apresenta seleção e consequências; resultado separa sucesso, falha, recusa e resultado incerto. Não usar modal apenas para explicar métrica.

**Aceite:** total dos cartões igual ao total da fila paginada; troca rápida de período não mistura respostas; versão alterada invalida liberação; liberar lote não aprova empresa pendente; reprocessar falha não retransmite sucesso; teste de indisponibilidade mantém última leitura identificada, sem zero artificial. V07 governa recorte e atualização.

## TELA-03 — Anotações e WhatsApp

**Observado IMG-01:** duas áreas úteis, mas formulário de anotação permanentemente aberto, controles repetidos nos cartões, cabeçalho e identidade repetidos no histórico e ação longa para ampliar a conversa. Print não demonstra falha de envio.

**Proposta:** preservar painel duplo no desktop; cabeçalho de notas com contador, filtro/ordenação e `Nova anotação`; editor aberto por ação. Prioridade e autoria legíveis, ações secundárias em menu; fixadas no topo com indicação textual. Pedidos ao contador permanecem fila própria. No chat, contato/empresa identificados no cabeçalho e em mudanças de contexto, sem remover identidade necessária à segurança da conversa.

Em celular, alternar Anotações/Conversa com rascunhos preservados. Compositor alcançável com teclado virtual; anexos com prévia e remoção antes de enviar. Mensagens distinguem pendente, enviada, entregue, lida se comprovada, falha e incerta. Não converter recibo de envio em pagamento.

**Integração:** anotação interna nunca é enviada ao cliente por consequência de salvar. Pagamento informado pelo cliente conserva origem e encaminha à conferência conforme política existente/V04. Identidade e destinatário precisam estar resolvidos antes do envio.

**Aceite:** alternar painéis preserva rascunhos; erro mantém texto; nova tentativa não duplica mensagem entregue; mudança de empresa não reaproveita destinatário anterior; exclusão interna não remove conversa. Cobrir nomes longos, anexos, mensagens extensas, falha e conversa vazia.

## TELA-04 — Lançamentos

**Observado IMG-02:** barra com várias categorias de menus, totais em chips, tabela agrupada e fechamento lateral; há rótulos pequenos e uso forte de negrito. Não concluir que lançamentos estejam errados pelo print.

**Proposta:** manter tabela como foco. Cabeçalho da competência com `Novo lançamento`; ações frequentes de importação/conferência próximas; configuração e funções eventuais agrupadas por intenção. Grupos contábeis mostram subtotal e quantidade sem duplicar totais em várias regiões. Fechamento permanece painel compacto no desktop, seção ordenada abaixo do conteúdo no celular.

**Dados:** data, débito, crédito, histórico, valor e origem acessível no detalhe. Edição inline respeita o fluxo existente; salvar/cancelar explícitos, validação de contas e período, sem trocar dados ao mudar empresa. Provisão não é pagamento. Receita e provisão derivadas do extrato têm vínculo com documento e revisão.

**Aceite:** erro de gravação mantém edição; totais e saldo de débitos/créditos correspondem às linhas; extrato repetido não duplica lançamentos; reabertura contábil persiste sem alterar transmissão fiscal; ausência de receita não marca automaticamente folha, despesas e pagamentos como conferidos. Testar fechamento com pendências, sem permissão, concorrência e recarga.

## TELA-05 — Notas fiscais

**Observado IMG-03:** alerta amplo de período fechado, múltiplas ações e cartões antes da tabela, competência repetida e ação de marcar cancelamento em cada linha. A data de emissão diferente da competência exige contexto, não correção presumida.

**Proposta:** contexto → resumo de validação → filtros → tabela. Manter NFS-e/NF-e e direção das notas claramente separados. Ação primária depende do trabalho ativo; importação/busca/recorrência ficam secundárias. Consolidar alerta em quantidade, efeito e `Revisar notas`, mantendo detalhe da consequência fiscal.

**Validação automática:** cada nota tem resultado, regras aplicadas e versão, severidade e motivo. Erro bloqueante impede a etapa dependente; aviso exige tratamento previsto, sem bloqueio indiscriminado. Mostrar emissão, competência e entrada no sistema no detalhe. Nota posterior à transmissão ou importação tardia relevante gera revisão da base, sem retificação silenciosa.

**Cancelamento:** distinguir ajuste local da situação oficial; rótulo deve corresponder ao efeito real. Não fazer o usuário acreditar que marcar na base cancelou nota no órgão.

**Aceite:** reimportação deduplica; cancelada/substituída atualiza base conforme regra; erro de busca não zera receita; lote mistura válidas/avisos/erros sem sucesso global enganoso; marco e revisão do alerta ficam rastreáveis. V07a define o marco ampliado além da transmissão.

## TELA-06 — Circular

**Observado IMG-04:** matriz anual com muitas células coloridas, etiquetas verticais de aberto/fechado, origem/baixa repetidas e botões de extrato/recibo. As cores competem com os valores.

**Proposta:** manter matriz anual e subtotais trimestrais. Identificar fechamento em coluna ou indicação horizontal legível. Reduzir fundos saturados, usar texto de estado e detalhe por célula para origem, principal, juros/multa, pagamento e documentos. Extrato/recibo disponíveis sem colocar o extrato na carteira principal.

**Semântica:** apresentar provisionado, pago e saldo sem misturar unidades ou competências. A falta de faturamento conhecido não vira zero. Fechamento contábil não declara imposto pago. Totais devem tratar registros desconhecidos como cobertura parcial.

**Aceite:** guia recalculada não duplica principal; pagamento parcial e estorno recompõem saldo; soma mensal/trimestral/anual reconciliável com lançamentos e guias; cabeçalhos e mês legíveis durante rolagem local; impressão mantém identificação e totais. Inspecionar o ano completo, não só o recorte da imagem.

## TELA-07 — Parcelamentos

**Observado IMG-05:** lista vazia, seletor de mês, criação e seção de conferência recolhida. Imagem não demonstra comportamento de acordo com parcelas; o defeito de débito automático vem do relato.

**Proposta:** lista de contratos com órgão, identificação, situação, forma de pagamento, parcela do período, vencimento e próxima ação. Expandir para parcelas e histórico. Separar `Guia pendente` de `Débito a conferir`. Vazio curto com ação de criação, sem tabela simulada.

**Regras:** parcela com débito automático dispensada de documento não entra em falta/envio de guias; permanece acompanhamento financeiro. Vigência e exceções são por período/parcela. Falha de débito comprovada difere de ausência de confirmação. Não criar cobrança alternativa apenas por vencimento. Preservar R17/R18 e V06.

**Aceite:** acordo com guia, débito automático, primeira parcela excepcional, mudança de modalidade, atraso sem confirmação e falha bancária demonstrável; parcelas continuam distintas de DAS corrente; filtros e total de Empresas/Guias/Operações concordam; histórico não é reescrito pela modalidade atual.

## TELA-08 — Relatórios

**Observado IMG-06:** avisos de comparação e dados parciais repetidos; cartões reiteram ausência de comparação; gráfico com pontos esparsos e referências do período exigem interpretação cuidadosa.

**Proposta:** cabeçalho com período, cobertura e exportação. Um aviso consolidado de comparabilidade com detalhe de fontes; métricas mantêm valor atual e comparação quando válida. Gráfico deixa lacunas explícitas e permite tabela acessível de valores. Respeitar subabas Visão geral, Clientes, Resultado e Tributário.

**Regras:** ausência não equivale a zero. Faturamento documental, DRE, despesas e guias têm fontes distintas e devem ser identificáveis. Não inferir caixa/pagamento de valor por competência. Não aplicar indiscriminadamente ao escritório as restrições de acesso do portal do cliente; preservar as regras específicas já existentes.

**Aceite:** intervalo completo, parcial, vazio e sem comparação; fonte e período do relatório coincidem com exportação; gráficos não conectam artificialmente meses desconhecidos; valores reconciliados com origem; impressão com clientes de nome longo e muitas linhas não corta conteúdo. Não alterar fórmulas para melhorar aparência.

## TELA-09 — Apuração

**Observado IMG-07:** comandos semelhantes juntos, resumo financeiro, tabela inteira de faixas e painel de Fator R antes de concluir a atividade central. Estado não iniciado e classificação não confirmada precisam guiar a próxima ação.

**Proposta:** etapa atual e pendências → resumo da base e cálculo → conferência → transmissão/documentos. Tabela de faixas, memória de cálculo e simulações em detalhe acessível; anexo vigente, origem, mudança e divergência ficam visíveis. Não esconder base incompleta.

**Conferência por empresa:** receita interna/externa, ajustes, segregações conforme motor existente, RBT12/cobertura, anexo anterior/atual, motivo da mudança, folha/Fator R quando aplicável, fechamento das notas, resultado SERPRO e divergências. Apuração automática termina aguardando conferência humana. Consulta/cálculo não é transmissão.

**Transmissão:** ação específica sobre revisão aprovada; recibo/protocolo persistido comprova conclusão. PDF e extrato têm processamento próprio. `Reabrir apuração para retificar` preserva declaração anterior e demanda nova revisão; não mostrar sucesso sem persistência.

**Aceite:** cálculo válido, divergente, base incompleta, mudança de anexo, revisão vencida, transmissão recusada/incerta, retorno tardio, guia indisponível após transmissão e reabertura. Repetir requisição não duplica ato fiscal. Simulação nunca aparece como valor oficial confirmado.

## TELA-10 — Guias

**Observado IMG-08:** título por vencimento e competência abaixo, várias ações de consulta/histórico, contagem total simples, status de envio agregado e linha digitável extensa. Há guia antiga recalculada junto às atuais.

**Proposta:** contexto de competência e vencimento explícito; resumo `disponíveis/esperadas`, faltantes e envio. Tabela com tipo/obrigação, competência, valor vigente, vencimento, documento, envio e pagamento separados. Linha digitável completa e valores anteriores no detalhe; copiar continua acessível. Pendências antigas em grupo identificado.

**Regras:** upload só passa a disponível após validação; extrato não substitui guia; reimportação não cria nova expectativa; versão substituída não pode ser enviada como atual. Resultado por WhatsApp/e-mail/destinatário acessível; erros aparecem também na carteira. Recalcular cria versão vinculada, conserva histórico e não quita dívida. Envio da nova versão segue liberação aplicável.

**Aceite:** 3/4 guias; zero exigível conhecido; expectativa desconhecida; guia manual; recálculo; falha de parsing; e-mail entregue/WhatsApp falhou; pagamento informado/confirmado; débito automático; reenvio seletivo; arquivo com empresa errada rejeitado. Testar após recarga em todas as superfícies.

## TELA-11 — Situação fiscal

**Observado IMG-09:** relatório com data e status, consulta com aviso de custo, documentos e grupos Contabilidade/Receita/PGFN. Há formatos de data distintos e total interno separado do oficial.

**Proposta:** manter separação por fonte, data da evidência e abrangência. Cabeçalho mostra situação do último relatório e atualização; consulta paga distinta de abrir documento salvo. Resumo conciso e filtros; detalhes técnicos/proveniência recolhidos, mas custo, restrição e consequência visíveis antes de consultar.

**Regras:** pendência interna e dívida oficial não devem ser somadas cegamente; podem representar a mesma obrigação. Relatório antigo não comprova situação atual. O limite de quatro horas visível no print é referência histórica da UI, não regra fiscal nova nem configuração a fixar neste pacote. Conferir contrato/configuração vigentes antes da implementação.

**Aceite:** nunca consultada, atualizada, desatualizada, com pendência, erro, restrição de consulta e PDF ausente. Atualização falha preserva relatório anterior com data. Filtro/exportação parcial mostram escopo. Não disparar consulta externa só por abrir página ou atualizar estado visual.

## TELA-12 — Planejamento tributário

**Observado IMG-10:** seis campos na mesma linha, bloco largo de premissas, muitos avisos fiscais abertos e configurações avançadas; título aparece cortado no limite esquerdo do recorte, causa a confirmar em navegador.

**Proposta:** organizar Dados da empresa e período → Receita/base histórica → Folha → Atividade/anexo → Premissas específicas → Comparação. Origem de cada dado pré-preenchido acessível; destacar conflitos que mudam o resultado. Orientação consultiva extensa pode ir para critérios; conflito entre cadastro e perfil permanece visível e acionável.

**Comparação:** resultados por regime com tributos e cobertura; premissas pendentes não viram zero. Simulações salvas têm versão e cenário. Alterar cenário não altera cadastro fiscal nem apuração oficial. Fonte/vigência de tabelas e hipóteses acompanham relatório.

**Aceite:** cenário completo, incompleto, atividade fora do catálogo, conflito de anexo/Fator R, ausência de folha, ajustes manuais e comparação indisponível. Mudança de empresa limpa cenário anterior; campos não saltam ao chegar resposta tardia. Impressão conserva premissas e limitações. Não inferir enquadramento definitivo apenas por CNAE nem incluir valores tributários inventados.

## TELA-13 — Oportunidades/onboarding (complemento do relato)

**Base:** pedido anterior para excluir oportunidades; sem imagem recuperada. Manter ação específica para entidade e estado. Proposta V08: excluir rascunho elegível sem vínculos; arquivar quando existe histórico relevante, com restauração. Não aplicar exclusão do onboarding automaticamente à oportunidade.

**Aceite:** vínculos carregados e revalidados ao confirmar; concorrência cria vínculo e impede exclusão; arquivar preserva empresa/conversa/documentos; erro mantém registro; confirmação informa nome e consequência. Permissões e políticas ainda pendentes precisam de decisão antes da implementação correspondente.

## Critério transversal de encerramento

Cada tela entrega evidência antes/depois, estados normal/vazio/carregando/erro, casos específicos acima, navegação por teclado, celular e integração com consumidores. Uma tela não está concluída enquanto seu número divergir de outro módulo para o mesmo recorte e revisão. Diagnóstico visual é independente de homologação tributária.
