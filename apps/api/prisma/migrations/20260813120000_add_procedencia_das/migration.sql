-- SEPARA O NOSSO CÁLCULO DO DAS DO VALOR DA RECEITA — `apuracao_snapshots`.
--
-- ⚠ NÃO APLICADA. Escrita e parada, por instrução do dono. `prisma migrate deploy` é ato dele.
--
-- ⚠ NENHUMA FK É CRIADA AQUI. A única tabela tocada é `"apuracao_snapshots"`, que já existe desde
-- `20260608160000_add_apuracao_fundacao` e é referenciada com esse nome em 4 migrations. (O nome
-- de tabela se confere no que JÁ EXISTE nas migrations, nunca no `schema.prisma`, que fala em
-- nomes de MODEL: `REFERENCES "portal_clients"` derrubou a produção — a tabela é `"PortalClient"`.
-- Aqui não há `REFERENCES` nenhum, então esse risco não existe.)
--
-- ─── O DEFEITO ────────────────────────────────────────────────────────────────────────────────
--
-- `FechamentoService.calcularFechamento` gravava o valor da SIMULAÇÃO OFICIAL da RFB
-- (`TRANSDECLARACAO11` com `indicadorTransmissao:false`) dentro de `dasCalculadoLocal` — a coluna
-- do NOSSO motor (`MotorApuracaoService`), que também escreve nela. A coluna passou a guardar ora
-- um número, ora o outro, sem nada na linha que os distinguisse. Na mesma escrita ela zerava
-- `receitaPorTipo` e `receitaPorAnexo`, apagando a segregação do mês do snapshot.
--
-- ─── POR QUE COLUNA NOVA, E NÃO GRAVAR A SIMULAÇÃO EM `dasRetornadoSerpro` ────────────────────
--
-- Porque simular NÃO é transmitir, e o código já depende dessa diferença:
--   • `dasRetornadoSerpro` só é escrita em `transmitirFechamento`, no MESMO update que
--     `numeroDeclaracao`, `transmitidoEm` e `estado:"transmitida"` — os quatro descrevem um ato
--     que aconteceu na Receita;
--   • no caminho `jaDeclarado` (PA já declarado, não retransmitido) ela fica NULA de propósito:
--     "não há valor transmitido POR NÓS". Enchê-la com a simulação apagaria essa distinção;
--   • `routes/firm/index.js` expõe a coluna literalmente como `dasTransmitido`, e
--     `workers/apuracaoBatchWorker.js` a lê como o resultado da transmissão em lote.
-- Colapsar as duas faria "a Receita calculou R$ X" e "a declaração de R$ X foi entregue" virarem
-- o mesmo dado — a competência simulada apareceria como obrigação cumprida.

-- 1) A SIMULAÇÃO ganha coluna própria.
ALTER TABLE "apuracao_snapshots" ADD COLUMN "dasSimuladoSerpro" DECIMAL(18,2);

-- 2) A MARCA DE PROCEDÊNCIA de `dasCalculadoLocal`: 'MOTOR_LOCAL' | 'AMBIGUO' (NULL quando o DAS
--    local é nulo). Sem ela não há como distinguir, depois do backfill, a linha cuja procedência
--    foi PROVADA da linha velha que ficou sem dono.
ALTER TABLE "apuracao_snapshots" ADD COLUMN "dasCalculadoLocalProcedencia" TEXT;

-- 3) `receitaPorAnexo` passa a aceitar NULO = "o motor local não calculou esta competência".
--    ⚠ NULO ≠ '{}'. `{}` afirmaria "calculei e não achei anexo nenhum". O caminho da simulação não
--    decide anexo (quem decide, a partir das atividades, é a RFB), então ele deixa NULO. Antes
--    gravava '{}' e APAGAVA o que o motor tinha posto.
--    `receitaPorTipo` continua NOT NULL: os DOIS caminhos têm esse dado (é a segregação do mês,
--    lida das notas EMIT autorizadas), e o caminho da simulação voltou a gravá-la de verdade.
ALTER TABLE "apuracao_snapshots" ALTER COLUMN "receitaPorAnexo" DROP NOT NULL;

-- ─── BACKFILL: DESAMBIGUAR SÓ O QUE A PRÓPRIA LINHA PROVA ────────────────────────────────────
--
-- ⚠ NADA AQUI É CHUTE. Só DOIS caminhos escreveram `dasCalculadoLocal` na história desta tabela, e
-- cada um escreve um objeto inteiro, numa transação só:
--
--   • `FechamentoService.calcularFechamento` → `dasCalculadoLocal` + `receitaPorTipo = '{}'`
--                                              + `receitaPorAnexo = '{}'` + `simulacaoSerpro`
--   • `MotorApuracaoService.calcularApuracaoLocal` → `dasCalculadoLocal` + `receitaPorTipo` com as
--                                              SETE chaves de TipoReceita (nunca vazio, nem quando
--                                              todas valem 0) + `aliquotaEfetivaPorAnexo`
--
-- Ou seja: `receitaPorTipo` diz QUEM ESCREVEU POR ÚLTIMO. Vazio ⇒ foi a simulação. Não-vazio ⇒ foi
-- o motor. Isso é evidência na linha, não inferência sobre o passado.
--
-- ⚠ O QUE NÃO CASAR COM NENHUM DOS DOIS FICA 'AMBIGUO' E ASSIM PERMANECE. Inventar procedência de
-- dado fiscal é exatamente o que esta separação existe para impedir. Quantas linhas caem em cada
-- balde se MEDE antes, sem escrever nada: `apps/api/scripts/diag-procedencia-das.mjs`.

-- 3.1 SIMULAÇÃO PROVADA → muda de coluna. `dasCalculadoLocal` fica NULA porque o valor não se
--     perdeu: ele está em `dasSimuladoSerpro`, com dono. E `receitaPorAnexo = '{}'` daquela mesma
--     escrita vira NULO ("não calculado por este caminho"), que é o que ele sempre significou.
UPDATE "apuracao_snapshots"
   SET "dasSimuladoSerpro" = "dasCalculadoLocal",
       "dasCalculadoLocal" = NULL,
       "receitaPorAnexo"   = CASE WHEN "receitaPorAnexo" = '{}'::jsonb THEN NULL ELSE "receitaPorAnexo" END
 WHERE "dasCalculadoLocal" IS NOT NULL
   AND "simulacaoSerpro"  IS NOT NULL
   AND "receitaPorTipo" = '{}'::jsonb;

-- 3.2 MOTOR PROVADO → o número fica onde está, agora com dono. `receitaPorTipo` não-vazio só pode
--     ter vindo do motor, e ele grava os dois campos juntos.
UPDATE "apuracao_snapshots"
   SET "dasCalculadoLocalProcedencia" = 'MOTOR_LOCAL'
 WHERE "dasCalculadoLocal" IS NOT NULL
   AND "receitaPorTipo" IS NOT NULL
   AND "receitaPorTipo" <> '{}'::jsonb;

-- 3.3 O RESTO fica marcado como ambíguo — de propósito. A tela já sabe exibir isso
--     (`kpiDasApurado` → "DAS gravado (procedência ambígua)").
UPDATE "apuracao_snapshots"
   SET "dasCalculadoLocalProcedencia" = 'AMBIGUO'
 WHERE "dasCalculadoLocal" IS NOT NULL
   AND "dasCalculadoLocalProcedencia" IS NULL;

-- Vocabulário fechado: um valor fora da lista deixaria a marca sem significado, que é o estado de
-- que estamos saindo. Roda DEPOIS do backfill, então já nasce validado.
ALTER TABLE "apuracao_snapshots"
  ADD CONSTRAINT "chk_apuracao_snapshot_procedencia_das"
  CHECK (
    "dasCalculadoLocalProcedencia" IS NULL
    OR "dasCalculadoLocalProcedencia" IN ('MOTOR_LOCAL', 'AMBIGUO')
  );
