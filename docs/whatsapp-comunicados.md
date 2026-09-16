# Comunicados pelo WhatsApp

Implementação de 16/09/2026 para avisos importantes à carteira. Não usa IA. O escopo inicial é texto e links pelo WhatsApp; e-mail, anexos, agendamento e reutilização de listas/modelos não fazem parte desta versão.

## Operação

1. Na central de WhatsApp, abrir **Comunicados → Novo comunicado**.
2. Informar título interno e texto completo (até 900 caracteres). Avisos gerais começam como **Marketing**. **Atualização de serviço contratado** solicita Utilidade, apenas quando o conteúdo corresponde a uma atualização específica de serviço existente.
3. Selecionar toda a carteira ou empresas. **Conferir destinatários** exibe os contatos cadastrados, empresas representadas e motivos de exclusão. É possível desmarcar números. Contas/vínculos no portal não são requisito.
4. **Salvar prévia** guarda texto e público, sem submissão nem envio. O mesmo número exato aparece uma vez, mesmo em três empresas. Números diferentes com/sem nono dígito não são unidos por suposição.
5. **Enviar para aprovação da Meta** cria um modelo próprio com corpo completo e rodapé institucional, sem variáveis. **Consultar aprovação** lê o modelo da Meta; só o texto, idioma e componentes exatos são aceitos. A categoria final é exibida, inclusive se a Meta a alterar.
6. Após aprovação, **Revisar e enviar → Confirmar envio** coloca os destinatários pendentes na fila. Mudança de cadastro, consentimento, modelo ou categoria exige nova revisão. A fila continua com a página fechada.
7. Acompanhar por contato. **Enviado** significa aceite com identificador da Meta; **Entregue/Lido** vêm dos recibos. **Processamento concluído** pode conter falhas. Cancelar interrompe os pendentes; uma chamada já iniciada pode terminar.

Cada destinatário recebe uma mensagem individual; a lista não é exposta aos clientes. Respostas entram no histórico individual existente. O comunicado não muda a empresa fiscal selecionada pelo cliente, não concede acesso e não reabre a janela de mensagem livre sozinho.

## Meta e custos

Fora das 24 horas desde a última mensagem do cliente, a plataforma exige modelo aprovado. Opt-in e pedidos para deixar de receber precisam ser respeitados no cadastro. Aviso geral não é automaticamente Utilidade; não usar `reabrir_conversa` para finalidade diferente nem transformar todo o comunicado em `{{1}}`. A aprovação pode demorar ou ser recusada; este fluxo não garante avisos instantâneos. Tarifas e limites de entrega/categoria são os vigentes na Meta; nenhum consumo de Anthropic participa do fluxo.

Fontes oficiais consultadas: [política do WhatsApp Business](https://business.whatsapp.com/policy) e [mensagens de Utilidade](https://business.whatsapp.com/products/conversation-categories/utility).

## Persistência e retomada

- Migration aditiva `20260916110000_whatsapp_comunicados`: tabelas `comunicados_whatsapp` e `destinatarios_comunicado_whatsapp`. Gerar Prisma e aplicar migrations antes da API/worker.
- Rascunho tem chave idempotente; submissão reserva estado antes da chamada. Se a resposta de criação for incerta, consultar pelo nome exato. Não repetir POST de criação cegamente. Modelo recusado/texto diferente exige novo comunicado, mantendo a auditoria anterior.
- `whatsappDurableWorker` processa com `INTEGRACAO_WHATSAPP=1`, CAS por destinatário e lease da mesma conversa/responsável. Usa as credenciais e os limites existentes de `WhatsappCloudClient`; gestão exige acesso `whatsapp_business_management` à WABA configurada. Credenciais não aparecem em URLs, erros nem tela.
- Antes de cada destinatário, conferir modelo aprovado, categoria, operador ativo e consentimento. Antes da rede, conferir novamente operador, versão da confirmação e contato atual. Revogação, troca de número ou cancelamento interrompe o envio.
- `SaidaWhatsappService` registra antes da rede, com `turnoIaId=comunicado:<destinatarioId>`, referência da pessoa e ID do comunicado. Recibos reaproveitam o webhook existente.
- Não há retry de falha nem de resultado incerto. Reserva sem desfecho há 15 minutos vira INDETERMINADO; conferir o histórico antes de qualquer novo aviso. Indisponibilidade da consulta Meta pausa o comunicado. Consultar aprovação e confirmar novamente retoma apenas pendentes elegíveis.
- A implantação não cria comunicado, não submete modelo e não envia nenhuma mensagem por si só.

## Validação

Testes unitários: `comunicadosWhatsapp.test.js` (agrupamento, consentimento, modelo, prévia, transporte de gestão sem retry/segredos), `whatsappComunicados.test.js` (perfis, escopo e erros), `comunicadosWhatsapp.test.jsx` (criação, seleção, aprovação, confirmação e polling somente leitura).

`scripts/verify-whatsapp-comunicados-postgres.js` roda após migrations no PostgreSQL descartável `127.0.0.1:55439/whatsapp_delivery_check`, usuário `whatsapp_check`. Verifica idempotência, submissão/confirmação/workers concorrentes, opt-in alterado, categoria/texto alterados, cancelamento, operador revogado, timeout, rejeição HTTP, recibos fora de ordem e reserva interrompida. Meta/transporte são sintéticos; rede HTTP bloqueada. O workflow CI executa essa prova com Prisma gerado e todo o histórico de migrations.

Prévia visual local usa somente dados fictícios. Nenhuma homologação de entrega a clientes é presumida a partir dos testes.
