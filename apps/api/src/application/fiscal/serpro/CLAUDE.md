# Guarda SERPRO — 2026-09-08

O ledger `SerproChamada` registra tentativas internas, não comprova cobrança. Não afirmar que o total de 2.555 relatado pelo usuário foi conciliado: faltam período, origem e extrato do provedor.

`autorizarChamada` reserva antes de autenticar/enviar. Transação PostgreSQL ReadCommitted com `pg_advisory_xact_lock(73517001)` serializa a checagem dos tetos e criação da reserva globalmente neste banco. Não manter a transação aberta durante HTTP. O modelo atual não tem firmId: o teto mensal é da instalação/contrato, não um isolamento multi-escritório.

Estados que ocupam orçamento: `reservada`, `ok`, `erro`, `incerta`. Auth/certificado que falha antes do envio vira `abortada_auth` e libera o orçamento. Falta de resposta após tentativa vira `incerta`; falha ao finalizar mantém reserva e produz erro visível. Medição/registro indisponível nunca deve retornar consumo zero nem autorizar HTTP. Não expirar automaticamente reservas: ausência de resposta não prova ausência de processamento.

Assinatura igual em `reservada`/`incerta` bloqueia indefinidamente, inclusive com guarda desligada ou forçar. Após resultado conhecido, cooldown configurado aplica a sucesso/rejeição; HTTP 429/5xx usa mínimo entre 30s e configurado, 202/304 conhecido libera polling. Cooldown não é fila: consumidores precisam respeitar o erro antes de reagendar.

Override libera apenas teto, requer contexto forcar=true e userId; as rotas continuam responsáveis por validar ADMIN usando `podeForcarSerpro`. A reserva registra `forcado`, `userId`, `origem`. Não libera medição indisponível, chamada pendente ou cooldown. Não há endpoint de resolução manual de incertas: precisa ser implementado com conciliação e trilha de auditoria antes de liberar uma reserva.

Datas de orçamento: mês/dia civil de São Paulo, pelo createdAt da reserva; pendências de meses anteriores continuam bloqueando sua assinatura, mas não entram no número do mês atual. HTTP 200 não implica sucesso fiscal nem faturamento confirmado. Hash atual usa JSON serializado e rota, portanto ordem de propriedades distinta pode gerar outra assinatura; não substitui idempotência de negócio dos serviços.

Workers PGDAS-D, DCTFWeb e confirmação de pagamento atribuem origem explícita e preservam contexto existente. Novos consumidores devem usar SerproHttpClient e propagar contexto; integrações fora dele não são contabilizadas aqui.

Testes locais sem DB/HTTP: serproCallGuard, serproReserva e serproHttpReserva (28 testes). Concorrência usa transaction mock serializado, não é teste de integração PostgreSQL. Validar a semântica do lock em banco isolado antes do rollout, sem gerar chamadas pagas. Diagnóstico `scripts/diag-consumo-serpro.mjs` é somente leitura e separa reservas/incertas/auth abortada; não foi executado contra dados reais nesta revisão.

Ensaio de integração: `scripts/verify-serpro-reservations-postgres.js` usa exclusivamente o banco descartável `whatsapp_delivery_check` em 127.0.0.1:55439, usuário whatsapp_check, com migrations e ledger inicialmente vazio. Aceita `--url` ou DATABASE_URL validado antes de importar o guard. Faz 12 reservas paralelas reais, disputa diária/mensal, auth abortada, timeout e override auditado; não envia HTTP. Limpa apenas registros com origem UUID da execução. Rodar sequencialmente no CI para evitar interferência no teto global. A criação do script e validação sintática não equivalem à aprovação do ensaio: exigir resultado PASS no PostgreSQL.
