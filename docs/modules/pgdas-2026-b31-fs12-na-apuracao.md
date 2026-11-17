# PGDAS-2026-B3.1 — FS12 exclusivamente na Apuração

## Decisão do proprietário e estado da entrega

Em 16/11/2026 o proprietário restringiu o preenchimento e uso da FS12 à Apuração do Simples Nacional. Esta decisão substitui o desenho amplo da [proposta B3](pgdas-2026-b3-integracao-segura-fs12.md), não os achados de caracterização. Não haverá cadastro geral de folha nem integração com DP, Drive, eSocial ou Contabilidade. A informação será uma declaração mensal do contador dentro da apuração, não comprovação automática de folha por fonte externa.

Base confirmada: `434ae8405d63cdf314ac594f10902d874c341338`, integração do PR #293. Esta entrega é **somente uma proposta para aprovação antes de schema ou migração**. Não altera interface, cálculo, payload, autorização, regras operacionais em execução ou dados. B3.2 não foi iniciado.

Aplicam-se R01/R02/R06/R19/R20/R22 e a [arquitetura vigente](../governance/ARQUITETURA.md). A referência operacional canônica permanece com hash `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`, igual ao snapshot. O alcance aprovado e os cenários futuros estão registrados aqui; sua consolidação na referência operacional deve acompanhar a implementação aprovada, sem converter este desenho de banco em regra já autorizada.

## Experiência manual proposta

Reutilizar `FechamentoModal`, `Fs12DeclaratoriaPanel` e os componentes existentes da [B2](pgdas-2026-b2-interface-validacao-fs12.md), na própria empresa e competência da Apuração. Não criar menu, cadastro paralelo, anexos obrigatórios nem tela em outro módulo.

1. O servidor resolve empresa, competência e janela pela política B1. A tela apresenta os meses exigidos e a situação da consulta. Dados cadastrais insuficientes continuam pendentes, sem janela inventada.
2. Cada mês admite vazio ou valor monetário não negativo. Vazio não vira zero; `0,00` digitado é zero explícito. Não preencher automaticamente zeros, valores contábeis ou agregados anteriores. Valores legados podem continuar visíveis como rascunho identificado, nunca como confirmação nova.
3. Mostrar `X de Y meses preenchidos`. Somente quando todos os meses necessários forem válidos, mostrar o total como **Total informado — ainda não confirmado**. Soma e validação em centavos, com limite inteiro seguro; total incompleto não será exibido como FS12 nem como zero.
4. A ação **Confirmar valores da folha desta apuração** apresenta empresa, PA, meses e total. O servidor autentica, autoriza e valida novamente. Somente após persistir retorna **Valores confirmados por [contador] em [data]**, com revisão. Confirmação não significa cálculo, conferência ADN, transmissão ou aceite da Receita.
5. Editar valores confirmados cria rascunho local e exige nova confirmação explícita. A revisão anterior continua consultável. Edição não sobrescreve valores utilizados e não recalcula, retifica ou transmite. Erro de gravação conserva o rascunho na sessão e não apresenta sucesso. Não guardar conteúdo fiscal em localStorage por padrão.
6. Ao reabrir a mesma apuração, carregar a última revisão confirmada e distinguir a revisão utilizada no cálculo selecionado. Outra competência começa sem confirmação herdada; não propagar alterações entre PAs que compartilhem meses.

A confirmação da série é suficiente como declaração manual autenticada do contador neste recorte: não exigir evidência documental externa nem fingir que ela existe. A origem será `MANUAL_APURACAO`; autoria, instante e revisão vêm exclusivamente do servidor. A interface não enviará `CONFERIDA` como prova nem escolherá identidade empresarial alternativa.

## Persistência mínima proposta — não implementada

Evitar uma tabela por mês e um cadastro compartilhado entre apurações. A série de até doze meses pertence à confirmação de uma apuração específica. Proposta de **duas estruturas restritas à Apuração**, cujos nomes físicos serão definidos somente após aprovação:

| Estrutura | Dados mínimos e invariantes |
| --- | --- |
| Revisão FS12 da apuração | ID, PortalClient autorizado e Company resolvida pelo servidor, PA da apuração, número de revisão, série ordenada `{mes, valorCentavos}`, versão da política, contexto mínimo de abertura/regime e sua revisão/hash, hash da série, autor e instante da confirmação, chave de repetição e motivo quando substituir uma confirmação. Registro imutável, unicidade empresa/PA/revisão e chave de repetição escopada. Não armazena nomes de empregados, rubricas, documentos ou credenciais. |
| Uso da revisão FS12 no cálculo | Vínculo imutável empresa/PA/calculoId → revisão confirmada. A unicidade impede trocar a revisão de um mesmo cálculo. Não registra transmissão presumida: a associação a declaração efetivamente transmitida continua pelo resultado fiscal existente do cálculo, cuja preservação deve ser testada antes de conectar o motor. |

O vínculo de uso é parte do desenho para aprovação; sua conexão ao motor **não será implementada nesta entrega nem antecipará B3.2**. Antes de implementar essa conexão, verificar se o registro fiscal existente preserva permanentemente calculoId e número/versão da declaração mesmo após reabertura. Se não preservar, apresentar extensão mínima do vínculo para aprovação, sem inventar rastreabilidade nem alterar histórico. O snapshot mutável e ConfigMemory não substituem o registro imutável.

Não persistir rascunhos parciais em nova tabela neste primeiro recorte: apenas confirmações completas. O total é derivado da série, não uma segunda fonte mutável. A última revisão é obtida por empresa/PA e ordem de revisão, sem tabela de ponteiro vigente ou cadastro mensal global. Não criar materializações contábeis, eventos, filas ou consumidores fora da Apuração.

Confirmação usa uma única transação local: validar acesso atual, contexto e revisão esperada; inserir revisão e trilha mínima de autoria/motivo. A própria revisão imutável é a evidência de confirmação; se a governança exigir auditoria existente adicional, gravá-la na mesma transação. Unicidade e isolamento apropriado impedem duas confirmações sobre a mesma revisão anterior. Conflito retorna erro explícito e permite recarregar; não mesclar silenciosamente.

Repetição com mesma chave e mesmo conteúdo retorna a confirmação já registrada, após revalidar acesso. Mesma chave com conteúdo diferente é conflito. Autor e instante não são recriados em replay. Hash comprova integridade, não origem externa. Uma nova confirmação pode ter revisão esperada zero quando não houver anterior; autor, empresa, janela e versão continuam determinados pelo servidor.

Os modelos são aditivos, sem backfill: séries legadas, fs12Manual e formulários anteriores não se tornam confirmações automaticamente. Preservar tokens v1, cálculos e declarações históricas. Não acrescentar colunas sem leitor no incremento de implementação; planejar a criação do vínculo de uso junto ao seu consumidor, em entrega separada aprovada.

## Limites e contratos

Fiscal/Apuração é proprietário. Domínio B1 decide janela, completude e exigência declaratória; aplicação recebe operações específicas para ler e confirmar a série; adaptador Prisma mantém transação e isolamento. Apresentação reutiliza a guarda canônica por empresa antes de ler ou escrever. Não criar repositórios genéricos ou novos papéis.

Proposta de operações: `consultarFs12DaApuracao` e `confirmarFs12DaApuracao`. A leitura B2 mantém compatibilidade aditiva; a escrita nova só será definida e implementada após aprovação. Entrada: meses/valores, revisão esperada, chave de repetição e motivo da substituição. A identidade do ator vem da sessão e a empresa da rota autorizada. Campos desconhecidos de autoria/conferência não ganham autoridade.

Erros devem distinguir acesso negado, contexto indisponível, série incompleta/inválida e conflito de revisão. Nomes/códigos HTTP novos ainda não foram definidos. Preservar as respostas e a precedência de erros existentes. Logs não incluem série, valores fiscais ou tokens.

| Tema | Preservação obrigatória |
| --- | --- |
| Política temporal | B1 intacta: contrato histórico até 10/2026, exigência declaratória 11/12 de 2026 e homologação própria de 2027. Não reinterpretar abertura parcial para desbloquear. |
| Fator R | Consome dados somente onde a regra existente é aplicável; obrigatoriedade declaratória não altera III/V ou a fórmula. Não conectar automaticamente esta confirmação a cálculo neste PR. |
| Payload SERPRO | Série local completa não determina meses enviados. Lista vazia, histórico remoto e seleção permanecem critérios pendentes do B3. Nenhuma chamada, simulação ou transmissão nesta entrega. |
| Operações e automação | Sem escrita, liberação, rotina nova ou edição de folha fora da Apuração. A proposta não habilita caminhos automáticos nem altera seus contratos atuais. |
| Contabilidade/DP | Nenhum lançamento, baixa, provisão, fechamento, importação ou integração. Não usar valores desses módulos como preenchimento automático. |
| Cálculo já usado | Consulta conserva a revisão efetivamente utilizada. Nova série não altera cálculo confirmado, declaração, resultado incerto ou reserva. Novo ato exige fluxo próprio autorizado. |

## Critérios de aceite para implementação posterior

Estes são testes **planejados**, não resultados executados desta proposta.

| Cenário | Resultado exigido |
| --- | --- |
| Um mês vazio, todos zeros explícitos, série completa | Vazio mantém total indisponível; zeros completos totalizam zero; total correto em centavos, identificado como informado até confirmação |
| Duplicata, mês extra, negativo, precisão inválida ou soma excedida | Servidor rejeita sem gravação; sem arredondamento silencioso ou descarte de mês |
| Janela B1 nos quatro PAs, abertura e contexto insuficiente | Mesmo comportamento B1; 2027 não homologado; sem alteração III/V |
| Autoria forjada, empresa diferente, vínculo inativo/revogado | Guarda real recusa antes de escrita; identidade do corpo não substitui sessão/rota |
| Duplo clique, replay, duas conexões confirmando revisão antiga | Uma revisão efetiva por comando; conflito explícito; sem confirmação duplicada ou perda silenciosa |
| Falha de persistência/auditoria e recarga | Rollback integral; nenhuma confirmação visual falsa; revisão anterior preservada |
| Alterar contexto entre consulta e confirmação | Revalidação recusa contexto/revisão obsoletos |
| Editar após uso em cálculo ou declaração | Histórico permanece exato; nenhum recálculo, transmissão ou retificação automáticos |
| Meses comuns em PAs diferentes | Alterar um PA não sobrescreve outra apuração |
| Interface desktop/celular e teclado | Labels por mês, foco/erros acessíveis, estado de salvamento e total sem ambiguidade |
| Efeitos externos e outros módulos | Doubles comprovam zero chamadas fiscais, mensagens ou escritas contábeis na consulta/confirmação |

## Aprovação requerida e rollback

O proprietário já definiu local de preenchimento, origem manual, confirmação explícita e exclusão das integrações. **Não se pede novamente aprovação dessas decisões.** Falta aprovar o desenho mínimo: confirmação imutável da série por apuração, histórico de substituições e vínculo de uso por cálculo, com migração aditiva somente quando cada consumidor for implementado. Persistência de rascunhos parciais fica fora da proposta inicial.

Após essa aprovação, preparar implementação delimitada da entrada/confirmação na Apuração com controlador e testes reais, sem iniciar automaticamente B3.2 ou conectar transmissão. O funcionamento completo da apuração manual permanece objetivo; esta proposta não afirma que o bloqueio B2 foi resolvido nem que a nova fonte já existe.

Rollback documental: reverter os documentos/registro desta entrega. Na futura implementação, desabilitar comandos novos sem apagar confirmações ou vínculos históricos; reversão de código não desfaz ato fiscal. Migração reversa destrutiva não faz parte do plano.
