# Altan — revisão integrada em desenvolvimento

16/10/2026. Árvore `altan-revisao-produto-dev`, branch `codex/revisao-carteira-operacoes-20261016`. Trabalho coordenado em três frentes: fiscal, contábil e comunicação/rotas, com integração de Empresas e Operações pelo agente principal. Sem publicação em produção.

## Abrir e validar

Aplicação completa: http://127.0.0.1:5276/companies?visao=tabela

Se o login aparecer, usar `revisao@example.test` e `somente-dev`. Ambiente mock: dados fictícios e integrações simuladas. O servidor fica ativo localmente. A aplicação usa as telas reais; as páginas `revisao-dev.html` e `revisao-contabil.html` são apenas cenários controlados adicionais.

Os quatro Markdown fornecidos estão na raiz e são referenciados por AGENTS.md. As regras operacionais desta árvore e a referência central foram reconciliadas. A decisão posterior de remover legendas sob Guias substitui os exemplos antigos: não restaurar a linha “1 faltante · 2 enviadas · 1 falha”.

## Mudanças e cobertura do plano

| Área | Entrega e comportamento preservado |
| --- | --- |
| Empresas | Cobertura compacta disponível/esperada; cor semântica imediata, expansão com documento e envio separados, ações existentes; nenhuma legenda secundária sob o status. Falha conhecida não é ocultada por cadastro zerado. |
| Operações | Filas de apuração, guias faltantes, envios, erros e revisão; cartões e listas usam o mesmo conjunto. Detalhe contextual e confirmação de envio. Falha de leitura não vira zero. Resposta tardia não contamina outra competência. Calendário e rotinas existentes preservados. |
| Notas fiscais | Auditoria em faixa compacta, contador e acesso direto; preservados captura/importação, notas posteriores, justificativa e filtros. |
| Apuração | Reabertura confirmada com motivo, releitura e proteção concorrente. Transação grava revisão e auditoria com snapshot anterior. Recuperação do cálculo salvo corrigida no mock. Fator R desconhecido não simula carregamento. |
| Guias | Estados documental, envio e financeiro separados. Retirada legenda “Processada” repetida. Recálculo identificável, ações/canais/histórico mantidos. |
| Situação fiscal | Erros não viram “não consultado” nem sucesso. Bloqueio síncrono de consulta duplicada; origem e atualização existentes preservadas. |
| Planejamento | Exceções CNAE deduplicadas sob expansão junto ao campo. Premissas, cenários, insuficiência de dados e impressão preservados; decisões recentes de estrutura enxuta mantidas. |
| Lançamentos | Fechar/reabrir exige confirmação efetiva; erro e releitura não repetem escrita. Pré-verificação detalhada sob demanda. Estado vazio móvel corrigido. |
| Circular | Fechamento deixa de pintar a linha toda de verde; situação de cada obrigação permanece legível. Matriz, trimestrais, documentos e baixa explícita preservados. |
| Parcelamentos | Filas recusam resposta incompleta; não exibem vazio falso. Ajuda extensa sob demanda; contrato, parcela, débito automático e contabilização permanecem separados. |
| Relatórios | Retirada identificação duplicada e repetição de comparação ausente nos KPIs. Aviso único abre cobertura; dados ausentes não viram zero. |
| Anotações/WhatsApp | Leitura isolada por empresa/contexto, exclusão recusada mantém confirmação, suporte com retry explícito. Conversa e notas mantêm disposição existente. |
| Documentos/onboarding | Filtros documentais e erros claros; mock isolado por empresa e persistência de metadados. Descarte de rascunho conserva confirmação, versão e bloqueio por vínculos. |

Matrizes detalhadas: [Fiscal](REVISAO_FISCAL_DEV.md), [Contábil](REVISAO_CONTABIL_DEV.md), [Comunicação e rotas](REVISAO_COMUNICACAO_ROTAS_DEV.md). Elas distinguem implementação nova, recurso já atendido, proposta substituída por decisão posterior e decisão de negócio pendente. O registro da primeira fatia em IMPLEMENTACAO_DEV.md é histórico, não o estado final desta revisão.

## Apuração até contabilização: provas e limites

1. Navegador: receita fictícia → calcular → salvar → recuperar conferência → transmitir no mock → reabrir com motivo. Nenhuma transmissão fiscal real.
2. Backend: testes de fechamento, SERPRO, operações, guias, contabilidade e rotas; retornos inválidos não concluem operação. Extração de receita/DAS ausentes não é tratada como zero.
3. PostgreSQL descartável: migrações aplicadas; geração contábil real a partir de extrato sintético repetida duas vezes produz uma receita e uma provisão. Lembrete sem entrega confirmada bloqueado; com evidência da revisão correta, concorrência não duplica aviso.
4. Recálculo simulado e mensagens/tokens persistidos. Confirmação CLIENTE conserva origem/data, não modifica principal da provisão nem cria baixa. Rotas HTTP reais da circular e pagamentos pendentes conferidas, inclusive 401 sem sessão.
5. O banco descartável foi encerrado. Meta/SERPRO foram substituídos nos ensaios. Não é prova de uma única transação ponta a ponta com provedores reais nem de homologação tributária.

## Verificações executadas

| Conjunto | Resultado |
| --- | --- |
| Regressão API abrangendo a cadeia fiscal/contábil | 170 suítes, 2.123 testes aprovados; mudanças posteriores rechecadas nos conjuntos abaixo |
| Correções PGDAS/execução | 25 testes aprovados |
| Reabertura e procedência do DAS | 39 testes aprovados |
| Empresas, Operações e estilos | 26 suítes, 263 testes aprovados |
| Operações após teste adicional de resposta tardia | 17 testes aprovados, com sobreposição ao conjunto anterior |
| Fiscal UI e recuperação mock | 79 + 3 testes aprovados |
| Contábil UI | 89 testes aprovados; mais 9 na rechecagem final de montagem/fechamento, com sobreposição |
| Comunicação/rotas/mock | 82 na primeira rodada e 30 na rodada final dirigida; conjuntos sobrepostos, não somar como testes únicos |
| PostgreSQL descartável | 11 verificações aprovadas |
| Navegação completa | 14 rotas em 1440 e 390 pixels: 28 capturas carregadas, sem exceção JS, página vazia ou overflow global |
| Cenários Empresas/Operações | 22 capturas e interações: expansão, filas, erro, vazio, carregamento, cobertura e envio simulado |
| Build | Vite concluído; aviso de chunks grandes permanece |

Evidências locais: `test-evidence/rotas-produto`, `test-evidence/revisao-produto`, `test-evidence/revisao-contabil`, `test-evidence/comunicacao-dev`, `test-evidence/fiscal` e `test-evidence/revisao-produto-pg-1792171858408`. Capturas lazy incompletas de tentativas iniciais não contam como validação; preferir a passagem final de rotas.

Lint não foi aprovado: a configuração preexistente importa `eslint/config`, incompatível com ESLint 8 instalado. Isso é uma limitação separada do build e dos testes. Rodadas interrompidas por contenção da máquina não foram contadas como aprovadas; casos relevantes foram reexecutados.

## Limites que continuam explícitos

- Propostas V01–V08 não se tornam aprovadas pela execução geral do plano. Matriz tributária por vigência, denominador universal de PDFs consolidados, novas políticas de pagamento/dispensa e exclusão comercial continuam dependentes das decisões registradas.
- Cobertura atual conta obrigações com guia e declara essa unidade; não afirma contar PDFs. INSS manual conserva projeção complementar; não se declara equivalência integral com toda a carteira homologada.
- Alertas de notas usam todas as competências e distinguem recorte recente do total. Não foi criado contador de notas processadas sem fonte confirmada.
- O mock não reproduz toda integração automática de apuração para guias/lançamentos. Persistência contábil foi verificada separadamente em PostgreSQL pelos serviços reais com entrada sintética.
- Arquivos de documentos enviados ao mock ficam na memória da aba; metadados/notas persistem na sessão. Após recarga, ausência do binário é erro explícito, sem fabricar PDF.
- As decisões específicas de cada módulo prevaleceram sobre desenhos genéricos antigos: tabela de anexo aberta, estrutura enxuta de planejamento e calendário/rotinas preservados.

## Roteiro para a revisão humana

1. Empresas: expandir Guias, comparar cobertura, cores e ações; alternar competência.
2. Operações: abrir cada cartão, conferir total/lista, detalhes e navegação para a empresa.
3. Na empresa: percorrer Notas → Apuração → Guias → Lançamentos → Circular; conferir separação entre transmissão, documento, envio, pagamento informado e baixa.
4. Conferir Parcelamentos, Relatórios, Situação Fiscal, Planejamento, Anotações e Documentos no mesmo contexto.
5. Repetir em tela estreita; detalhes extensos devem abrir sob demanda, tabelas largas rolam em seu contêiner e erros não desaparecem como sucesso.

Impacto operacional: implementação dos contratos R02, R04–R06 e R19–R22, registrada também no histórico da fonte central. Sem nova regra fiscal ou política financeira e sem publicação.
