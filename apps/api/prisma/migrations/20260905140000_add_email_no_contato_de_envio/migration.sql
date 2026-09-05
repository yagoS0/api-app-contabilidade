-- O CONTATO DE WHATSAPP VIRA CONTATO DE ENVIO — ele passa a carregar também o e-mail.
--
-- Decisão do dono (05/09/2026): "quando enviarmos, enviar para todos os canais cadastrados", e o
-- cadastro de e-mails e telefones de envio sai do formulário da empresa e da aba de acesso, e passa
-- a viver numa aba própria dentro de Guias.
--
-- ⚠ A TABELA NÃO MUDA DE NOME. Renomear `contatos_whatsapp` exigiria mexer em todo o módulo de
-- conversas (vínculo por telefone, webhook, fila de não vinculados) por causa de uma mudança de
-- ESCOPO da tela. O nome fica; o significado é "contato de envio", e está escrito no schema.
--
-- ⚠ `telefoneE164` PASSA A SER NULO — um destinatário pode ter só e-mail. O índice único
-- `(portalClientId, telefoneE164)` continua: no Postgres, vários NULL não colidem entre si, então
-- N destinatários sem telefone convivem, e dois com o MESMO telefone continuam recusados.
--
-- ⚠ O OPT-IN CONTINUA VALENDO SÓ PARA O WHATSAPP. Ele é exigência da Meta e protege o número contra
-- denúncia de spam; e-mail nunca dependeu dele e continua não dependendo. Por isso o backfill abaixo
-- grava destinatário SEM opt-in: ele é de e-mail, e exigir consentimento de Meta para e-mail
-- deixaria a carteira inteira sem receber no dia seguinte.

ALTER TABLE "contatos_whatsapp" ADD COLUMN "email" TEXT;
ALTER TABLE "contatos_whatsapp" ALTER COLUMN "telefoneE164" DROP NOT NULL;

-- O e-mail de guias que cada empresa já tinha cadastrado vira o primeiro destinatário da lista nova
-- (decisão do dono: "pode colocar o email já cadastrado na aba nova"). Sem isto, a lista nasceria
-- vazia e a mudança tiraria o envio de quem já recebia.
--
-- ⚠ `nome` NÃO É INVENTADO. Não sabemos de quem é o endereço — só que ele foi cadastrado para
-- receber guias. O rótulo diz isso, e o contador renomeia quando souber.
INSERT INTO "contatos_whatsapp" ("id", "portalClientId", "nome", "papel", "email", "ativo", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  'E-mail cadastrado para guias',
  'envio de guias',
  lower(trim(p."guideNotificationEmail")),
  true,
  NOW(),
  NOW()
FROM "PortalClient" p
WHERE p."guideNotificationEmail" IS NOT NULL
  AND trim(p."guideNotificationEmail") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "contatos_whatsapp" c
    WHERE c."portalClientId" = p."id"
      AND lower(c."email") = lower(trim(p."guideNotificationEmail"))
  );
