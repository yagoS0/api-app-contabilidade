# Continuidade de Operações após o layout aprovado

Base da revisão: produção `4eb64b8b` (PR #215), comparada com a especificação original de automação por empresa e jornada da guia ao pagamento. Esta entrega avança uma fatia do plano; não declara concluídos os 32 critérios originais.

## Mapa atualizado e ordem de execução

| Frente | Situação comprovável no código | Próxima entrega |
| --- | --- | --- |
| Operações e navegação | Quadros clicáveis, modais, empresas habilitadas/não habilitadas, Calendário real no modo dia; publicado na PR #215. | Preservar estrutura e componentes. A configuração permanece dentro da empresa. |
| Conciliação PGDAS-D | Procuração, evidência de entrega, extrato/recibo e DAS local, inclusive upload manual; execução explícita busca lacunas. | Manter invariantes e impedir sequência de consultas após bloqueio da guarda. |
| Aprovação e notas retroativas | Confirmação/liberação com revisão fiscal, tentativa persistida e avisos para revisão; sem retificação automática. | Preservar aprovações, histórico e bloqueios, sem alterar fechamento. |
| Pausa por empresa | Seleção de rotina não era uma barreira comum para botões e chamadas compostas. | **Fatia atual:** pausa de operações SERPRO, revisão/auditoria e autorização final antes do transporte. |
| Políticas por competência/etapa | Seleções existentes são por empresa/rotina. | Exceções por competência, origem efetiva e modos manual/externo/não aplicável; não reinterpretar seleções existentes. |
| Pró-labore e INSS manual | Controle mensal local implementado: cadastro de pró-labore, exceção justificada, responsável, prazo operacional, observação e conferência dos PDFs já armazenados. Usa os modais e upload existentes. | Validar rotina operacional com a equipe; eventual comunicação de cobrança e folha transmitida seguem separadas. |
| Guia lógica e revisões | Guide, hash, ingestão e recálculo restrito existem. | Substituições/complementares, identidade da obrigação e invalidação de intenções antigas. |
| Informação de pagamento | Fluxos existentes recebem informação/comprovante e consultam pagamento. | Separar informado/em conferência/confirmado e revisar todos os consumidores antes de migrar. |
| Comunicação | Transportes, tentativas, callbacks e avisos existentes. | Pausa de mensagens, intenção por revisão e suspensão humana comum; não abrangidos pela pausa SERPRO. |
| Orçamento | Guarda de quantidade e reservas de chamadas. | Tarifa e reserva monetária por contrato/produto; não chamar quantidade de chamadas de custo confirmado. |
| Workflow durável | Execução de Operações tem tentativa persistida; scheduler e serviços existentes são reaproveitáveis. | Coordenação por efeito compartilhada com legado, eventos/outbox e migração por etapa. |

## Contrato da fatia atual

Decisão posterior do usuário: Simples e Lucro Presumido têm rotinas diferentes. As opções da empresa e as contagens de Operações usam a aplicabilidade do regime cadastrado, mesma fonte dos workers atuais. DAS, extrato PGDAS-D e parcelamento do Simples são próprios de Simples; a rotina Presumido é própria do Lucro Presumido. INSS, pagamento e conferência ADN permanecem opções compartilhadas, subordinadas às condições e seleções já existentes. Regime desconhecido exige conferência e não entra como empresa desabilitada. Escolhas antigas não aplicáveis permanecem armazenadas, sem serem contadas ou reativadas por esta entrega. Mudança de regime invalida uma prévia de salvamento antiga.

Isso não adiciona execução de Lucro Presumido ao liberador de PGDAS-D de Operações: o fluxo fiscal próprio de LP continua existente e separado. Exceções históricas por competência dependem da futura política por competência; esta configuração é a participação atual nas rotinas.

- GET/PUT `/firm/companies/:companyId/automacao` preservam rotinas, `expectedRevision` e `requestId`. Acrescentam `serproPolicy` com pausa, motivo e autoria/data da última alteração. O servidor valida acesso novamente e audita antes/depois na mesma transação.
- Configuração ausente preserva o funcionamento atual; não habilita nem desabilita rotinas. Pausa exige ação explícita e motivo. Salvar e retomar não executam consultas, não reexecutam tentativas nem acumulam chamadas atrasadas.
- A pausa abrange operações realizadas pelo `SerproHttpClient`, inclusive consultas, simulações e transmissões, manuais ou automáticas. Não pausa outros conectores nem mensagens; a interface deve dizer isso sem prometer uma pausa universal.
- Documentos e respostas locais válidas são reaproveitados antes da autorização fiscal. Uma pausa não apaga PDFs, extratos, recibos ou evidências. Retificação explícita não deve usar documento antigo como se fosse a nova versão.
- Reserva verifica a empresa por CNPJ normalizado exato. Identidade ambígua/inválida não permite transporte; contribuinte válido fora do cadastro e operações sem contribuinte seguem a guarda global, sem uma política de empresa fictícia.
- Depois de autenticar, a autorização de despacho é persistida e ordenada com o salvamento da pausa pelo mesmo lock. Pausa salva antes dessa autorização impede a rede. Uma chamada já autorizada pode concluir; não há transação aberta durante HTTP.
- Override administrativo de orçamento não ignora pausa. Falha de leitura/persistência não libera HTTP. Reservas incertas não são repetidas e não são apagadas pela pausa ou retomada.
- Em Operações, bloqueio na primeira busca interrompe as próximas buscas da mesma tentativa, preserva documentos já salvos e mostra motivo legível na conferência. Não altera o status fiscal nem transforma erro em declaração ausente.

## Verificação e limites

Testes cobrem salvamento/revisão/idempotência/acesso; pausa antes da reserva e durante autenticação; ausência de transporte no bloqueio; cache e documentos locais; uma chamada composta interrompida; motivo visível e persistido. Ensaio PostgreSQL isolado deve demonstrar a ordenação pausa/despacho, separação entre empresas e preservação de chamadas autorizadas. Provedores devem ser simulados, sem chamadas fiscais ou mensagens reais.

Esta fatia contribui para A01, A03–A05, A07, A21, A25 e A28 **somente no escopo SERPRO descrito**. Não certifica A02 (exceções), A06 (posse entre todos os executores), A24 (tarifa monetária) nem os critérios de revisões/comunicação/pagamento. Resultados de testes e publicação devem ser registrados após execução, sem inferi-los do código.

## Implantação e reversão

### Continuação em 16/10/2026 — INSS manual

GET/PUT `/firm/companies/:companyId/operacoes/:competencia/inss-manual` e GET `/firm/operacoes/inss-manual?competencia=YYYY-MM` usam exclusivamente o banco. Estado mensal em AppSetting, auditoria por solicitação, revisão dos documentos e cadastro, revalidação do acesso dentro da transação e idempotência. Prazo é interno definido pelo contador, nunca vencimento legal inferido. Responsável é identificação operacional, não concessão de acesso.

A configuração fica recolhida em Automação da empresa. Pendências entram no quadro de Guias existente, com resumo compacto e links para configuração/Guias. Não há tabela nova, alteração do Calendário, ativação automática de rotina, emissão, consulta SERPRO, envio ou baixa de pagamento. INSS pode ser acompanhado em ambos os regimes; DAS/extrato/rotina Presumido conservam sua aplicabilidade anterior.

Sem exceção mensal, a indicação atual de pró-labore serve como referência e fica identificada na tela; não é reconstrução histórica da folha. Exceção exige motivo, inclusive ao voltar ao cadastro. Guia existente contradizendo uma dispensa permanece em revisão. PDF processado no banco é documento disponível, não prova de transmissão, entrega ao cliente ou pagamento. Registro VAZIO não satisfaz documento necessário. Guia de parcelamento não satisfaz INSS mensal. Ponteiro de armazenamento legado sem PDF no banco exige conferir disponibilidade em Guias, sem download automático ou nova captura fiscal.

Testes locais: 39 testes de backend (serviço/rotas/Operações), 62 de interface/mock antes dos dois cenários adicionais de integração, depois os 6 testes de projeção/integração passaram. Conjuntos se sobrepõem. Ensaio de formulário em computador e 390px, com dados fictícios, sem rolagem horizontal. CI inclui ensaio PostgreSQL de concorrência, idempotência, documento local e isolamento empresa/competência. Resultado de implantação deve ser conferido após o CI.

Persistência aditiva em AppSetting e ledger existentes; nenhuma migração destrutiva ou reclassificação em massa. Nenhuma empresa recebe pausa por padrão. Publicar API e UI compatíveis, verificando CI e saúde antes de testar somente leituras em produção. Não alterar configurações de clientes para demonstrar o recurso.

Uma reversão para código sem a guarda ignoraria pausas salvas. Se for necessário reverter após uso da pausa, primeiro interromper os executores afetados ou manter a guarda no patch de reversão; preservar políticas, auditoria e reservas. Não limpar tentativas para permitir replay.
