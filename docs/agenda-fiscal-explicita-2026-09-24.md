# Agenda fiscal explícita

O usuário determinou que consultas externas geram custo e devem ocorrer somente conforme configuração salva. Após a consulta programada, retorno válido sem confirmação de pagamento deve gerar aviso ao cliente. Reconsultar a mesma obrigação fica a cargo do contador. O cliente continua podendo informar pagamento após recálculo.

O usuário escolheu consulta de pagamentos mensal no dia25, às08h, horário de Brasília. Aplicar somente em `rotinas.pagamento` e campos legados equivalentes, preservando as demais agendas.

## Regras

- Rotina habilitada, dia e hora precisam estar explicitamente persistidos; sugestões desabilitadas não autorizam consulta. Empresas novas não ganham rotinas por regime nem ao abrir a página.
- Frequência diária só quando explicitamente configurada; não cria novas tentativas para uma obrigação já consultada negativamente.
- Reservar no minuto configurado, usando Brasília, uma única vez. Não executar horários perdidos ao reiniciar. Se não existir o dia escolhido naquele mês, não antecipar para outra data; aguardar o próximo mês com o dia configurado, conforme aviso na tela.
- Não repetir por falha, execução parcial ou reserva expirada; impedir que um processo antigo continue após perder a reserva. Horários iguais são reservados juntos e processados em sequência, sem antecipar outras rotinas.
- Mudança/desativação da agenda enquanto aguarda impede iniciar a consulta enfileirada.
- Avisos não equivalem a cobrança comprovada ou baixa. Resposta técnica inválida não gera aviso de pagamento pendente.
- Consultas automáticas de pagamento pulam guias que vencem hoje, no futuro ou que não têm vencimento confirmado. A negativa válida encerra novas consultas automáticas da obrigação, inclusive depois de recálculo ou vínculo contábil. Marcadores por guia e parcela preservam a identidade.
- Preservar canais e consentimentos existentes; se envio não for permitido/disponível, a pendência deve aparecer para o contador.
- Enviar aviso sem PDF vencido, com links autenticados para a guia. Abrir link só abre a tela/diálogo, sem ato fiscal. DAS mensal e DARF LP podem recalcular no portal; INSS e parcelas orientam atualização pelo contador. Confirmação exige a data informada pelo cliente e liberação da guia.
- WhatsApp fora da janela de conversa depende de modelo aprovado específico; até existir, fica pendente, sem trocar canal nem usar modelo de envio de PDF. Enviado significa aceito no transporte, não comprova entrega. O histórico de conversas acompanha o retorno de entrega.
- A reserva por destinatário impede duplicação/timeout; uma rodada futura pode retomar aviso que ainda não chegou à reserva, sem fazer nova consulta fiscal. Resultado desconhecido de envio exige conferência manual.

Esta regra substitui a janela de três dias, recuperação de72h e três tentativas que constavam no plano anterior de parcelamentos. O monitor local de relógio não chama provedores.

## Conferência

Testes devem cobrir horário exato, horários perdidos, dias extras, falta de configuração, concorrência, reinício, falha sem retry, alteração na fila, negativo válido versus falha técnica e idempotência de consulta/aviso. Não usar consultas ou envios reais para testar.

Validação local: 462 testes de API em 45 suítes, 126 testes do portal em 15 suítes, três testes da tela de rotinas e compilação dos dois portais aprovados. Revisão independente e navegação no mock confirmam seleção da guia pelo aviso sem executar pagamento ou recálculo ao abrir o link. Integração PostgreSQL e regressão completa serão conferidas no CI antes da publicação. Nenhuma consulta fiscal paga ou mensagem real foi executada nos testes.
