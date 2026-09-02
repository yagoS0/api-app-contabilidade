// O QUE A PRÓXIMA DPS VAI LEVAR — e de ONDE cada valor sai.
//
// ⚠⚠ ESTA É A PEÇA QUE FAZ A FASE 1 VALER SOZINHA, com a flag desligada. Hoje o contador não tem
// como saber o que a empresa dele vai emitir: `regApTribSN` e `tribISSQN` estão CRAVADOS dentro de
// `buildDpsXml`, e constante em código é invisível até a nota sair. Aqui os seis campos aparecem
// com o valor e a PROCEDÊNCIA, antes de qualquer emissão.
//
// ⚠ A resposta é a MESMA para os quatro consumidores — painel, rota, pré-voo e (quando a flag
// ligar) o gerador. É o desenho de `impostosDaNota.js` do lado do servidor: *"dois parâmetros que
// precisam concordar são dois parâmetros que um dia não vão concordar"*.
//
// ⚠⚠ O QUE ELE NÃO FAZ: não escreve nada, não decide se a nota tem retenção, não monta XML e não
// consulta serviço externo. Ele lê o perfil e o cadastro, e devolve o de-para.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { CAMPOS, campoPorId } from "./campos.js";

/**
 * ⚠⚠ TRÊS PROCEDÊNCIAS, e a terceira NÃO é "vazio".
 *
 * `INDEFINIDO` responde *"ninguém respondeu isto, nem o perfil nem o cadastro"* — e é diferente de
 * um valor vazio que alguém escolheu. Colapsar as duas é como `usaFatorR` deixou de distinguir "o
 * contador disse que não" de "ninguém abriu a tela".
 */
export const FONTE = Object.freeze({
  PERFIL: "PERFIL",
  COMPANY: "COMPANY",
  CRAVADO: "CRAVADO",
  INDEFINIDO: "INDEFINIDO",
});

/** Nada aqui usa `?? 0` nem `|| ""` — ver o comentário de `valorOuNulo`. */
function valorOuNulo(v) {
  // ⚠ `?? 0` e `|| ""` são exatamente como um campo não respondido vira uma AFIRMAÇÃO. O projeto
  // já pagou isso três vezes: o `pTotTrib` com `?? 0` declarando carga zero ao tomador, o
  // `fs12Manual: 0` gravando folha inexistente, e o `Number(null) === 0` da retenção.
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/**
 * O que o CADASTRO responde hoje, campo a campo — o comportamento sem perfil nenhum.
 *
 * ⚠ Os dois `CRAVADO` não são cadastro: são constantes dentro de `buildDpsXml`. Marcá-los assim é
 * o ponto do painel — o contador precisa ver que aquele valor não veio de decisão nenhuma.
 */
function doCadastro(company) {
  return {
    codigoServicoNacional: {
      valor: valorOuNulo(company?.codigoServicoNacional),
      fonte: FONTE.COMPANY,
    },
    codigoServicoMunicipal: {
      valor: valorOuNulo(company?.codigoServicoMunicipal),
      fonte: FONTE.COMPANY,
    },
    // O gerador só usa o do payload; não havendo, aplica a regra geral (município do emissor).
    cLocPrestacao: { valor: null, fonte: FONTE.INDEFINIDO },
    regEspTrib: {
      valor: valorOuNulo(company?.regimeEspecialTributacao) ?? "0",
      fonte: valorOuNulo(company?.regimeEspecialTributacao) ? FONTE.COMPANY : FONTE.CRAVADO,
    },
    regApTribSN: { valor: "1", fonte: FONTE.CRAVADO },
    tribISSQN: { valor: "1", fonte: FONTE.CRAVADO },

    // ⚠⚠ OS QUATRO DE NBS/IBS-CBS NÃO TÊM BASE NO CADASTRO, e isso é fato, não lacuna: a
    // `Company` nunca teve onde guardá-los e o gerador nunca os escreveu. `INDEFINIDO` é a resposta
    // certa — ninguém respondeu —, e é diferente de `CRAVADO` (o gerador decide por conta) e de
    // `COMPANY` (o cadastro responde). Marcá-los `CRAVADO` com valor nulo diria que o gerador
    // escolhe algo, quando ele simplesmente não escreve a tag.
    // ⚠ A alíquota do ISSQN nunca foi escrita pelo gerador — ela era coletada, validada e
    // descartada. `INDEFINIDO`, nunca `CRAVADO`.
    pAliq: { valor: null, fonte: FONTE.INDEFINIDO },
    codigoNbs: { valor: null, fonte: FONTE.INDEFINIDO },
    ibscbsCIndOp: { valor: null, fonte: FONTE.INDEFINIDO },
    ibscbsCst: { valor: null, fonte: FONTE.INDEFINIDO },
    ibscbsCClassTrib: { valor: null, fonte: FONTE.INDEFINIDO },
  };
}

/**
 * Resolve o perfil de emissão de uma empresa.
 *
 * ⚠⚠ PRECEDÊNCIA POR CAMPO, NÃO POR OBJETO. O perfil vence **naquilo que respondeu**; onde ele é
 * nulo, cai para o cadastro. Um `{...cadastro, ...perfil}` faria um perfil com um campo em branco
 * APAGAR o valor que a empresa já emite — que é o defeito do `{...cadastro, ...doCompany}` do
 * `GET /cadastro-fiscal`, consertado em 01/09/2026 pelo mesmo motivo.
 *
 * @param {{portalClientId: string, perfilId?: string|null}} args
 * @returns {Promise<{
 *   temPerfil: boolean, perfil: object|null, perfisAtivos: number,
 *   campos: Record<string, {valor: string|null, fonte: string, rotulo: string, tag: string,
 *                           caminhoNoXml: string, cravadoHoje: boolean, mudariaComPerfil: boolean}>,
 *   avisos: string[]
 * }>}
 */
export async function resolverPerfilDeEmissao({ portalClientId, perfilId = null }) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");

  const pc = await prisma.portalClient
    .findUnique({ where: { id: String(portalClientId) }, select: { companyId: true } })
    .catch(() => null);

  const company = pc?.companyId
    ? await prisma.company
        .findUnique({
          where: { id: pc.companyId },
          select: {
            codigoServicoNacional: true,
            codigosServicoNacional: true,
            codigoServicoMunicipal: true,
            regimeEspecialTributacao: true,
          },
        })
        .catch(() => null)
    : null;

  // ⚠ NÃO LANÇA quando a tabela ainda não existe. A migration nasce NÃO APLICADA, e uma tela de
  // configuração não pode quebrar porque a fase seguinte ainda não subiu — é a mesma disciplina de
  // `buscarTomadoresEmitidos`, que trata o P2021 e devolve vazio.
  let perfis = [];
  try {
    perfis = await prisma.perfilEmissaoNfse.findMany({
      where: { portalClientId: String(portalClientId), ativo: true },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
    });
  } catch {
    perfis = [];
  }

  const escolhido = perfilId
    ? perfis.find((p) => p.id === String(perfilId)) || null
    : perfis.length === 1
      ? perfis[0]
      : perfis.find((p) => p.padrao) || null;

  const base = doCadastro(company);
  const avisos = [];

  // ⚠⚠ O PERFIL ESCOLHIDO NÃO ENTRA QUANDO HÁ AMBIGUIDADE. Com 2+ perfis ativos e nenhum `perfilId`,
  // cair no `padrao` faria o padrão virar a resposta de quem não respondeu — e o efeito é fiscal.
  // A fase que liga o gerador RECUSA nomeando; aqui, que é leitura, o painel diz que está ambíguo.
  const ambiguo = !perfilId && perfis.length > 1 && !perfis.some((p) => p.padrao);
  if (ambiguo) {
    avisos.push(
      `Esta empresa tem ${perfis.length} perfis ativos e nenhum marcado como padrão. `
        + "Enquanto isso, a emissão continua saindo do cadastro."
    );
  }

  const campos = {};
  for (const def of CAMPOS) {
    const doPerfil = escolhido && !ambiguo ? valorOuNulo(escolhido[def.id]) : null;
    const daBase = base[def.id];
    const usaPerfil = doPerfil !== null;

    campos[def.id] = {
      rotulo: def.rotulo,
      tag: def.tag,
      caminhoNoXml: def.caminhoNoXml,
      cravadoHoje: def.cravadoHoje === true,
      valor: usaPerfil ? doPerfil : daBase.valor,
      fonte: usaPerfil ? FONTE.PERFIL : daBase.valor === null ? FONTE.INDEFINIDO : daBase.fonte,
      // ⚠ O que o painel existe para mostrar: este campo SAIRIA DIFERENTE se a flag estivesse
      // ligada? É a única maneira de o contador ver o efeito antes de a nota existir.
      mudariaComPerfil: usaPerfil && doPerfil !== daBase.valor,
      valorHoje: daBase.valor,
    };
  }

  // A coerência que a rota do cadastro já exige ao SALVAR, repetida na leitura: código de serviço
  // fora da lista habilitada não pode ser oferecido como "o que vai sair".
  const lista = Array.isArray(company?.codigosServicoNacional) ? company.codigosServicoNacional : [];
  const cTribNac = campos.codigoServicoNacional.valor;
  if (lista.length && cTribNac && !lista.includes(cTribNac)) {
    avisos.push(
      `O código de serviço ${cTribNac} não está entre os habilitados desta empresa `
        + `(${lista.join(", ")}). A emissão seria recusada.`
    );
  }

  return {
    temPerfil: Boolean(escolhido && !ambiguo),
    perfil: escolhido && !ambiguo ? escolhido : null,
    perfisAtivos: perfis.length,
    campos,
    avisos,
  };
}

/**
 * Materializa um perfil a partir do cadastro atual — **sem gravar**.
 *
 * ⚠ É o que a tela oferece como ponto de partida ("criar a partir do que já está configurado"), e é
 * por isso que ele NÃO grava: gravar 34 perfis "derivados" num backfill criaria configuração que
 * ninguém afirmou. Quem grava é o contador, clicando, e aí `origem` vira o que ele fez.
 */
export function perfilDerivadoDoCadastro(company) {
  const base = doCadastro(company);
  const out = { origem: "DERIVADO_DO_CADASTRO" };
  for (const def of CAMPOS) out[def.id] = base[def.id].valor;
  return out;
}

export { campoPorId };
