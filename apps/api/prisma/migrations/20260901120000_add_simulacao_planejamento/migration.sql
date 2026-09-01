-- A FOTO DA SIMULAÇÃO DE PLANEJAMENTO TRIBUTÁRIO.
--
-- ⚠ ADITIVA: tabela NOVA que nenhuma consulta existente lê. Aplicá-la não muda o comportamento de
-- nada que já está no ar.
--
-- ⚠⚠ A FK REFERENCIA "PortalClient", COM ASPAS E EM PascalCase. Aquele model NÃO tem `@@map`, então
-- o nome real da tabela é o do model — e não `portal_clients`, que é o que a intuição sugere. Este
-- erro já foi cometido neste projeto (migration da `CienciaDeGuias`) e só aparece na hora de
-- aplicar, com a migration falhando no banco. Conferido contra o DDL de uma migration irmã.
--
-- ⚠⚠ SEM UNIQUE POR COMPETÊNCIA, e isso é decisão: uma empresa tem VÁRIAS simulações legítimas do
-- mesmo mês ("e se o pró-labore subir?"). Um unique faria a segunda apagar a primeira — e a
-- primeira pode já ter sido impressa e entregue ao cliente.

CREATE TABLE "simulacoes_planejamento" (
  "id"              TEXT NOT NULL,
  "portalClientId"  TEXT NOT NULL,
  "competencia"     TEXT NOT NULL,
  "entradas"        JSONB NOT NULL,
  "resultado"       JSONB NOT NULL,
  "procedencias"    JSONB,
  "vigenciaTabelas" JSONB,
  "documentoId"     TEXT,
  "geradoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "geradoPor"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "simulacoes_planejamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "simulacoes_planejamento_portalClientId_geradoEm_idx"
  ON "simulacoes_planejamento" ("portalClientId", "geradoEm");

ALTER TABLE "simulacoes_planejamento"
  ADD CONSTRAINT "simulacoes_planejamento_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
