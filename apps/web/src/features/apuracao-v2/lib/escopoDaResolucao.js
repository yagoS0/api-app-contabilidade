// O ALCANCE DE UMA RESOLUÇÃO DE PENDÊNCIA — o que a tela pode oferecer, e o que ela tem de dizer.
//
// ⚠⚠ POR QUE ESTA ESCOLHA EXISTE. Até 26/08/2026 resolver uma pendência gravava regra de escopo
// EMPRESA e só. O MESMO código de serviço era decidido **uma vez por cliente**: com mil empresas,
// mil pendências idênticas e mil regras idênticas para uma pergunta que tem uma resposta só — o
// código de serviço não muda de significado conforme o cliente. Trabalho O(n) onde o problema é
// O(1), e a hora é humana.
//
// ⚠ A ESCOLHA É ASSIMÉTRICA, e o desenho tem de refletir isso:
//   · EMPRESA  — alcance pequeno, reversível na prática, e é o comportamento de sempre.
//   · GLOBAL   — vale para a carteira inteira, **inclusive para cliente que ainda não existe**, e
//                fecha as pendências das outras empresas sem que ninguém as revise.
// Por isso EMPRESA vem marcado e GLOBAL exige um clique deliberado. Marcar GLOBAL por padrão faria
// o alcance maior acontecer por inércia.

/** Os dois alcances. Lista FECHADA — é o mesmo vocabulário do `AprendizadoService`. */
export const ESCOPO_DA_RESOLUCAO = Object.freeze({
  EMPRESA: "EMPRESA",
  GLOBAL: "GLOBAL",
});

/** ⚠ O papel que o servidor exige para o escopo GLOBAL (`escopo_global_exige_admin`). */
export const PAPEL_MINIMO_GLOBAL = "FIRM_ADMIN";

const ROTULO_PAPEL = {
  FIRM_ADMIN: "perfil de administrador do escritório",
  ACCOUNTANT: "perfil de contador",
  STAFF: "perfil de equipe",
};

/**
 * A tela pode oferecer o escopo GLOBAL?
 *
 * ⚠⚠ ELA NÃO É A PERMISSÃO. Quem decide é o servidor, a cada resolução — esta função existe para a
 * tela não oferecer um botão que vai ser recusado com 403. É a mesma disciplina já escrita neste
 * projeto para a flag de emissão do cliente.
 *
 * ⚠ E a recusa NOMEIA o papel que resolveria: "sem permissão" sozinho não diz a quem pedir. Mesmo
 * critério de `estadoCredencial.js`.
 *
 * @param {{myRole?: string}} p
 */
export function podeResolverGlobalmente({ myRole } = {}) {
  const papel = String(myRole || "").trim().toUpperCase();
  if (papel === PAPEL_MINIMO_GLOBAL) return { pode: true, motivo: "" };
  return {
    pode: false,
    motivo: `Resolver para toda a carteira exige ${ROTULO_PAPEL[PAPEL_MINIMO_GLOBAL]}. `
      + "Peça a quem tem esse perfil no escritório.",
  };
}

/**
 * O que cada alcance FAZ, dito em consequência — nunca em nome de campo.
 *
 * ⚠ `esperando` é o número de OUTRAS empresas com pendência aberta no mesmo código
 * (`esperandoAMesmaDecisao`, derivado pelo backend). É ele que torna a escolha informada: sem o
 * número, "vale para a carteira" é abstrato e ninguém escolhe o alcance maior.
 *
 * ⚠⚠ ZERO NÃO É AUSÊNCIA, e os dois têm frases diferentes. `0` quer dizer *"conferi, nenhuma outra
 * empresa está parada neste código"* — e aí GLOBAL continua valendo a pena, só que para o FUTURO
 * (cliente que ainda não existe). `null`/`undefined` quer dizer *"não sei"*, e aí a tela não pode
 * afirmar nem um nem outro. Colapsar os dois em "nenhuma outra empresa" seria afirmar sobre o banco
 * a partir de um campo que não veio.
 *
 * @param {{esperando?: number|null}} p
 */
export function consequenciaDoEscopo({ esperando } = {}) {
  // ⚠⚠ `typeof === "number"`, e NÃO `Number(esperando)`: `Number("")` é **0** e passa em
  // `isFinite`, então a string vazia viraria a afirmação "conferi, nenhuma outra empresa" — sobre um
  // campo que não veio. É a mesma armadilha de `rbt12Conhecido`, que precisou de TRÊS condições
  // pelo mesmo motivo. Aqui o campo chega como número JSON (`esperandoAMesmaDecisao`), então exigir
  // o tipo é a guarda mais estreita que aceita tudo que é legítimo.
  const sabemos = typeof esperando === "number" && Number.isFinite(esperando);
  const n = sabemos ? esperando : null;

  return {
    [ESCOPO_DA_RESOLUCAO.EMPRESA]: {
      rotulo: "Só esta empresa",
      consequencia: "A regra vale apenas para esta empresa. As notas dela com o mesmo código passam "
        + "a classificar sozinhas; as outras empresas continuam pedindo a mesma decisão.",
    },
    [ESCOPO_DA_RESOLUCAO.GLOBAL]: {
      rotulo: "Toda a carteira",
      consequencia: "A regra vale para todas as empresas, inclusive para clientes que ainda não "
        + "existem. Esta decisão não será pedida de novo.",
      // ⚠ A frase do ganho é SEPARADA da consequência: uma descreve o alcance (sempre verdadeira),
      // a outra depende de um número que pode não ter vindo.
      ganho: !sabemos
        ? null
        : n > 0
          ? `${n} outra${n > 1 ? "s" : ""} empresa${n > 1 ? "s" : ""} ${n > 1 ? "estão paradas" : "está parada"} `
            + `neste mesmo código — a pendência ${n > 1 ? "delas" : "dela"} fecha junto.`
          : "Nenhuma outra empresa está parada neste código agora, mas a regra passa a valer para "
            + "as próximas.",
      esperando: n,
    },
  };
}

/**
 * ⚠⚠ O AVISO DE QUE A DECISÃO SAI DESTA EMPRESA — e ele só aparece quando GLOBAL está escolhido.
 *
 * Fechar a pendência de outra empresa é o único efeito desta tela que toca dado de cliente que não
 * está na frente do contador. Um aviso permanente treinaria o olho a ignorá-lo (a regra da casa
 * sobre âmbar); um aviso ausente faria o efeito acontecer sem ninguém ter lido.
 */
export function avisoDeAlcance(escopo, { esperando } = {}) {
  if (escopo !== ESCOPO_DA_RESOLUCAO.GLOBAL) return null;
  // ⚠ Mesma guarda de `consequenciaDoEscopo`, e pelo mesmo motivo — ver o comentário de lá.
  const n = typeof esperando === "number" && Number.isFinite(esperando) ? esperando : null;
  return {
    tom: "warn",
    texto: n > 0
      ? `Isto fecha a pendência de ${n} outra${n > 1 ? "s" : ""} empresa${n > 1 ? "s" : ""} sem que `
        + "elas sejam revisadas uma a uma. Elas ficam marcadas como resolvidas por regra global."
      : "Isto grava uma regra que vale para todas as empresas, inclusive as que você não acessa.",
  };
}

/**
 * O que vai no corpo da requisição.
 *
 * ⚠ EMPRESA **não manda o campo**: é o default do servidor, e o corpo antigo continua sendo o corpo
 * de sempre. Mandar `escopo: "EMPRESA"` funcionaria igual — mas omitir mantém intacta a requisição
 * que já existia, que é o que faz esta mudança não ter efeito nenhum sobre quem não escolher nada.
 */
export function escopoParaPayload(escopo) {
  return escopo === ESCOPO_DA_RESOLUCAO.GLOBAL ? { escopo: ESCOPO_DA_RESOLUCAO.GLOBAL } : {};
}
