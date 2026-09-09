# Correções de consumo SERPRO — 9 de setembro de 2026

- Reutilização de DAS/INSS com PDF salvo, mesma empresa e competência, excluindo parcelamentos. Recálculo explícito solicita nova versão, sujeito às guardas de custo.
- Extrato completo reutilizado antes de marcar RUNNING; ausência sem DAS reaproveitada por uma hora. A interface oferece Atualizar na Receita.
- Fechamento aproveita o índice consultado e a guia capturada. Retificação atualiza o PDF; falha não libera documento antigo para reenvio como atualizado.
- Cache persistente de uma hora para respostas documentais HTTP 200, com validação fiscal preservada. Transmissão, pagamentos, índice e SITFIS não usam esse cache. Resíduos expirados são removidos nas próximas gravações.
- JSON canônico evita assinaturas diferentes pela ordem de propriedades; bloqueios legados continuam sendo consultados. Ledger ganhou competência e identificador da ação.
- Autenticação compartilhada por processo. Ajuste de períodos e consulta de relatório SITFIS limitados a três tentativas por execução. Lotes param em teto mensal ou indisponibilidade/resultado indeterminado da medição.

## Validação

425 testes de backend passaram em 37 suítes; build da interface aprovado. Todas as migrations aplicadas em PostgreSQL descartável local, incluindo 20260909120000_serpro_respostas_cache. Oito verificações reais de concorrência, orçamento, cache, expiração e isolamento passaram, sem HTTP fiscal. Prisma Client de teste gerado isoladamente, sem modificar dependências de outros checkouts.

Jest da interface apresentou travamento local. A regressão completa será acompanhada no CI antes da integração à main.

## Publicação

Usuário autorizou main e produção em 09/09. Base atualizada para 162595a1, preservando correção de WhatsApp. O start:prod executa Prisma generate e migrate deploy antes de iniciar a API. Não subir código novo sem a nova migration.

Nenhuma consulta real ao SERPRO foi feita nos testes. Economia monetária depende de conciliar tentativas com o extrato do provedor; o ledger não comprova faturamento. Reservas históricas incertas não são liberadas automaticamente. Autenticação compartilhada funciona dentro de cada processo, não entre réplicas.
