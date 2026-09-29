# Mensagem recebida sem conteúdo — 29/09/2026

A Meta pode notificar uma mensagem como unsupported ou unknown, com erro 131051, sem texto e sem identificador de mídia. O objeto unsupported pode trazer apenas type/raw_type unknown. O recebimento do aviso não significa que o conteúdo chegou ao sistema. Não é possível renderizar ou baixar um conteúdo que o provedor não entregou.

Fonte primária: [referência da Meta no Postman](https://www.postman.com/meta/whatsapp-business-platform/request/yuuxr2c/received-unknown-messages). O exemplo antigo usa unknown; o tratamento cobre também unsupported observado em produção. Não deduzir exclusão, visualização única, enquete ou qualquer outro tipo original.

- Preservar mensagem, idempotência e evento bruto do inbox. Não reprocessar a produção nem substituir o corpo por uma mensagem inventada.
- Não enviar esses avisos a mídia, coleta comercial, menu, seleção de empresa, fluxos fiscais ou IA. Código numérico disponível no log, sem detalhes privados.
- Mostrar Mensagem indisponível no WhatsApp na lista. No balão, explicar que o WhatsApp não disponibilizou o conteúdo.
- Preparar pedido de reenvio gera somente rascunho editável no mesmo interlocutor, segmento e canal. Recusar rascunho existente, operação pendente ou janela fechada. Envio continua pelo botão normal e pelas validações do servidor.
- Mensagens interactive/button com texto legível deixam de ser rotuladas como mídia desconhecida.

Testes com dados sintéticos e transporte simulado; nenhum envio real, consulta fiscal ou token da Anthropic. Sem migration e sem alteração de cadastros, permissões, aprovações Meta ou conteúdo histórico.
