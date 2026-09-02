// PERFIS DE EMISSÃO DE NFS-e — a porta do contador.
//
// ⚠⚠ ESTA ROTA NÃO EMITE NADA E NÃO MUDA XML NENHUM NESTA FASE. Com
// `INTEGRACAO_PERFIL_EMISSAO_NFSE` desligada — que é como ela nasce — `buildDpsXml` não consulta o
// perfil. O que o `GET` entrega é o **painel**: o que a próxima DPS daquela empresa vai levar,
// campo a campo, e de ONDE cada valor sai (`PERFIL` · `COMPANY` · `CRAVADO` · `INDEFINIDO`).
//
// Isso já vale sozinho: hoje `regApTribSN` e `tribISSQN` são CONSTANTES dentro do gerador, e
// constante em código é invisível até a nota sair. O contador nunca teve como ver o que a empresa
// dele emite antes de emitir.
//
// ⚠ A LISTA DE CAMPOS É UMA SÓ (`application/nfse/perfilEmissao/campos.js`) e é ela que a rota
// aceita, o resolvedor resolve e a tela desenha. Escrever a lista aqui de novo é como as cópias
// divergem — e o precedente está medido: `perfilAtividades` tem 3 campos sem leitor.

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  IDS,
  CAMPOS,
  conferirForma,
} from "../../application/nfse/perfilEmissao/campos.js";
import {
  resolverPerfilDeEmissao,
  perfilDerivadoDoCadastro,
} from "../../application/nfse/perfilEmissao/resolverPerfilDeEmissao.js";
import { INTEGRACAO_PERFIL_EMISSAO_NFSE } from "../../config.js";

/** O que a rota aceita — os seis campos fiscais mais os de identidade/forma. */
const CAMPOS_DE_IDENTIDADE = ["nome", "ativo", "padrao", "habilitaObra", "habilitaExportacao"];
const CAMPOS_ACEITOS = [...IDS, ...CAMPOS_DE_IDENTIDADE];

export function createPerfisEmissaoRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  const bad = (res, status, error, message, extra = {}) =>
    res.status(status).json({ ok: false, error, message, ...extra });

  /**
   * ⚠ CAMPO DE FORA É RECUSADO, NOMEANDO-O — nunca ignorado em silêncio. Aceitar e descartar é o
   * defeito que esta base já pagou: `codigoServicoNacional` chegava no corpo, passava pelo Zod e
   * morria na lista de colunas — 200 na resposta, campo vazio na recarga. Mesmo desenho de
   * `CAMPOS_EMISSAO_NFSE`.
   */
  function recusarIntrusos(body, res) {
    const intrusos = Object.keys(body).filter((k) => !CAMPOS_ACEITOS.includes(k));
    if (!intrusos.length) return false;
    bad(res, 400, "campos_nao_aceitos",
      `Esta rota salva apenas o perfil de emissão (${CAMPOS_ACEITOS.join(", ")}). `
        + `Recebeu também: ${intrusos.join(", ")}.`,
      { campos: intrusos });
    return true;
  }

  /**
   * Normaliza o corpo, conferindo a FORMA de cada campo contra `campos.js`.
   *
   * ⚠⚠ `undefined` = NÃO MEXER · `null`/`""` = APAGAR. É a regra do commit `11187501`, e sem ela um
   * `data` montado com os seis campos apagaria, a cada salvar, tudo que a tela não enviasse.
   */
  function normalizar(body) {
    const data = {};
    const erros = [];

    for (const id of IDS) {
      if (!Object.prototype.hasOwnProperty.call(body, id)) continue;
      const r = conferirForma(id, body[id]);
      if (!r.ok) { erros.push({ campo: id, motivo: r.motivo }); continue; }
      data[id] = r.valor;
    }

    if (Object.prototype.hasOwnProperty.call(body, "nome")) {
      const nome = String(body.nome ?? "").trim();
      // ⚠ O nome é o que o CLIENTE vê no seletor. Vazio ali seria uma opção sem rótulo.
      if (!nome) erros.push({ campo: "nome", motivo: "O nome do perfil é obrigatório — é ele que o cliente vê." });
      else if (nome.length > 60) erros.push({ campo: "nome", motivo: "O nome do perfil tem no máximo 60 caracteres." });
      else data.nome = nome;
    }

    // ⚠ `retencaoFederalArt30` entra aqui apesar de ser campo FISCAL (está em `CAMPOS`, com leitor
    // e tag): a lista abaixo é sobre o TIPO da coluna, não sobre a natureza do campo. Sem ela, o
    // booleano chegaria ao Prisma como a string "false", que é truthy.
    for (const b of ["ativo", "padrao", "habilitaObra", "habilitaExportacao", "retencaoFederalArt30"]) {
      if (!Object.prototype.hasOwnProperty.call(body, b)) continue;
      // ⚠ `Boolean("false")` é `true`. A comparação é com o literal, como em `portaoEmissao.js`.
      if (typeof body[b] !== "boolean") {
        erros.push({ campo: b, motivo: `${b} precisa ser true ou false.` });
        continue;
      }
      data[b] = body[b];
    }

    return { data, erros };
  }

  /** Resolve o `PortalClient` e a `Company` legada — as duas são necessárias. */
  async function carregarEmpresa(portalClientId, res) {
    const portal = await prisma.portalClient
      .findUnique({ where: { id: portalClientId }, select: { id: true, companyId: true } })
      .catch(() => null);
    if (!portal?.id) { bad(res, 404, "portal_company_not_found", "Empresa não encontrada."); return null; }
    // ⚠ SEM LINHA LEGADA NÃO HÁ CADASTRO DE ONDE DERIVAR, e a resposta DIZ ISSO. Responder 200 aqui
    // deixaria o contador configurando um perfil que nunca teria contra o que ser comparado.
    if (!portal.companyId) {
      bad(res, 409, "company_legada_ausente",
        "Esta empresa não tem cadastro legado (Company) — não há configuração de emissão de onde "
          + "derivar o perfil. Salve o cadastro da empresa antes.");
      return null;
    }
    const company = await prisma.company
      .findUnique({
        where: { id: portal.companyId },
        select: {
          codigoServicoNacional: true,
          codigosServicoNacional: true,
          codigoServicoMunicipal: true,
          regimeEspecialTributacao: true,
        },
      })
      .catch(() => null);
    return { portal, company };
  }

  /**
   * ⚠ A AUTORIDADE DO CÓDIGO DE SERVIÇO CONTINUA SENDO O CADASTRO.
   *
   * `escolherCodigoServicoNacional` já recusa, na emissão, código fora de
   * `Company.codigosServicoNacional`. Se o perfil pudesse gravar um código de fora, a tela ofereceria
   * o que o servidor recusa — e o contador descobriria na nota recusada.
   *
   * ⚠ LISTA VAZIA NÃO É "PODE TUDO": é o estado de 33 de 33 empresas hoje, e nele vale o singular do
   * cadastro. Recusar tudo aqui pararia a carteira inteira.
   */
  function conferirCodigoContraCadastro(codigo, company) {
    const lista = Array.isArray(company?.codigosServicoNacional) ? company.codigosServicoNacional : [];
    if (!codigo || !lista.length || lista.includes(codigo)) return null;
    return {
      campo: "codigoServicoNacional",
      motivo:
        `O código ${codigo} não está entre os habilitados desta empresa (${lista.join(", ")}). `
        + "Habilite-o na configuração de emissão da empresa antes de usá-lo num perfil.",
    };
  }

  /**
   * ⚠ O PADRÃO É EXCLUSIVO. Dois perfis marcados como padrão fariam a escolha depender da
   * ordenação — o resolvedor pega `padrao: desc` e o primeiro venceria em silêncio.
   */
  async function desmarcarOutrosPadrao(tx, portalClientId, exceto) {
    await tx.perfilEmissaoNfse.updateMany({
      where: { portalClientId, padrao: true, ...(exceto ? { id: { not: exceto } } : {}) },
      data: { padrao: false },
    });
  }

  // ─── GET: a lista, e o que a próxima DPS vai levar ─────────────────────────────────────────
  router.get(
    "/perfis-emissao",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();
      try {
        const ctx = await carregarEmpresa(portalClientId, res);
        if (!ctx) return undefined;

        let perfis = [];
        try {
          perfis = await prisma.perfilEmissaoNfse.findMany({
            where: { portalClientId },
            orderBy: [{ ativo: "desc" }, { padrao: "desc" }, { nome: "asc" }],
          });
        } catch (err) {
          // ⚠ Migration não aplicada não pode derrubar a tela. Ela AVISA, e continua servindo o
          // painel a partir do cadastro — que é a resposta honesta: "não há perfil nenhum ainda".
          log?.warn?.({ err: err?.message, portalClientId }, "perfis de emissão: tabela indisponível");
        }

        const resolvido = await resolverPerfilDeEmissao({ portalClientId });

        return res.json({
          ok: true,
          // ⚠⚠ A FLAG VIAJA, e é ela que a tela usa para NÃO prometer efeito que não existe. Com
          // ela desligada o painel é informativo: diz o que MUDARIA, não o que muda.
          integracaoLigada: INTEGRACAO_PERFIL_EMISSAO_NFSE,
          perfis,
          // O ponto de partida que a tela oferece — calculado, nunca gravado.
          derivadoDoCadastro: perfilDerivadoDoCadastro(ctx.company),
          // O de-para campo a campo: rótulo, tag, caminho no XML, valor, procedência.
          proximaDps: resolvido,
          campos: CAMPOS.map(({ id, rotulo, tag, caminhoNoXml, valores, formaDescrita, obrigatorio, cravadoHoje }) =>
            ({ id, rotulo, tag, caminhoNoXml, valores: valores || null, formaDescrita, obrigatorio, cravadoHoje: cravadoHoje === true })),
        });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId }, "Falha ao ler perfis de emissão");
        return bad(res, 500, "perfis_fetch_failed", err?.message || "Erro");
      }
    }
  );

  // ─── POST: cria ────────────────────────────────────────────────────────────────────────────
  router.post(
    "/perfis-emissao",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      if (recusarIntrusos(body, res)) return undefined;

      const { data, erros } = normalizar(body);
      if (!data.nome) erros.push({ campo: "nome", motivo: "O nome do perfil é obrigatório." });
      if (!data.codigoServicoNacional) {
        erros.push({
          campo: "codigoServicoNacional",
          motivo: "O código de tributação nacional é obrigatório — é ele que a DPS leva.",
        });
      }

      try {
        const ctx = await carregarEmpresa(portalClientId, res);
        if (!ctx) return undefined;

        const conflito = conferirCodigoContraCadastro(data.codigoServicoNacional, ctx.company);
        if (conflito) erros.push(conflito);
        if (erros.length) {
          return bad(res, 400, "perfil_invalido",
            "O perfil não pôde ser salvo — confira os campos apontados.", { erros });
        }

        const criado = await prisma.$transaction(async (tx) => {
          if (data.padrao === true) await desmarcarOutrosPadrao(tx, portalClientId, null);
          return tx.perfilEmissaoNfse.create({
            data: {
              ...data,
              portalClientId,
              // ⚠ Quem cria pela porta do contador é MANUAL — a procedência é o que distingue
              // "o sistema montou a partir do que já existia" de "alguém afirmou isto".
              origem: "MANUAL",
              createdByUserId: req.auth?.user?.id || null,
            },
          });
        });

        return res.status(201).json({ ok: true, perfil: criado });
      } catch (err) {
        if (err?.code === "P2002") {
          return bad(res, 409, "perfil_nome_duplicado",
            "Já existe um perfil com esse nome nesta empresa. O nome é o que o cliente vê no "
              + "seletor — dois iguais ofereceriam a mesma coisa duas vezes.");
        }
        if (err?.code === "P2021") {
          return bad(res, 503, "perfil_tabela_indisponivel",
            "A tabela de perfis ainda não existe neste banco (migration não aplicada).");
        }
        log?.warn?.({ err: err?.message, portalClientId }, "Falha ao criar perfil de emissão");
        return bad(res, 500, "perfil_create_failed", err?.message || "Erro");
      }
    }
  );

  // ─── PATCH: altera ─────────────────────────────────────────────────────────────────────────
  router.patch(
    "/perfis-emissao/:perfilId",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();
      const perfilId = String(req.params.perfilId || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      if (recusarIntrusos(body, res)) return undefined;

      const { data, erros } = normalizar(body);
      if (!Object.keys(data).length && !erros.length) {
        return bad(res, 400, "nenhum_campo", "Nenhum campo do perfil veio no corpo — não há o que salvar.");
      }

      try {
        const ctx = await carregarEmpresa(portalClientId, res);
        if (!ctx) return undefined;

        // ⚠⚠ O ESCOPO VAI NO `where`, NUNCA SÓ O id. Escolher o alvo pelo id deixaria um perfil de
        // OUTRA empresa cair dentro do acesso deste chamador — o furo de multi-tenancy que a F1 do
        // WhatsApp já pagou em `salvarContato`/`removerContato`.
        const atual = await prisma.perfilEmissaoNfse
          .findFirst({ where: { id: perfilId, portalClientId } })
          .catch(() => null);
        if (!atual) return bad(res, 404, "perfil_nao_encontrado", "Perfil não encontrado nesta empresa.");

        const codigoFinal = Object.prototype.hasOwnProperty.call(data, "codigoServicoNacional")
          ? data.codigoServicoNacional
          : atual.codigoServicoNacional;
        if (Object.prototype.hasOwnProperty.call(data, "codigoServicoNacional") && !codigoFinal) {
          erros.push({
            campo: "codigoServicoNacional",
            motivo: "O código de tributação nacional não pode ficar vazio — é ele que a DPS leva.",
          });
        }
        const conflito = conferirCodigoContraCadastro(codigoFinal, ctx.company);
        if (conflito) erros.push(conflito);
        if (erros.length) {
          return bad(res, 400, "perfil_invalido",
            "O perfil não pôde ser salvo — confira os campos apontados.", { erros });
        }

        const atualizado = await prisma.$transaction(async (tx) => {
          if (data.padrao === true) await desmarcarOutrosPadrao(tx, portalClientId, perfilId);
          return tx.perfilEmissaoNfse.update({
            where: { id: perfilId },
            // ⚠ Editar pela porta do contador torna o perfil MANUAL, ainda que ele tenha nascido
            // derivado: a partir daí alguém afirmou aqueles valores.
            data: { ...data, origem: "MANUAL" },
          });
        });

        return res.json({ ok: true, perfil: atualizado });
      } catch (err) {
        if (err?.code === "P2002") {
          return bad(res, 409, "perfil_nome_duplicado",
            "Já existe um perfil com esse nome nesta empresa.");
        }
        log?.warn?.({ err: err?.message, portalClientId, perfilId }, "Falha ao salvar perfil de emissão");
        return bad(res, 500, "perfil_update_failed", err?.message || "Erro");
      }
    }
  );

  return router;
}
