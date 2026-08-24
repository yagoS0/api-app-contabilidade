/**
 * O VOCABULÁRIO DO MOTOR DE VERIFICAÇÃO. Só tipos e constantes — nenhuma lógica.
 *
 * ## Por que existe (dono, 24/08/2026)
 *
 * > *"quando eu vá importar ao meu sistema contábil eu não importe nas contas erradas, ou seja é
 * > uma pré-verificação de lançamentos (…) esse tipo de verificação que necessito para não
 * > acarretar em erros dentro do sistema contábil."*
 *
 * A arquitetura (regra com `id`/severidade/base normativa, achado com correção sugerida, override
 * com trilha, relatório agrupado por REGRA) foi absorvida de um plano externo que o dono trouxe.
 * ⚠ **O catálogo daquele plano NÃO foi copiado** — ver `MotorRegras.js` para as duas regras dele
 * que quebrariam este sistema.
 *
 * ## ⚠⚠ NADA AQUI BLOQUEIA — decisão do dono
 *
 * *"avisa forte, não bloqueia"*. **Nenhuma regra deste motor é `ERRO`.** Quem decide contabilidade
 * é o contador; o motor é revisor, não portão. `ERRO` existe no vocabulário porque as guardas
 * ESTRUTURAIS que já existem no projeto (conta sintética, mês fechado, conta fora do plano) são
 * erro de verdade — mas elas **não moram aqui** e não foram tocadas.
 */

/** Quanto pesa um achado. ⚠ `ERRO` não é usado por nenhuma regra deste motor. */
export const SEVERIDADE = Object.freeze({
  ERRO: "ERRO",
  ALERTA: "ALERTA",
  SUGESTAO: "SUGESTAO",
});

/**
 * O veredito de um lançamento. Lista FECHADA.
 *
 * ⚠⚠ `INDETERMINADO` NÃO É VIOLAÇÃO, e a distinção é o eixo do motor. Medido em produção: **31 de
 * 134 provisões** têm perna sem conta. Se elas desenhassem selo, a tela viraria ruído e o achado
 * que importa se perderia — é a mesma lição da aba de Auditoria, que mostrava 1.799 "pontos a
 * conferir" dos quais 18 eram perguntas de verdade.
 *
 * ⚠ `CONFERIR` existe para o que é **legítimo porém incomum** (transferir dívida para um
 * parcelamento). Acusá-lo como erro treinaria o contador a ignorar a lista; escondê-lo perderia o
 * caso real. Ele sai em faixa própria.
 */
export const SITUACAO = Object.freeze({
  OK: "OK",
  VIOLA: "VIOLA",
  CONFERIR: "CONFERIR",
  INDETERMINADO: "INDETERMINADO",
});

/** As perguntas que o motor sabe fazer. O `id` é estável e vai para a tela e para o override. */
export const REGRA = Object.freeze({
  TRIBUTO_RECEITA_DEBITO: "F2.01",
  TRIBUTO_CONTRAPARTIDA_PASSIVO: "F2.02",
  IRPJ_CSLL_DEBITO: "F3.01",
  IRPJ_CSLL_CONTRAPARTIDA_PASSIVO: "F3.02",
  DAS_DEBITO: "F4.01",
  DAS_CONTRAPARTIDA: "F4.02",
  PAGAMENTO_FORMA: "F5.01",
  PROVISAO_CREDITA_ATIVO: "F9.01",
  PROVISAO_COM_FORMA_DE_PAGAMENTO: "F9.02",
  PARCELAMENTO_COM_FORMA_DE_PROVISAO: "F9.03",
});

/**
 * Monta um achado.
 *
 * ⚠ `esperado` é o `codigoCompleto` PONTUADO (`2.1.1.05.*`), não o reduzido: é a grafia que o dono
 * usa e a que o balancete do sistema de destino imprime. O contador confere contra o outro sistema
 * sem traduzir de cabeça.
 *
 * ⚠ O `hash` NÃO inclui o valor nem a data — só a regra, a empresa e as CONTAS. É isso que faz um
 * override valer para o mês seguinte: o contador que disse "nesta empresa é assim" não deve ser
 * perguntado de novo a cada competência. Incluir o valor faria o override expirar sozinho, em
 * silêncio, e o motor voltaria a gritar sem ninguém entender por quê.
 */
export function montarAchado({
  regraId,
  severidade = SEVERIDADE.ALERTA,
  mensagem,
  perna = null,
  contaCulpada = null,
  esperado = null,
  correcaoSugerida = null,
  baseNormativa = null,
  empresaId = null,
}) {
  return {
    regraId,
    severidade,
    mensagem,
    perna,
    contaCulpada,
    esperado,
    correcaoSugerida,
    baseNormativa,
    hash: hashDoAchado({ regraId, empresaId, perna, contaCulpada, esperado }),
  };
}

/**
 * A chave que um override suprime.
 *
 * ⚠ Determinística e sem dependência de relógio — `Date.now()` aqui faria o mesmo achado gerar
 * hash novo a cada validação, e nenhum override jamais pegaria.
 */
export function hashDoAchado({ regraId, empresaId, perna, contaCulpada, esperado }) {
  return [regraId, empresaId ?? "", perna ?? "", contaCulpada ?? "", esperado ?? ""].join("|");
}
