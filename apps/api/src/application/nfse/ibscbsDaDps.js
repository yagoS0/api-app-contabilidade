// O `cNBS` E O BLOCO `IBSCBS` DA DPS — regra PURA, e as recusas que acontecem ANTES de enviar.
//
// ⚠⚠ ESTE MÓDULO NÃO MONTA XML. Ele decide **o quê** sai e **recusa nomeando** o que a Receita
// recusaria — o princípio que o portal do cliente já aplica ("a tela diz antes o que o servidor
// recusaria, e não cobra caro por erro barato"). Aqui é mais caro ainda: a recusa acontece no
// pré-voo de `issue`, ANTES de reservar numeração, e **não existe inutilização na NFS-e** — número
// gasto à toa é buraco permanente.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// AS REGRAS, LIDAS DO ANEXO_I VERSIONADO (aba `RN DPS_NFS-e`) — não de memória
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//   E0322 (linha 324) — "Se o bloco de informações de IBS/CBS (…/infDPS/IBSCBS) for informado na
//                        DPS, então é obrigatório informar na DPS um item da NBS."
//   E0318 (linha 322) — o `cNBS` também é obrigatório na EXPORTAÇÃO de serviço (país no exterior
//                        do tomador/intermediário, ou `cPaisPrestacao` informado). ⚠ A exportação
//                        NÃO é montada por este projeto ainda; quando for, esta guarda é o lugar.
//   E0901 (linha 546) — "O código indicador da operação deve constar na tabela de códigos conforme
//                        ANEXO C." ⚠⚠ O **ANEXO C NÃO ESTÁ VERSIONADO AQUI**. Conferimos contra o
//                        ANEXO VIII, que correlaciona item→cIndOp e é SUBCONJUNTO daquela tabela:
//                        mais estrito que a norma exige, portanto na direção segura. Um código
//                        legítimo do ANEXO C fora do ANEXO VIII é recusado por nós — falha
//                        FECHADA, e nomeada. Não afrouxe isto "porque o ADN aceitaria".
//   E0910 (linha 554) — "O destinatário só deve ser identificado quando indDest for 1."
//
// ⚠⚠ **`indDest = "0"` NÃO É PALPITE — É FATO SOBRE O DOCUMENTO QUE NÓS EMITIMOS.** Pela E0910, o
// grupo `dest` só existe com `indDest = 1`; `buildDpsXml` **nunca monta `dest`**, logo o
// destinatário É o tomador identificado na nota. Se um dia o gerador passar a montar `dest`, esta
// constante deixa de valer e as duas coisas mudam JUNTAS. Há teste varrendo o gerador atrás de
// `<dest>` exatamente para que essa mudança não passe calada.
//
// ⚠ `finNFSe = "0"` é o ÚNICO valor de `TSRTCFinNFSe` no XSD 1.01 ("NFS-e regular"). Não é escolha.

import { conferirCombinacao, itemLc116DoCodigoNacional } from "../fiscal/ibscbs/index.js";
import { RECUSA_NBS, nbsParaDps } from "../fiscal/nbs/index.js";

/** ⚠ Único valor de `TSRTCFinNFSe` no XSD 1.01. */
export const FIN_NFSE_REGULAR = "0";
/** ⚠ Derivado da E0910 + do fato de o gerador nunca montar `dest`. Ver o cabeçalho. */
export const IND_DEST_E_O_TOMADOR = "0";

/** ⚠ `TSRTCCodSitTrib` é `[0-9]{3}` no XSD e **não tem enumeração** — só a forma é conferível. */
const FORMA_CST = /^[0-9]{3}$/;

const texto = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * O `<cNBS>` que a DPS vai levar — ou a recusa.
 *
 * ⚠ NÃO DECLARADO É O ESTADO NORMAL, e não é erro: a coluna nasceu nula em todo perfil, e enquanto
 * ninguém preencher, nenhuma nota ganha `cNBS`. É o mesmo desenho do resto do perfil — o campo
 * nasce desligado pelo DADO, não por uma flag.
 */
export function nbsDaDps(perfil) {
  const declarado = texto(perfil?.codigoNbs);
  if (!declarado) return { ok: true, informar: false, cNBS: null };

  const r = nbsParaDps(declarado);
  if (r.ok) return { ok: true, informar: true, cNBS: r.cNBS, codigo: r.codigo };

  // ⚠⚠ "NÃO TERMINAL" GANHA MENSAGEM PRÓPRIA. `1.0101` é código publicado e correto — ele só
  // identifica uma FAMÍLIA. Dizer "inválido" mandaria o contador procurar erro de digitação.
  if (r.motivo === RECUSA_NBS.NAO_TERMINAL) {
    return {
      ok: false,
      codigo: "NFSE_NBS_NAO_TERMINAL",
      message:
        `O código NBS ${r.codigo} identifica uma FAMÍLIA de serviços, não um serviço. ` +
        "A DPS só aceita códigos terminais.",
      correcao:
        "Escolha um dos códigos mais específicos abaixo dele no perfil de emissão: " +
        `${r.descendentes.slice(0, 6).join(" · ")}` +
        (r.descendentes.length > 6 ? ` (e mais ${r.descendentes.length - 6})` : ""),
    };
  }
  return {
    ok: false,
    codigo: "NFSE_NBS_INVALIDO",
    message: `O código NBS declarado no perfil de emissão não está na tabela oficial: ${declarado}`,
    correcao: "Corrija o código NBS do perfil de emissão. Ele é escolhido na lista oficial da NBS 2.0.",
  };
}

/**
 * O bloco `IBSCBS` da DPS — ou a recusa, ou "não informar".
 *
 * @param {object} p
 * @param {string} p.cTribNac  o código de tributação nacional QUE A NOTA VAI LEVAR (já decidido
 *                             pelo pré-voo, nunca o payload cru)
 * @param {object|null} p.perfil
 * @param {boolean} p.ligado   `INTEGRACAO_NFSE_IBSCBS`
 * @param {string|null} p.cNBS o `cNBS` já resolvido por `nbsDaDps` — a E0322 se confere aqui
 */
export function ibscbsDaDps({ cTribNac, perfil, ligado, cNBS }) {
  const cIndOp = texto(perfil?.ibscbsCIndOp);
  const cst = texto(perfil?.ibscbsCst);
  const cClassTrib = texto(perfil?.ibscbsCClassTrib);
  const declarados = [cIndOp, cst, cClassTrib].filter(Boolean).length;

  // ⚠⚠ A FLAG DESLIGADA NÃO É "IGNORE EM SILÊNCIO" QUANDO HÁ DADO. Perfil sem nada declarado é o
  // caso de 100% das linhas hoje, e ali não há o que dizer. Mas um perfil COM os três campos
  // preenchidos e a flag OFF é uma configuração que o contador fez e que não está saindo — o
  // `motivo` existe para o painel poder dizer isso, em vez de o campo sumir sem explicação.
  if (!ligado) {
    return { ok: true, informar: false, motivo: declarados ? "INTEGRACAO_DESLIGADA" : null };
  }
  if (declarados === 0) return { ok: true, informar: false, motivo: null };

  // ⚠ MEIO BLOCO É NOTA RECUSADA. Os três são obrigatórios no XSD (`TCRTCInfoIBSCBS` +
  // `TCRTCInfoTributosSitClas`), então declarar um e esquecer outro não pode virar XML.
  if (declarados < 3) {
    const faltando = [
      !cIndOp && "código indicador da operação (cIndOp)",
      !cst && "código de situação tributária (CST)",
      !cClassTrib && "código de classificação tributária (cClassTrib)",
    ].filter(Boolean);
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_INCOMPLETO",
      message: `O bloco de IBS/CBS do perfil de emissão está incompleto: falta ${faltando.join(" e ")}.`,
      correcao: "Complete os três campos de IBS/CBS no perfil, ou deixe os três em branco.",
      faltando,
    };
  }

  if (!FORMA_CST.test(cst)) {
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_CST_INVALIDO",
      message: `O CST do IBS/CBS tem de ter 3 dígitos. Declarado: ${cst}`,
      correcao: "Corrija o CST no perfil de emissão.",
    };
  }

  // ⚠⚠ E0322: sem NBS, o bloco não pode sair. Recusar aqui é o que impede a nota de ir e voltar
  // rejeitada por uma regra que está no nosso disco.
  if (!cNBS) {
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_SEM_NBS",
      message:
        "Declarar IBS/CBS na nota obriga a informar um item da NBS (regra E0322 do Padrão Nacional), " +
        "e o perfil de emissão não tem código NBS.",
      correcao:
        "Informe o código NBS no perfil de emissão, ou apague os campos de IBS/CBS dele.",
    };
  }

  // ⚠ O par é conferido JUNTO contra o ANEXO VIII — duas listas soltas autorizariam, em 7 itens,
  // combinações que a fonte não traz.
  const item = itemLc116DoCodigoNacional(cTribNac);
  const conferencia = conferirCombinacao(item, { cIndOp, cClassTrib });
  if (!conferencia.ok) {
    return {
      ok: false,
      codigo: "NFSE_IBSCBS_COMBINACAO_NAO_AUTORIZADA",
      message:
        `O ANEXO VIII não correlaciona cIndOp ${cIndOp} com cClassTrib ${cClassTrib} para o ` +
        `serviço ${cTribNac}${item ? ` (item ${item} da LC 116)` : ""}.`,
      correcao: conferencia.autorizadas?.length
        ? "Combinações autorizadas para este serviço: " +
          conferencia.autorizadas.map((c) => `${c.cIndOp}/${c.cClassTrib}`).join(" · ")
        : "Este serviço não tem correlação de IBS/CBS no ANEXO VIII — não declare o bloco para ele.",
      motivo: conferencia.motivo,
    };
  }

  return {
    ok: true,
    informar: true,
    bloco: Object.freeze({
      finNFSe: FIN_NFSE_REGULAR,
      cIndOp,
      indDest: IND_DEST_E_O_TOMADOR,
      cst,
      cClassTrib,
    }),
  };
}

/**
 * ⚠ SUGESTÃO DE CST A PARTIR DO `cClassTrib` — e ela viaja MARCADA como não verificada.
 *
 * Medido nos 28 `cClassTrib` do ANEXO VIII: os prefixos de três dígitos são `000`, `011`, `200`,
 * `400` e `820`, que PARECEM códigos de situação tributária. **Nenhuma fonte versionada afirma
 * essa correspondência**: o XSD dá só `[0-9]{3}` e o ANEXO_I não enumera. Então isto SUGERE — o
 * contador confirma —, na mesma decisão já registrada para a categoria de presunção do Lucro
 * Presumido: *derivar* (o sistema decide e calcula) virou *sugerir* (o sistema propõe e nomeia a
 * incerteza).
 *
 * ⚠ NÃO chame isto de dentro de `buildDpsXml`. O que vai à nota é o CST declarado.
 */
export function cstSugeridoPeloClassTrib(cClassTrib) {
  const t = texto(cClassTrib);
  if (!t || !/^[0-9]{6}$/.test(t)) return null;
  return Object.freeze({
    cst: t.slice(0, 3),
    verificadoNaFonte: false,
    motivo:
      "Os três primeiros dígitos do código de classificação tributária. Nenhuma fonte oficial " +
      "versionada neste projeto afirma essa correspondência — confirme antes de emitir.",
  });
}
