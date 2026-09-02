// O PERFIL DE EMISSÃO NA TELA DO CLIENTE — uma resposta, quatro consumidores.
//
// ⚠⚠ O QUE ESTE MÓDULO EXISTE PARA RESPONDER: *"o que esta tela ainda precisa perguntar?"*. O
// contador configurou o perfil; o que sai daqui é a lista do que SOME e o que FICA — e a mesma
// resposta alimenta o render, o `montarPayload`, a prévia e a trava do submit.
//
// É o desenho de `impostosDaNota.js`, e pelo mesmo motivo escrito lá: *"dois parâmetros que
// precisam concordar são dois parâmetros que um dia não vão concordar"*.
//
// ⚠⚠ CAMPO ESCONDIDO QUE CONTINUA VIAJANDO É O DEFEITO PIOR. Quando um campo sai da tela, ele sai
// TAMBÉM do corpo — e há teste varrendo o `JSON.stringify` do payload inteiro.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE **NÃO** SAI DA TELA, E POR QUÊ — três campos, três motivos diferentes
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. **Alíquota efetiva do Simples (`pTotTribSN`)** — ela é `DAS ÷ faturamento` **da competência**,
//    e muda TODO MÊS com o RBT12. Um perfil é estático: guardá-la ali congelaria uma alíquota
//    variável e declararia ao tomador um percentual velho, impresso na nota (Lei 12.741/2012).
//    ⚠ Ela já não é digitada — o portal a preenche da rota `/aliquotas`, com a procedência à vista.
//
// 2. **A caixa "o ISS desta nota é retido pelo tomador"** — decisão do dono, 01/09/2026:
//    *"o contador declara a alíquota de ISS para reter, mas o cliente na tela dele deve poder
//    selecionar se é retido ou não"*. A retenção depende do TOMADOR daquela nota; a alíquota
//    depende da empresa.
//
// 3. **A alíquota do ISS** — ela é a metade do item 2 que vem do perfil, e o campo `pAliq` ainda
//    não existe no perfil (o gerador não monta `tribMun/pAliq`; ver `FORA_DESTA_FASE`). Enquanto
//    isso ela continua na tela, e só aparece com a caixa marcada, como sempre.

/** As três respostas. ⚠ `NAO_RECEBIDA` é fato sobre a RESPOSTA, não sobre a empresa. */
export const SITUACAO = Object.freeze({
  NAO_RECEBIDA: "nao_recebida",
  SEM_PERFIL: "sem_perfil",
  UNICO: "unico",
  VARIOS: "varios",
});

/**
 * Lê a lista de perfis que a rota devolveu.
 *
 * ⚠ Aceita a resposta inteira (`{data, total}`) ou o array. Contrato antigo ou rota fora do ar cai
 * em `NAO_RECEBIDA`, e a tela segue funcionando como antes — perfil é melhoria, não pré-requisito.
 */
export function lerPerfis(resposta) {
  if (resposta === null || resposta === undefined) return { situacao: SITUACAO.NAO_RECEBIDA, perfis: [] };
  const bruto = Array.isArray(resposta) ? resposta : resposta?.data;
  if (!Array.isArray(bruto)) return { situacao: SITUACAO.NAO_RECEBIDA, perfis: [] };

  const perfis = bruto
    .filter((p) => p && typeof p.id === "string" && String(p.nome ?? "").trim() !== "")
    .map((p) => ({ id: p.id, nome: String(p.nome).trim(), padrao: p.padrao === true }));

  if (!perfis.length) return { situacao: SITUACAO.SEM_PERFIL, perfis: [] };
  if (perfis.length === 1) return { situacao: SITUACAO.UNICO, perfis };
  return { situacao: SITUACAO.VARIOS, perfis };
}

/**
 * O que a tela mostra e o que ela esconde.
 *
 * ⚠⚠ SÓ ESCONDE O QUE O PERFIL DE FATO RESPONDE. Sem perfil, nada muda — é o comportamento de
 * hoje, e é o estado de toda empresa até o contador configurar. Esconder um campo que ninguém
 * respondeu produziria emissão recusada com o campo do conserto fora da tela.
 */
export function camposDoPerfil(leitura) {
  const temPerfil = leitura?.situacao === SITUACAO.UNICO || leitura?.situacao === SITUACAO.VARIOS;
  return {
    // O seletor só existe com MAIS DE UM. Com um só, não há o que escolher — mesmo desenho do
    // ramo `UNICO` do código de serviço.
    mostrarSeletor: leitura?.situacao === SITUACAO.VARIOS,
    // ⚠ Estes dois SOMEM porque o perfil os responde: `cTribNac` e `cLocPrestacao`.
    codigoServicoNoFormulario: !temPerfil,
    municipioDaPrestacaoNoFormulario: !temPerfil,
  };
}

/**
 * ⚠⚠ COM VÁRIOS PERFIS E NENHUM ESCOLHIDO, A TELA RECUSA — e não cai no padrão.
 *
 * Cair no `padrao` faria o padrão virar a resposta de quem não respondeu, e o efeito é fiscal: os
 * perfis existem justamente porque a empresa tem operações com tributação diferente. É a mesma
 * trava de `conferirCodigoEscolhido`, pelo mesmo motivo — sem ela, a empresa com dois perfis
 * emitiria sob o primeiro **em silêncio**.
 */
export function conferirPerfilEscolhido(leitura, perfilId) {
  if (leitura?.situacao !== SITUACAO.VARIOS) return { ok: true };
  const escolhido = String(perfilId ?? "").trim();
  if (!escolhido) {
    return { ok: false, falta: "Escolha o tipo de serviço desta nota." };
  }
  if (!leitura.perfis.some((p) => p.id === escolhido)) {
    return { ok: false, falta: "O tipo de serviço escolhido não está mais disponível — escolha de novo." };
  }
  return { ok: true };
}

/**
 * O `perfilId` que vai no corpo — ou `null`, que quer dizer **não mandar o campo**.
 *
 * ⚠ Com UM perfil o campo NÃO é enviado, e isso é deliberado: o servidor resolve o único perfil
 * ativo sozinho, que é o caminho de sempre. Mandar o id aqui não mudaria o resultado e criaria uma
 * segunda fonte para a mesma decisão. Mesma escolha do ramo `UNICO` do código de serviço, que
 * também não envia.
 */
export function perfilParaOPayload(leitura, perfilId) {
  if (leitura?.situacao !== SITUACAO.VARIOS) return null;
  const escolhido = String(perfilId ?? "").trim();
  return escolhido || null;
}

/**
 * A frase que a tela mostra quando o perfil está mandando.
 *
 * ⚠ Ela nomeia o CONTADOR, não o sistema: o cliente precisa saber a quem recorrer se o que está
 * configurado estiver errado. E não explica mecânica interna — o critério transversal deste portal.
 */
export function textoDoPerfil(leitura) {
  if (leitura?.situacao === SITUACAO.UNICO) {
    return `O tipo de serviço desta nota é "${leitura.perfis[0].nome}", configurado pelo seu contador.`;
  }
  if (leitura?.situacao === SITUACAO.VARIOS) {
    return "Escolha o tipo de serviço desta nota. Os tipos são configurados pelo seu contador.";
  }
  return null;
}
