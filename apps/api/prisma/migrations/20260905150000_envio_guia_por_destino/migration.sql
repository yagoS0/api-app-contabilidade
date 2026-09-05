-- UM ENVIO POR DESTINATÁRIO — a chave de `envios_guia` passa a incluir o DESTINO (05/09/2026).
--
-- Decisão do dono: "quando enviarmos, enviar para todos os canais cadastrados". Com N telefones
-- cadastrados, N mensagens saem — e cada uma tem estado próprio (enviada, entregue, lida, falhou),
-- porque o ✓✓ da Meta chega por `providerMessageId`, que é POR MENSAGEM.
--
-- ⚠⚠ A CHAVE ANTIGA `(guideId, canal)` ERA A IDEMPOTÊNCIA DO LOTE — reexecutar não redisparava. Ela
-- NÃO foi afrouxada: continua sendo "um envio por (guia, canal, destino)". O que muda é o que conta
-- como o mesmo envio: mandar para OUTRO telefone não é repetir, é outro destinatário.
--
-- ⚠⚠ SÃO DOIS ÍNDICES, e o segundo existe por causa do NULL. No Postgres, NULL não colide com NULL
-- num índice único: sem o índice parcial, a linha LEGADA do e-mail (`destino` nulo, porque o envio
-- antigo não registrava para quem foi) poderia ser materializada duas vezes, e `foiEnviadaComLegado`
-- passaria a ver duas linhas onde havia uma.
--
-- ⚠ O índice parcial NÃO é declarável no `schema.prisma` (o Prisma não tem índice condicional). Ele
-- vive aqui, e o teste de regressão o cita pelo nome. Quem rodar `prisma migrate dev` vai ver drift
-- — este projeto escreve migration à mão, e isso está registrado no CLAUDE.md.
--
-- ⚠ Medido em produção em 05/09/2026: `envios_guia` tem ZERO linhas. Não há dado a converter, e é
-- por isso que a troca de chave é barata AGORA e não seria depois.

DROP INDEX IF EXISTS "envios_guia_guideId_canal_key";

CREATE UNIQUE INDEX "envios_guia_guideId_canal_destino_key"
  ON "envios_guia" ("guideId", "canal", "destino");

CREATE UNIQUE INDEX "envios_guia_legado_sem_destino_key"
  ON "envios_guia" ("guideId", "canal")
  WHERE "destino" IS NULL;
