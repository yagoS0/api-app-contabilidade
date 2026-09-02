// QUAL CÓDIGO DE SERVIÇO ESTA NOTA DECLARA — a regra da TELA.
//
// ⚠⚠ **A AUTORIDADE É O BACKEND**, `apps/api/src/application/nfse/codigoServicoDaNota.js`
// (`escolherCodigoServicoNacional`). Este módulo é **ESPELHO**, não segunda implementação: o que
// ela aceita, a tela oferece; o que ela recusa, a tela não deixa escolher. Mesmo arranjo de
// `faltasParaEmitir` × `REQUIRED_COMPANY_FIELDS`, e de `reaproveitarNota.js` × o gêmeo do
// escritório. **Mudou lá, muda aqui** — e há teste amarrando as duas pontas.
//
// As três regras que vieram de lá, verbatim em intenção:
//   1. **O CADASTRO É A AUTORIDADE, NUNCA O PAYLOAD.** A tela só pode oferecer o que a empresa
//      declara. Um código fora disso é recusado no servidor (`NFSE_CODIGO_SERVICO_FORA_DA_LISTA`),
//      e oferecê-lo aqui seria montar um formulário cuja única saída é a recusa.
//   2. **A LISTA VENCE O SINGULAR quando existe**; sem lista, o singular é a autoridade.
//   3. ⚠ **NUNCA "o primeiro da lista".** Escolher sozinho seria o sistema decidindo qual serviço a
//      empresa declara ao fisco. Com vários e nenhum escolhido, a tela **não elege** — ela pergunta.
//
// ⚠ **ENCONTRA, NUNCA ESCOLHE:** nem quando o resultado é único. Um código só não vira "escolhido"
// automaticamente — ele vira "é este, e a tela diz qual". A diferença aparece no payload: sem
// escolha, o campo não é enviado e o servidor usa o cadastro (o comportamento de sempre).
//
// ⚠ **FORMA, NUNCA CONTEÚDO** — igual ao backend: 6 dígitos, `length !== 6`, **sem padding**.
// Padding fabricaria código plausível a partir de um dígito a menos, a classe do `cLocEmi="0000000"`.

/** Forma do `cTribNac`. ⚠ O MESMO critério do backend: 6 dígitos, sem `padStart`. */
export const TAMANHO_CTRIB_NAC = 6;

export function normalizarCodigoServicoNacional(valor) {
  if (valor === null || valor === undefined) return null;
  const digitos = String(valor).replace(/\D+/g, "");
  return digitos.length === TAMANHO_CTRIB_NAC ? digitos : null;
}

/** Estado do seletor. É o que decide o que a tela desenha. */
export const SITUACAO = Object.freeze({
  /** A empresa não declarou nenhum código — não há o que oferecer nem o que emitir. */
  SEM_CODIGO: "sem_codigo",
  /** Um código só. ⚠ O RAMO QUE RENDERIZA HOJE: 0 de 33 empresas têm lista plural. */
  UNICO: "unico",
  /** Vários. A tela pergunta, e não elege. */
  VARIOS: "varios",
});

/**
 * O que a tela pode oferecer, a partir do cadastro que chegou.
 *
 * ⚠ **CÓDIGO GRAVADO FORA DA FORMA NÃO SOME — ele aparece como INVÁLIDO.** Descartá-lo em silêncio
 * faria o cliente achar que a empresa tem menos códigos do que tem, e a coluna não tem CHECK no
 * banco (o Postgres proíbe subquery em CHECK, e `unnest` é subquery — está escrito na migration),
 * então isto acontece de verdade. ⚠ Ele não é OFERECÍVEL: o backend o recusaria.
 *
 * @param {Object} cadastro
 * @param {string[]} [cadastro.lista]   `Company.codigosServicoNacional`
 * @param {string|null} [cadastro.singular] `Company.codigoServicoNacional`
 */
export function codigosOferecidos({ lista, singular } = {}) {
  const brutos = Array.isArray(lista) ? lista : [];
  const validos = [];
  const invalidos = [];
  for (const item of brutos) {
    const codigo = normalizarCodigoServicoNacional(item);
    if (codigo) {
      if (!validos.includes(codigo)) validos.push(codigo);
    } else if (String(item ?? "").trim()) {
      invalidos.push(String(item).trim());
    }
  }

  const doCadastro = normalizarCodigoServicoNacional(singular);
  // ⚠ A MESMA PRECEDÊNCIA DO BACKEND: a lista vence quando existe; sem lista, o singular.
  const oferecidos = validos.length ? validos : doCadastro ? [doCadastro] : [];

  // ⚠ O singular fora da forma também aparece — é o caso de uma empresa cujo cadastro tem "31.01".
  if (!validos.length && !doCadastro && String(singular ?? "").trim()) {
    invalidos.push(String(singular).trim());
  }

  const situacao = oferecidos.length === 0
    ? SITUACAO.SEM_CODIGO
    : oferecidos.length === 1
      ? SITUACAO.UNICO
      : SITUACAO.VARIOS;

  return { situacao, oferecidos, invalidos, singular: doCadastro };
}

/**
 * O que vai no payload — e **`null` significa "não mande o campo"**.
 *
 * ⚠⚠ ESTE É O OPOSTO DO CASO DA CARGA TRIBUTÁRIA, onde a tela MOSTRA e não manda. Aqui a escolha é
 * **da nota**: o código escolhido tem de chegar ao XML, senão o seletor seria enfeite — e um
 * seletor que parece funcionar e emite outro código é erro fiscal SILENCIOSO, que é pior que a
 * ausência do seletor (está escrito assim no backend).
 *
 * ⚠ **UNICO NÃO MANDA NADA.** Sem o campo, o servidor usa o cadastro — o caminho de hoje, intacto,
 * e nenhuma emissão existente muda de comportamento. Mandar o único seria trocar um caminho testado
 * por outro sem necessidade nenhuma.
 */
export function codigoParaOPayload({ situacao, escolhido } = {}) {
  if (situacao !== SITUACAO.VARIOS) return null;
  return normalizarCodigoServicoNacional(escolhido);
}

/**
 * ⚠⚠ QUAL CÓDIGO ESTA NOTA VAI DECLARAR — a pergunta da PRÉVIA (31/08/2026).
 *
 * Achado em teste de usabilidade: com vários códigos cadastrados, o espelho da nota mostrava o
 * SINGULAR do cadastro e **não mudava** com a escolha — a nota saía com um código e a prévia
 * afirmava outro. E com **nada escolhido** ela já afirmava o singular, enquanto a tela recusa
 * emitir ("a tela não elege"): o espelho elegia.
 *
 * ⚠⚠ **NÃO É `codigoParaOPayload`, e a diferença é o ponto.** Aquela responde *"que campo eu
 * MANDO?"* e devolve `null` no caso `UNICO` de propósito — nada é enviado e o servidor usa o
 * cadastro, que é o caminho de sempre. Esta responde *"o que vai sair na nota?"*, e aí o caso
 * `UNICO` tem resposta: o código do cadastro, que é exatamente o que o servidor vai usar.
 *
 * ⚠ Com `VARIOS` e nada escolhido devolve `null` — a prévia mostra traço. A tela continua sem
 * eleger, e o espelho para de eleger junto.
 */
export function codigoQueANotaDeclara({ situacao, oferecidos = [], escolhido, singular } = {}) {
  if (situacao === SITUACAO.SEM_CODIGO) return null;
  if (situacao === SITUACAO.UNICO) {
    // ⚠ O oferecido, e não o `singular` cru: `codigosOferecidos` já normalizou e recusou o que
    // está fora da forma. Ler o cru devolveria à tela um código que a lib rejeitou.
    return oferecidos[0] || normalizarCodigoServicoNacional(singular);
  }
  const codigo = normalizarCodigoServicoNacional(escolhido);
  return codigo && oferecidos.includes(codigo) ? codigo : null;
}

/**
 * O formulário está pronto quanto ao código de serviço?
 *
 * ⚠ COM VÁRIOS E NENHUM ESCOLHIDO, A TELA NÃO ELEGE — ela diz o que falta. É a regra 3 do backend,
 * do lado de cá: o sistema não decide qual serviço a empresa declara ao fisco.
 */
export function conferirCodigoEscolhido({ situacao, oferecidos = [], escolhido } = {}) {
  if (situacao !== SITUACAO.VARIOS) return { ok: true, falta: null };
  const codigo = normalizarCodigoServicoNacional(escolhido);
  if (!codigo || !oferecidos.includes(codigo)) {
    return {
      ok: false,
      falta: "Escolha o código de serviço desta nota.",
    };
  }
  return { ok: true, falta: null };
}

/**
 * A lista oficial dos 335, sob demanda.
 *
 * ⚠ `import()` DINÂMICO — são ~66 KB que não entram no bundle inicial. Mesmo desenho de
 * `lib/municipios/municipioIbge.js`, inclusive o zerar da promessa em caso de falha: sem isso, uma
 * queda de carga viraria "lista vazia" permanente e a tela nunca tentaria de novo.
 *
 * ⚠ Isto NÃO é chamada de rede a terceiro: é um chunk do próprio build. O arquivo é GERADO do
 * Anexo B versionado (`apps/api/scripts/gerar-lista-servico-nacional.mjs`, que escreve nos dois
 * portais de propósito) e não se edita à mão.
 */
let promessaDaLista = null;
export function carregarServicosNacionais() {
  if (!promessaDaLista) {
    promessaDaLista = import("../../../lib/servicosNacionais/servicosNacionais.data.js")
      .then((m) => m.SERVICOS_NACIONAIS || m.default || [])
      .catch((err) => {
        promessaDaLista = null;
        throw err;
      });
  }
  return promessaDaLista;
}

/** ⚠ Só para teste: esquece a lista carregada. */
export function __esquecerListaDeServicos() {
  promessaDaLista = null;
}

/**
 * A descrição oficial de um código, quando a lista já carregou.
 *
 * ⚠ **AUSÊNCIA É RESPOSTA.** Código que não está na lista oficial devolve `null` — e a tela mostra
 * o número sozinho, sem inventar texto. Isso acontece de verdade: o Anexo B é atualizado e um
 * cadastro pode carregar um código de uma versão anterior.
 */
export function descricaoDoCodigo(lista, codigo) {
  const alvo = normalizarCodigoServicoNacional(codigo);
  if (!alvo || !Array.isArray(lista)) return null;
  for (const item of lista) {
    // O dado gerado é uma tupla `[codigo, descricao, ...]` ou um objeto — os dois são aceitos
    // porque o formato é do GERADOR, e ler só uma forma quebraria na próxima geração.
    const c = Array.isArray(item) ? item[0] : item?.codigo;
    if (normalizarCodigoServicoNacional(c) === alvo) {
      const d = Array.isArray(item) ? item[1] : item?.descricao;
      return String(d ?? "").trim() || null;
    }
  }
  return null;
}

/** O rótulo de uma opção: `310104 — Descrição oficial`, ou só o número quando ela não veio. */
export function rotuloDoCodigo(codigo, descricao) {
  const c = normalizarCodigoServicoNacional(codigo) || String(codigo ?? "");
  return descricao ? `${c} — ${descricao}` : c;
}
