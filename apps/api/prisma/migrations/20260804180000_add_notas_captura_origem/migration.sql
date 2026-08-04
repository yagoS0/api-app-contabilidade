-- Origem da varredura de notas: manual (aba Consultas) x automatico (worker).
--
-- Sem isto não há como responder "a rotina rodou hoje?" pela aplicação — só abrindo log de
-- container. Foi essa cegueira que deixou a captura 29 dias parada em produção sem ninguém notar.

ALTER TABLE "notas_captura_jobs" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'manual';
