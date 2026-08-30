-- ⚠⚠ A CIÊNCIA DO CLIENTE SOBRE AS GUIAS EM ATRASO — o "Estou ciente" do pop-up.
--
-- ADITIVA: tabela NOVA, que nenhuma consulta existente lê. Nada é alterado, nada é apagado, e o
-- comportamento de hoje continua idêntico enquanto ninguém escrever nela.
--
-- ⚠⚠ SEM BACKFILL, E ISSO É DELIBERADO. Não existe, em nenhuma coluna deste banco, dado que prove
-- que alguém já viu um aviso de guia vencida — `Guide.clienteConfirmouEm` prova outra coisa (que o
-- cliente afirmou ter PAGADO). Semear ciência a partir dela silenciaria o pop-up para quem nunca
-- foi avisado, que é o oposto do que ele existe para fazer.

CREATE TABLE "ciencias_de_guias" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "guiaIds"        TEXT[],
  "userId"         TEXT NOT NULL,
  "origem"         TEXT NOT NULL,
  "criadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ciencias_de_guias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ciencias_de_guias_portalClientId_criadoEm_idx"
  ON "ciencias_de_guias"("portalClientId", "criadoEm");

ALTER TABLE "ciencias_de_guias"
  ADD CONSTRAINT "ciencias_de_guias_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
