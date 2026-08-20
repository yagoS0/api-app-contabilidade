// QUAIS CAMPOS DE IMPOSTO ESTA NOTA LEVA — e, por consequência, quais VIAJAM no payload.
//
// ⚠⚠ **O GUARDA VALE NOS DOIS SENTIDOS, SEMPRE.** É a mesma disciplina do commit `0905d58e` (a
// carga tributária do Presumido) e do bloco de ISS: um campo não é só "escondido" — ele deixa de
// existir para a nota. **Campo escondido que continua viajando é o defeito pior**: a tela mostra
// uma coisa e o servidor recebe outra, e quem confere a tela nunca descobre.
//
// ─── AS TRÊS PERGUNTAS, e a fonte de cada resposta ──────────────────────────────────────────────
//
// 1. **`pTotTribSN` — a alíquota efetiva do SIMPLES.** Só a empresa do Simples declara. Medido em
//    `apps/api/src/application/nfse/NfseService.js`: o grupo só é escrito no XML sob
//    `isSimples ? "<totTrib><pTotTribSN>…" : "<totTrib><pTotTrib><pTotTribFed>…"` (:952). Ou seja,
//    para o não optante o campo **não vai à nota** — e a nota dele declara os TRÊS percentuais da
//    Lei 12.741/2012, que são do CADASTRO e esta tela nem envia.
//    ⚠ **DEFEITO EM PRODUÇÃO (20/08/2026), relatado pelo dono:** *"empresa presumida aparecendo
//    isso na nota: Alíquota efetiva do Simples (%). Não pode."* O campo era renderizado **sem
//    nenhuma condição de regime** — os vizinhos tinham guarda, este ficou de fora.
//    ⚠ **REGIME INDEFINIDO TAMBÉM NÃO DECLARA.** Ali não se sabe qual grupo a nota leva, e mostrar
//    "Alíquota efetiva do Simples" é afirmar que a empresa é do Simples — o default silencioso que
//    este projeto proíbe. É exatamente o critério da carga tributária, com o sinal invertido.
//    ⚠ E isto **não** deixa o não optante sem saída: o servidor só exige `pTotTribSN` de quem é do
//    Simples (`MISSING_P_TOT_TRIB_SN` está sob `if (isSimples …)`, :626). Esconder aqui não fabrica
//    recusa nenhuma. Já o regime INDEFINIDO é recusado pelo servidor antes disso, por outro motivo
//    e com outro nome (`NFSE_REGIME_INDEFINIDO`) — que é do cadastro, não deste campo.
//
// 2. **O bloco de ISS (a caixa de retenção).** Sai do formulário no Simples — decisão do dono,
//    18/08/2026: lá o ISS está dentro do DAS. Regime INDEFINIDO **mantém** o bloco, e a diferença
//    em relação ao item 1 é o desenho inteiro: mostrar um campo a mais é um incômodo; escondê-lo
//    indevidamente é uma emissão recusada com o campo do conserto fora da tela. Mostrar
//    `pTotTribSN` não é "um campo a mais" — é uma AFIRMAÇÃO sobre o regime da empresa.
//
// 3. **A alíquota de ISS.** Só existe com RETENÇÃO — pedido do dono (20/08/2026): *"a alíquota de
//    ISS é apenas se for retido, correto? então só deve aparecer campo de alíquota se clicar na
//    caixa de retenção de ISS."* Confirmado na fonte, e por três caminhos independentes:
//      • `NfseService.js:766` — a alíquota **só é exigida** quando `issRetido === true`
//        (`retencao.exigeAliquota`, código `NFSE_ISS_RETIDO_SEM_ALIQUOTA`);
//      • ela **não entra no XML**: o grupo `<tribMun>` (:870) leva só `<tribISSQN>` e
//        `<tpRetISSQN>`. `NfseService` a grava em `ServiceInvoice.aliquota`, que é registro NOSSO;
//      • o Anexo I: informar `pAliq` sendo **não optante** em município ativo é a rejeição
//        **E0617**. Mandar não é só inútil — seria errado.
//    ⚠ Marcada a caixa, a alíquota é **OBRIGATÓRIA e maior que zero**, e a tela diz isso ANTES: a
//    recusa do servidor viria de qualquer jeito, e descobri-la no clique de um ato fiscal é o pior
//    momento possível.
//    ⚠ Desmarcada, o campo some **e o valor não viaja** — pelo item 3 acima, e pelo princípio do
//    cabeçalho.
//
// ⚠ ISTO É SÓ PARA O NÃO OPTANTE. No Simples o bloco de ISS inteiro já saiu da tela; nada aqui o
// reintroduz — `aliquotaNoFormulario` depende de `issNoFormulario`, não só da caixa.

export const REGIME = { SIMPLES: "simples", OUTRO: "outro", DESCONHECIDO: "desconhecido" };

/**
 * O REGIME DA EMPRESA, do jeito que ESTA TELA consegue lê-lo — com a ressalva no nome.
 *
 * ⚠ **A AUTORIDADE NÃO É ESTE CAMPO.** No servidor quem decide é `CadastroFiscal.regime`, com
 * `Company.regimeTributario` como SEGUNDA leitura (`carregarRegimeDaEmpresa`, em `NfseService`), e
 * `GET /client/companies` só nos manda a segunda. As duas podem discordar.
 *
 * ⚠ Por isso a resposta tem TRÊS estados, e o terceiro não é "não". Regime ausente ou não
 * reconhecido devolve `DESCONHECIDO`.
 *
 * A normalização copia `resolverOpSimpNac` (`apps/api/src/application/nfse/dpsCodigos.js`),
 * inclusive o alias SIMPLES → SIMPLES_NACIONAL. ⚠ `optanteSimples` existe na resposta e **não é
 * usado**: o backend não o consulta para o `opSimpNac`, e eleger aqui uma autoridade que lá não
 * existe é como as duas pontas passam a discordar.
 */
export function lerRegime(empresa) {
  const bruto = String(empresa?.legacyCompany?.regimeTributario || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!bruto) return REGIME.DESCONHECIDO;
  if (bruto === "SIMPLES" || bruto === "SIMPLES_NACIONAL") return REGIME.SIMPLES;
  if (bruto === "LUCRO_PRESUMIDO" || bruto === "LUCRO_REAL") return REGIME.OUTRO;
  return REGIME.DESCONHECIDO;
}

/**
 * Os campos de imposto que ESTA nota leva.
 *
 * ⚠ **UMA RESPOSTA SÓ, LIDA PELA TELA E PELO PAYLOAD.** Duas leituras (uma para renderizar, outra
 * para montar o corpo) divergem na primeira correção — e a divergência é justamente o defeito de
 * produção que este módulo existe para fechar.
 *
 * @param {object} p
 * @param {string} p.regime um dos `REGIME`
 * @param {boolean} [p.issRetido] o estado da caixa de retenção
 */
export function camposDeImposto({ regime, issRetido = false }) {
  const ehSimples = regime === REGIME.SIMPLES;
  const issNoFormulario = !ehSimples;
  return {
    // O bloco de ISS (caixa de retenção). Regime indefinido MANTÉM.
    issNoFormulario,
    // A alíquota de ISS: dentro do bloco, e só com a caixa marcada.
    aliquotaNoFormulario: issNoFormulario && issRetido === true,
    // ⚠ `=== SIMPLES`, nunca `!== OUTRO`: o indefinido não pode cair aqui por negação.
    pTotTribSNNoFormulario: ehSimples,
  };
}

/** Número de um campo de percentual. ⚠ `""` é `null`, não `0` — zero digitado é outra coisa. */
function percentual(valor) {
  const s = String(valor ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * A alíquota de ISS está em condição de emitir?
 *
 * ⚠ A TELA DIZ ANTES o que o servidor recusaria depois. `buildDpsXml` exige `aliquota > 0` quando
 * `issRetido === true` (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`) — e `0` **não** satisfaz, então
 * `required` no HTML não basta: um zero digitado passa pelo navegador e morre no servidor.
 *
 * @returns {{ok: boolean, falta: string|null}} `falta` é a frase da tela; `null` quando está ok.
 */
export function conferirAliquotaIss({ regime, issRetido = false, aliquota = "" }) {
  const { aliquotaNoFormulario } = camposDeImposto({ regime, issRetido });
  if (!aliquotaNoFormulario) return { ok: true, falta: null };
  const n = percentual(aliquota);
  if (n === null) {
    return {
      ok: false,
      falta: "Com o ISS retido, informe a alíquota de ISS — sem ela a nota é recusada antes de sair daqui.",
    };
  }
  if (!(n > 0)) {
    return {
      ok: false,
      falta: "A alíquota de ISS precisa ser maior que zero quando o imposto é retido pelo tomador.",
    };
  }
  return { ok: true, falta: null };
}

/**
 * A alíquota de ISS que VAI no payload — ou `null`, que significa NÃO MANDAR O CAMPO.
 *
 * ⚠ Fora do caso "não optante **com retenção marcada**" ela não viaja. Nem no Simples (o bloco
 * inteiro saiu da tela), nem com a caixa desmarcada: o valor pode ter ficado preso no estado do
 * formulário de quando a caixa estava marcada, e um campo escondido que continua viajando é o
 * defeito que o cabeçalho deste arquivo nomeia.
 */
export function aliquotaIssParaOPayload({ regime, issRetido = false, aliquota = "" }) {
  const { aliquotaNoFormulario } = camposDeImposto({ regime, issRetido });
  if (!aliquotaNoFormulario) return null;
  return percentual(aliquota);
}

/**
 * O `pTotTribSN` que VAI no payload — ou `null`, que significa NÃO MANDAR O GRUPO `totTrib`.
 *
 * ⚠ Fora do Simples ele não viaja, e isso vale para o regime INDEFINIDO também. O campo pode ter
 * ficado preenchido pelo efeito da alíquota efetiva antes de a empresa mudar, ou por um modelo de
 * nota reaproveitada — e "não aparece na tela" nunca foi garantia de "não está no corpo".
 */
export function pTotTribSNParaOPayload({ regime, pTotTribSN = "" }) {
  const { pTotTribSNNoFormulario } = camposDeImposto({ regime });
  if (!pTotTribSNNoFormulario) return null;
  return percentual(pTotTribSN);
}
