// QUAL CÓDIGO DE SERVIÇO **ESTA NOTA** DECLARA — a regra, pura.
//
// ─── O QUE HAVIA, E POR QUE ERA UMA PONTE E NÃO UM DEFEITO ──────────────────────────────────
//
// Desde 16/08/2026 a empresa tem N códigos habilitados (`Company.codigosServicoNacional`) e a tela
// de emissão MOSTRA quais são, com a descrição oficial, e diz qual vai na nota. Mas `buildDpsXml`
// montava o `cTribNac` a partir de `company.codigoServicoNacional` **e de mais nada**, e
// `validators/nfsePayload.js` não tinha campo de serviço: trocar o código era marcação no cadastro.
// Isso estava documentado como ponte DELIBERADA — um seletor que parecesse funcionar e emitisse
// outro código é erro fiscal SILENCIOSO, que é pior que a ausência do seletor.
//
// ─── O QUE MUDA, E O QUE NÃO PODE MUDAR ─────────────────────────────────────────────────────
//
// A escolha por emissão passa a chegar ao XML. ⚠ **COM A TRAVA, que é o coração disto: o CADASTRO
// É A AUTORIDADE, NUNCA O PAYLOAD.** Um código que a empresa não declara não vira nota só porque
// veio no corpo do pedido — senão o app do cliente emitiria sob serviço que a empresa nunca
// habilitou, que é exatamente o buraco que a lista existe para fechar. Mesmo espírito do
// `company_codigo_servico_nacional_fora_da_lista`, que o cadastro já aplica ao SALVAR
// (`application/company/companyProfile.js`); aqui ele passa a valer também ao EMITIR.
//
// ⚠ **LISTA VAZIA NÃO É "PODE TUDO".** Medido: `codigosServicoNacional` está vazio nas 33 empresas
// (a coluna é de 16/08/2026 e a migration ainda não subiu). Sem lista, a autoridade do cadastro é
// o singular `codigoServicoNacional` — que é o que `buildMissingFields` já exige. Então:
//   • nada escolhido            ⇒ sai o singular, exatamente como hoje (compatibilidade intacta);
//   • escolhido = o singular    ⇒ sai ele, e a escolha é redundante mas verdadeira;
//   • escolhido ≠ o singular    ⇒ **recusa**, porque nenhuma linha do cadastro declara esse código.
// A alternativa (aceitar qualquer código quando a lista está vazia) abriria hoje, em 33 de 33
// empresas, exatamente a porta que a trava fecha.
//
// ⚠ **NUNCA "o primeiro da lista".** Escolher por conta própria seria o sistema decidindo qual
// serviço a empresa declara ao fisco — a mesma proibição que o cadastro já carrega.
//
// ⚠ VALIDA-SE A FORMA, NUNCA O CONTEÚDO. A lista oficial dos 335 desdobramentos vive no front
// (`apps/web/src/lib/servicosNacionais/`, gerada do Anexo B versionado com hash); o backend não a
// carrega, pelo mesmo motivo escrito em `companyProfile.js` — duas cópias divergem na primeira
// atualização do Anexo B, e a divergência apareceria como "a tela ofereceu e o servidor recusou".
// Aqui a pergunta é outra e é respondível sem a tabela: *este código está no cadastro DESTA
// empresa?*
//
// Esta função é PURA de propósito (nenhum Prisma, nenhum `res`): quem lê a empresa e recusa é
// `NfseService.issue`, no pré-voo, ANTES de reservar numeração.

/** Recusa nomeada — o código de serviço pedido não está no cadastro da empresa. */
export const CODIGO_FORA_DA_LISTA = "NFSE_CODIGO_SERVICO_FORA_DA_LISTA";

/** Recusa nomeada — veio um código, mas ele não tem a forma de um `cTribNac`. */
export const CODIGO_FORMA_INVALIDA = "NFSE_CODIGO_SERVICO_INVALIDO";

/** De onde saiu o código que vai no XML. Viaja no log; não é decisão de ninguém. */
export const ORIGEM = Object.freeze({
  /** O pedido escolheu, e a escolha está no cadastro. */
  ESCOLHIDO: "ESCOLHIDO_NA_EMISSAO",
  /** Ninguém escolheu — vale o `Company.codigoServicoNacional`, como sempre valeu. */
  CADASTRO: "CADASTRO_DA_EMPRESA",
});

/**
 * Forma do `cTribNac`: **6 dígitos**, sem padding.
 *
 * ⚠ O mesmo critério de `validateAndNormalizeCompanyProfile` — e ele é `length !== 6`, não
 * `padStart(6)`. Padding aqui fabricaria código plausível a partir de um dígito a menos, que é a
 * classe de defeito do `cLocEmi="0000000"`.
 * Fonte da forma, dentro do projeto: `docs/nfse-preenchimento.md` §5/§11/§12.
 *
 * @returns {string|null} os 6 dígitos, ou `null` quando não há valor OU a forma não bate.
 */
export function normalizarCodigoServicoNacional(valor) {
  if (valor === null || valor === undefined) return null;
  const digitos = String(valor).replace(/\D+/g, "");
  return digitos.length === 6 ? digitos : null;
}

function veioAlgo(valor) {
  return valor !== null && valor !== undefined && String(valor).trim() !== "";
}

function normalizarLista(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const item of lista) {
    const codigo = normalizarCodigoServicoNacional(item);
    // ⚠ Elemento torto no banco é IGNORADO, não recusa: a coluna não tem CHECK (o Postgres proíbe
    // subquery em CHECK, e `unnest` é subquery — está escrito na migration). Recusar a emissão por
    // causa de uma linha velha do cadastro pararia empresa que escolheu um código legítimo.
    if (codigo && !out.includes(codigo)) out.push(codigo);
  }
  return out;
}

/**
 * Decide qual `cTribNac` esta DPS leva.
 *
 * @param {object} entrada
 * @param {string|null} [entrada.escolhido] o código que veio no payload da emissão (pode faltar)
 * @param {string[]} [entrada.lista] `Company.codigosServicoNacional` — o conjunto habilitado
 * @param {string|null} [entrada.singular] `Company.codigoServicoNacional` — o do cadastro
 * @returns {{ok: true, codigo: string, origem: string, habilitados: string[]}
 *          |{ok: false, codigo: string, escolhido: string|null, habilitados: string[],
 *            message: string, correcao: string}}
 */
export function escolherCodigoServicoNacional({ escolhido, lista, singular } = {}) {
  const habilitados = normalizarLista(lista);
  const doCadastro = normalizarCodigoServicoNacional(singular);

  // A autoridade é a LISTA quando ela existe; sem lista, é o singular. Nunca o payload.
  const autorizados = habilitados.length ? habilitados : doCadastro ? [doCadastro] : [];

  if (!veioAlgo(escolhido)) {
    // ⚠ O CAMINHO DE HOJE, INTACTO. Ninguém escolheu ⇒ vale o cadastro, e é ele que
    // `buildMissingFields` já exige. Nenhuma emissão existente muda de comportamento por esta
    // entrega — o front atual não manda o campo.
    return { ok: true, codigo: doCadastro, origem: ORIGEM.CADASTRO, habilitados };
  }

  const pedido = normalizarCodigoServicoNacional(escolhido);
  if (!pedido) {
    return {
      ok: false,
      codigo: CODIGO_FORMA_INVALIDA,
      escolhido: String(escolhido).trim(),
      habilitados,
      message:
        "O código de serviço nacional (cTribNac) informado não tem a forma exigida: são 6 dígitos numéricos.",
      correcao:
        "Escolha o serviço na lista oficial da tela de emissão. O código é item(2) + subitem(2) + " +
        "desdobro nacional(2) — por exemplo 310104, não 31.01.",
    };
  }

  if (!autorizados.includes(pedido)) {
    return {
      ok: false,
      codigo: CODIGO_FORA_DA_LISTA,
      escolhido: pedido,
      habilitados: autorizados,
      message: autorizados.length
        ? `O código de serviço ${pedido} não está entre os cadastrados para esta empresa (${autorizados.join(", ")}).`
        : `O código de serviço ${pedido} não está cadastrado para esta empresa, que não tem nenhum código habilitado.`,
      correcao:
        "Cadastre este código de serviço na empresa (aba Cadastro → códigos de serviço nacional) " +
        "antes de emitir com ele. O cadastro é a autoridade sobre o que a empresa declara ao fisco — " +
        "a emissão escolhe entre os códigos cadastrados, não cadastra novos.",
    };
  }

  return { ok: true, codigo: pedido, origem: ORIGEM.ESCOLHIDO, habilitados: autorizados };
}
