-- BENEFÍCIO MUNICIPAL DO ISSQN — o grupo `BM` da DPS, cadastrado pelo contador.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- PEDIDO DO DONO (20/08/2026): *"do lado do contador ainda, o seletor de benefício, caso o cliente
-- tenha algum benefício fiscal."*
--
-- ⚠ NOME DA TABELA CONFERIDO CONTRA AS MIGRATIONS, NUNCA CONTRA O `schema.prisma` (que nomeia
--   MODELS): `"Company"` aparece em `CREATE TABLE "Company"` na `20251204195725_init` e em
--   `ALTER TABLE "Company"` na `20260814120000_add_nfse_emissao_fase1`, na
--   `20260816120000_add_codigos_servico_nacional` e na
--   `20260818210000_add_carga_tributaria_nao_simples`. Nenhuma FK é criada aqui.
--
-- ⚠ O `schema.prisma` FOI EDITADO JUNTO, pelo mesmo motivo escrito na
--   `20260818210000_add_carga_tributaria_nao_simples`: a leitura da empresa no portal do contador
--   passa por `legacyCompanySelect`, um `select` EXPLÍCITO, e a escrita por
--   `company.update({data})` — sem o campo no model o cadastro não funciona de jeito nenhum.
--   **Consequência: aplicar ANTES de o código subir**, senão o Prisma responde P2022 em toda
--   leitura de empresa, e isso é a carteira inteira, não só a emissão.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A FONTE, CAMPO A CAMPO (XSD oficial 1.01, versionado com hash em
-- `docs/leiaute-nfse/documentacao-tecnica/`)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `tiposComplexos_v1.01.xsd:1931`, `complexType name="TCBeneficioMunicipal"`:
--
--     nBM        TSNumBeneficioMunicipal   1-1   (obrigatório DENTRO do grupo BM)
--     <choice>
--       vRedBCBM TSDec15V2                 0-1
--       pRedBCBM TSDec3V2                  0-1
--     </choice>
--
-- `tiposSimples_v1.01.xsd:957-973`, `TSNumBeneficioMunicipal`: `<xs:pattern value="[0-9]{14}"/>`,
-- com a regra de formação na documentação do próprio tipo:
--   7 dígitos (posições 1-7): município, código IBGE;
--   2 dígitos (posições 8-9): tipo de parametrização (01 legislação · 02 regimes especiais ·
--                             03 retenções · 04 outros benefícios);
--   5 dígitos (posições 10-14): sequencial do Sistema Nacional.
--
-- ⚠ O IDENTIFICADOR É GERADO PELO SISTEMA NACIONAL quando o MUNICÍPIO cadastra o benefício. Não
-- existe lista neste repositório, não se deriva do CNAE e não se sugere valor: é campo DIGITADO,
-- com a FORMA validada e o CONTEÚDO nunca conferido — quem confere é o fisco, e a recusa tem nome:
-- `E0541` (*"Não existe o código de identificação do benefício municipal informado na DPS para o
-- municipío de incidência do ISSQN"*), nível 3, rejeição.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE UMA COLUNA DE **TIPO**, EM VEZ DE DEDUZIR PELO CAMPO PREENCHIDO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Porque as duas reduções não são intercambiáveis e a escolha **não é nossa**. ANEXO_I, aba
-- `RN DPS_NFS-e`:
--   • `E0565` — *"Somente é permitido informar vRedBCBM quando o código de identificação do
--     Benefício Municipal (nBM) for um benefício do tipo Redução de Base de Cálculo por Valor
--     Monetário."*
--   • `E0577` — o mesmo, para `pRedBCBM` e o tipo por PERCENTUAL.
-- Ou seja: qual dos dois vale é atributo do benefício **como o município o cadastrou**, e o
-- sistema não tem essa tabela. Só o contador sabe.
--
-- E há benefício que não reduz base nenhuma: `E0612` proíbe `pAliq` quando o benefício é do tipo
-- *"Isenção"* ou *"Alíquota Diferenciada"* — tipos que o `xs:choice` acomoda porque seus dois
-- filhos são `minOccurs="0"`. Logo "não informei ainda" e "este benefício não reduz base" são
-- estados DIFERENTES, e um deles não pode ser representado pela ausência do outro.
--
-- ⚠ E o par monetário NÃO VIRA COLUNA: `vRedBCBM` é *"valor monetário informado pelo emitente para
-- redução da base de cálculo"* — é da NOTA, não da empresa. Um valor fixo gravado no cadastro e
-- repetido em toda nota emitida seria uma afirmação que ninguém fez, e **reduziria imposto**. O
-- TIPO fica registrado; o valor entra por nota, quando o envio ao XML existir.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ O QUE ESTAS COLUNAS **NÃO** FAZEM HOJE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Não mudam nota nenhuma. `buildDpsXml` (`application/nfse/NfseService.js`) monta `<tribMun>` com
-- DOIS filhos — `tribISSQN` (cravado em `1`) e `tpRetISSQN` — dos SETE que o `TCTribMunicipal`
-- admite (`tribISSQN` · `cPaisResult` · `tpImunidade` · `exigSusp` · `BM` · `tpRetISSQN` ·
-- `pAliq`). O grupo `BM` não é escrito. A nota continua saindo com o ISS CHEIO, e as telas do
-- cadastro e da emissão DIZEM isso, em vez de deixar o contador supor.
--
-- ADITIVA, NULLABLE, SEM BACKFILL E SEM DEFAULT.

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "beneficioMunicipalNumero" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "beneficioMunicipalTipoReducao" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "beneficioMunicipalPRedBC" DECIMAL(5,2);

-- Guarda no BANCO, não só no código — a mesma disciplina de `chk_company_codigo_municipio_ibge`
-- (`20260814120000`) e dos três `chk_company_p_tot_trib_*` (`20260818210000`).
--
-- ⚠ Sem subquery e sem função STABLE: comparações escalares e um `~` de regex. A migration que
-- FALHA é o pior desfecho (P3009 recusa todas as seguintes e o servidor não sobe).
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_beneficio_municipal_numero";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_beneficio_municipal_numero"
  CHECK ("beneficioMunicipalNumero" IS NULL OR "beneficioMunicipalNumero" ~ '^[0-9]{14}$');

-- Os três valores possíveis, e nada além deles. `SEM_REDUCAO` é uma AFIRMAÇÃO ("este benefício não
-- reduz base de cálculo"), diferente de NULL ("não declarado").
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_beneficio_municipal_tipo";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_beneficio_municipal_tipo"
  CHECK ("beneficioMunicipalTipoReducao" IS NULL
         OR "beneficioMunicipalTipoReducao" IN ('SEM_REDUCAO', 'VALOR', 'PERCENTUAL'));

-- É PERCENTUAL de redução da base: fora de 0–100 não é "um número grande", é outra unidade.
-- (`TSDec3V2` do XSD comporta até 999.99 por ser um tipo decimal genérico; o significado do campo
-- é que fecha a faixa.)
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_beneficio_municipal_p_red_bc";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_beneficio_municipal_p_red_bc"
  CHECK ("beneficioMunicipalPRedBC" IS NULL
         OR ("beneficioMunicipalPRedBC" >= 0 AND "beneficioMunicipalPRedBC" <= 100));

-- ⚠ A COERÊNCIA ENTRE AS TRÊS COLUNAS TAMBÉM NO BANCO: percentual sem o tipo PERCENTUAL, ou
-- qualquer declaração de benefício sem o número, é um cadastro que não descreve benefício nenhum.
-- O validador da aplicação recusa antes (com nome próprio), mas um `update` direto no banco não
-- passa por ele.
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_beneficio_municipal_coerencia";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_beneficio_municipal_coerencia"
  CHECK (
    ("beneficioMunicipalTipoReducao" IS NULL OR "beneficioMunicipalNumero" IS NOT NULL)
    AND ("beneficioMunicipalPRedBC" IS NULL OR "beneficioMunicipalTipoReducao" = 'PERCENTUAL')
  );
