-- A competência do SERVIÇO não é o mês do vencimento: "transmitir a apuração de julho" vence em
-- agosto. Sem a defasagem, o `verificador` olharia a competência errada ao concluir sozinho.
-- Default 1 porque é o caso comum (trabalho do mês anterior), mas o contador declara por obrigação.
ALTER TABLE "obrigacoes" ADD COLUMN     "defasagemMeses" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "regras_obrigacao" ADD COLUMN     "defasagemMeses" INTEGER NOT NULL DEFAULT 1;

-- Guardada na ocorrência, não recalculada na leitura: mudar a defasagem depois não pode
-- reescrever a que competência as ocorrências passadas se referiam.
ALTER TABLE "ocorrencias_obrigacao" ADD COLUMN     "competenciaRef" TEXT;
