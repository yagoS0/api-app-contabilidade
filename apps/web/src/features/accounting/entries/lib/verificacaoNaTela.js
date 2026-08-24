// A PRÉ-VERIFICAÇÃO NA TELA — como o que a rota devolve vira texto para o contador.
//
// ## Por que existe (pedido do dono, 24/08/2026)
//
// > *"quando eu vá importar ao meu sistema contábil eu não importe nas contas erradas, ou seja é
// > uma pré-verificação de lançamentos."*
//
// ⚠⚠ **O PRODUTO É O AGRUPAMENTO POR REGRA, não a lista de lançamentos.** O contador não quer 200
// linhas: quer *"6 provisões de IRPJ/CSLL debitando o ramo 5"* e corrigir as seis de uma vez. É a
// melhor ideia do plano externo que o dono trouxe, e é o que torna a correção em lote possível
// antes de importar. `porLancamento` existe para marcar a linha; quem se LÊ é `porRegra`.
//
// ⚠ **A REGRA NÃO MORA AQUI.** Quem decide se um par de contas viola é
// `apps/api/src/application/accounting/regras/MotorRegras.js`. Este módulo só traduz o resultado em
// título, cor e frase — reimplementar o veredito no front daria duas regras que divergem na
// primeira correção, que é literalmente o defeito que o motor existe para pegar.

/**
 * O nome humano de cada regra. ⚠ Lista FECHADA, espelhando `REGRA` de `regras/contratos.js`.
 *
 * ⚠ Regra que a tela **não conhece** aparece com o próprio `id` (ex.: `F7.02`), nunca escondida:
 * um achado sem tradução ainda é um achado, e sumir com ele faria a contagem do resumo discordar
 * da lista logo abaixo.
 */
export const TITULO_DA_REGRA = Object.freeze({
  "F2.01": "Tributo sobre a receita fora da conta de dedução",
  "F2.02": "Provisão sem contrapartida no passivo",
  "F3.01": "IRPJ/CSLL fora da despesa tributária",
  "F3.02": "IRPJ/CSLL sem contrapartida no passivo",
  "F4.01": "DAS fora da conta de dedução",
  "F4.02": "DAS sem contrapartida no passivo",
  "F5.01": "Pagamento com forma inesperada",
  "F9.01": "Provisão creditando conta que não é obrigação",
  "F9.02": "Provisão com forma de pagamento",
  "F9.03": "Movimento entre passivos",
});

export function tituloDaRegra(regraId) {
  return TITULO_DA_REGRA[regraId] || String(regraId || "achado");
}

/**
 * O tom do grupo.
 *
 * ⚠⚠ **ÂMBAR, NUNCA VERMELHO.** Nesta casa vermelho **bloqueia o fechamento**
 * (`computeFechamentoBlockers`), e esta verificação não bloqueia nada — decisão do dono: *"avisa
 * forte, não bloqueia"*. Pintá-la de vermelho ao lado de um Salvar habilitado esvaziaria o
 * vermelho da linha de cima, que bloqueia de verdade.
 *
 * ⚠ `SUGESTAO` (o "a conferir" do parcelamento) é **neutro**: mover dívida entre passivos é ato
 * legítimo com forma de provisão. Acusá-lo com o mesmo peso treinaria o contador a ignorar a lista.
 */
export function tomDoGrupo(severidade) {
  return String(severidade || "").toUpperCase() === "SUGESTAO" ? "neutro" : "atencao";
}

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

/**
 * A frase do resumo. `null` quando não há nada a dizer — e ⚠ **`null` significa "não desenhe o
 * painel"**, nunca um painel dizendo "está tudo certo": a verificação não conferiu o que não sabe
 * julgar, e afirmar "tudo certo" sobre 36 lançamentos indeterminados seria mentira por omissão.
 */
export function resumoDaVerificacao(resumo) {
  const viola = Number(resumo?.viola) || 0;
  const conferir = Number(resumo?.conferir) || 0;
  if (!viola && !conferir) return null;
  const partes = [];
  if (viola) partes.push(plural(viola, "lançamento a corrigir", "lançamentos a corrigir"));
  if (conferir) partes.push(plural(conferir, "a conferir", "a conferir"));
  return partes.join(" · ");
}

/**
 * ⚠ Quantos lançamentos a verificação NÃO conseguiu julgar, e por quê — para o painel poder dizer.
 *
 * Medido em produção (24/08/2026): **36 de 200**, quase todos com perna sem conta contábil. Eles
 * **não são acusados** (não há critério), mas esconder o número faria a lista parecer completa.
 */
export function naoAvaliados(resumo) {
  const n = Number(resumo?.indeterminado) || 0;
  return n > 0 ? n : null;
}

/**
 * As linhas do painel, prontas para render: uma por REGRA, da que mais aparece para a que menos.
 *
 * ⚠ A ordenação vem do servidor (`porRegra` já sai ordenado) e **não é refeita aqui** — reordenar
 * na tela faria o relatório do diagnóstico e o da tela listarem em ordens diferentes.
 */
export function gruposDaVerificacao(porRegra) {
  return (Array.isArray(porRegra) ? porRegra : []).map((g) => ({
    regraId: g.regraId,
    titulo: tituloDaRegra(g.regraId),
    tom: tomDoGrupo(g.severidade),
    n: Number(g.n) || 0,
    exemplos: Array.isArray(g.exemplos) ? g.exemplos : [],
    lancamentos: Array.isArray(g.lancamentos) ? g.lancamentos : [],
  }));
}
