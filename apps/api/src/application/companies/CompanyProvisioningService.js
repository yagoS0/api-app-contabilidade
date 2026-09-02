// Provisionamento de empresa — o ÚNICO ato que traz uma empresa para dentro do portal.
//
// Este corpo morava inteiro dentro de `POST /firm/companies` (routes/firm/index.js). Agora há duas
// portas para o mesmo ato — o botão "Nova empresa" e a conversão de um onboarding — e duas cópias
// dele divergiriam em silêncio: a segunda esqueceria o `CompanyFirmAccess`, ou o plano de contas,
// ou a Client legada, e a empresa nasceria pela metade sem ninguém perceber.
//
// ⚠ Este módulo NÃO conhece `req` nem `res`. O que ele precisa do request (o id de quem chamou, a
// lista de empresas visíveis) chega como argumento. `empresasVisiveis(req)` fica na rota.
//
// Regressão coberta por `routes/firm/__tests__/companyProvisioning.caracterizacao.test.js`, escrito
// contra o comportamento ANTERIOR à extração e não editado depois dela.

import bcrypt from "bcryptjs";
import { prisma } from "../../infrastructure/db/prisma.js";
import {
  enderecoToSingleLine,
  validateAndNormalizeCompanyProfile,
} from "../company/companyProfile.js";
import {
  companyCreateSchema,
  validateCompanyInput,
} from "../validators/companySchemas.js";
import { getGlobalChartStatus } from "../accounting/globalChartStatus.js";
import { aplicarRegrasAEmpresaNova } from "../obrigacoes/RegrasObrigacaoService.js";
import { ROTINA_KEYS } from "../fiscal/serpro/SerproRuntimeSettings.js";
import {
  rotinasPadraoPorRegime,
  saveCompanyRotinas,
} from "../fiscal/serpro/CompanyRotinasService.js";

/**
 * Erro de provisionamento com resposta HTTP pronta. A rota só repassa `status` e `body` — assim as
 * duas portas devolvem exatamente a mesma mensagem para a mesma causa.
 */
export class CompanyProvisioningError extends Error {
  constructor(code, { status = 400, body = null, message = null } = {}) {
    super(message || code);
    this.name = "CompanyProvisioningError";
    this.code = code;
    this.status = status;
    this.body = body || { error: code };
  }
}

/**
 * Valida, normaliza e cria os SEIS registros da empresa numa transação:
 * User (dono) · Client legado · Company legada · PortalClient · CompanyClientUser · CompanyFirmAccess.
 *
 * @param {object} args
 * @param {object} args.body        payload de `POST /firm/companies` (aninhado ou achatado)
 * @param {string} args.actorUserId id do usuário do ESCRITÓRIO que está criando
 * @param {object} [args.log]
 * @returns {Promise<{portalId, companyId, ownerUserId, regime, cnpj, razaoSocial}>}
 *   ⚠ Só os quatro primeiros campos do retorno vão para a resposta HTTP — `regime`/`cnpj`/`razaoSocial`
 *   existem para o PÓS-criação e para o registro do onboarding, e a rota os escolhe explicitamente
 *   (espalhar o retorno inteiro no `res.json` mudaria o contrato do endpoint sem ninguém notar).
 */
export async function provisionarEmpresa({ body, actorUserId, log = null } = {}) {
  const payload = body || {};

  // ⚠ Sem o id de quem chamou o `companyFirmAccess.upsert` gravaria um vínculo órfão
  // (`userId: "undefined"`), e a empresa nasceria invisível para o escritório inteiro. Lançar é a
  // única saída correta: não há default seguro para "quem é o dono deste cadastro".
  const actor = String(actorUserId || "").trim();
  if (!actor) {
    throw new CompanyProvisioningError("actor_user_id_required", {
      status: 500,
      body: { error: "actor_user_id_required" },
      message: "provisionarEmpresa exige actorUserId (vínculo CompanyFirmAccess ficaria órfão).",
    });
  }

  // Q8.A.4: validação rigorosa via Zod ANTES da lógica de negócio.
  // Roda em paralelo com a normalização legada — Zod rejeita formatos ruins (CNPJ inválido,
  // senha fraca, email inválido) antes do código alcançar Prisma.
  const zodResult = validateCompanyInput(companyCreateSchema, payload);
  if (!zodResult.ok) {
    throw new CompanyProvisioningError("validation_failed", {
      status: zodResult.status,
      body: zodResult.body,
    });
  }

  const ownerEmail = String(payload.ownerEmail || "")
    .trim()
    .toLowerCase();
  const ownerName = payload.ownerName ? String(payload.ownerName).trim() : null;
  const ownerPassword = String(payload.ownerPassword || "").trim();
  const companyInput = payload.company && typeof payload.company === "object" ? payload.company : payload;
  const parsedCompany = validateAndNormalizeCompanyProfile(companyInput);
  if (!parsedCompany.ok) {
    throw new CompanyProvisioningError(parsedCompany.error, {
      status: 400,
      // ⚠ O `details` viaja tambem na CRIACAO — mesmo motivo do PATCH: ele nomeia os campos
      //   do endereco que faltam, e sem ele a tela so pode dizer "endereco incompleto".
      body: {
        error: parsedCompany.error,
        ...(parsedCompany.details ? { details: parsedCompany.details } : {}),
      },
    });
  }
  const normalizedCompany = parsedCompany.data;
  const cnpj = normalizedCompany.cnpj;
  const razao = normalizedCompany.razaoSocial;
  const inscricaoMunicipalInput = String(companyInput.inscricaoMunicipal || "").trim() || null;

  if (!ownerEmail) {
    throw new CompanyProvisioningError("owner_email_required", { status: 400 });
  }

  // Plano de contas global é PRÉ-REQUISITO para criar empresas.
  // Lançamentos automáticos (DAS, faturamento, etc) dependem de um plano mínimo.
  //
  // ⚠ A falha da CHECAGEM (não a falta do plano) não bloqueia: o comportamento original seguia o
  // fluxo com um warn, e mudá-lo aqui derrubaria cadastro legítimo por problema de leitura.
  let globalStatus = null;
  try {
    globalStatus = await getGlobalChartStatus();
  } catch (chartErr) {
    log?.warn?.({ err: chartErr }, "Falha ao verificar plano global (seguindo o fluxo)");
    globalStatus = null;
  }
  if (globalStatus && !globalStatus.isConfigured) {
    throw new CompanyProvisioningError("global_chart_of_accounts_not_configured", {
      status: 400,
      body: {
        ok: false,
        error: "global_chart_of_accounts_not_configured",
        message: `Configure o plano de contas global antes de criar empresas. Faltam contas dos tipos: ${globalStatus.tiposFaltantes.join(", ")}.`,
        missingTipos: globalStatus.tiposFaltantes,
      },
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      let ownerUser = await tx.user.findUnique({ where: { email: ownerEmail } });
      if (!ownerUser) {
        if (!ownerPassword || ownerPassword.length < 8) {
          const err = new Error("owner_password_required_min_8");
          err.code = "OWNER_PASSWORD_REQUIRED";
          throw err;
        }
        ownerUser = await tx.user.create({
          data: {
            email: ownerEmail,
            name: ownerName,
            passwordHash: await bcrypt.hash(ownerPassword, 10),
            role: "user",
            status: "active",
            accountType: "CLIENT",
          },
        });
      }

      let legacyClient = await tx.client.findUnique({ where: { email: ownerEmail } });
      if (!legacyClient) {
        const login = ownerEmail;
        legacyClient = await tx.client.create({
          data: {
            name: ownerName || ownerEmail,
            email: ownerEmail,
            login,
            passwordHash: ownerPassword
              ? await bcrypt.hash(ownerPassword, 10)
              : await bcrypt.hash(`tmp-${Date.now()}`, 10),
          },
        });
      }

      const legacyCompany = await tx.company.create({
        data: {
          clientId: legacyClient.id,
          cnpj,
          razaoSocial: razao,
          nomeFantasia: normalizedCompany.nomeFantasia,
          email: normalizedCompany.email || null,
          telefone: normalizedCompany.telefone,
          endereco: enderecoToSingleLine(normalizedCompany.endereco),
          enderecoJson: normalizedCompany.endereco,
          atividades: [
            normalizedCompany.cnaePrincipal,
            ...normalizedCompany.cnaesSecundarios,
          ],
          tipoTributario: normalizedCompany.regimeTributario,
          regimeTributario: normalizedCompany.regimeTributario,
          anexoSimples: normalizedCompany.simples?.anexo || null,
          simplesAnexo: normalizedCompany.simples?.anexo || null,
          simplesDataOpcao: normalizedCompany.simples?.dataOpcao || null,
          cnaePrincipal: normalizedCompany.cnaePrincipal,
          cnaesSecundarios: normalizedCompany.cnaesSecundarios,
          inscricaoMunicipal: inscricaoMunicipalInput ?? normalizedCompany.inscricaoMunicipal,
          // Município EMISSOR da NFS-e (`cLocEmi`). ⚠ Nasce do que foi ESCOLHIDO no formulário e de
          // mais nada: a BrasilAPI devolve o município como texto, e converter esse texto em código
          // erraria em homônimo. Empresa criada sem ele simplesmente não emite até alguém escolher.
          codigoMunicipioIbge: normalizedCompany.codigoMunicipioIbge,
          // Configuração da emissão de NFS-e. ⚠ Mesma regra do município: **nada é derivado**. Nem
          // o CNAE nem a atividade da BrasilAPI viram código de serviço — a lista da LC 116 e a do
          // município não existem neste repositório, e inventá-las é o que a regra 1 proíbe.
          // Empresa criada sem eles não emite, e o cadastro diz isso antes de alguém tentar.
          codigoServicoNacional: normalizedCompany.codigoServicoNacional,
          // A LISTA de códigos (o dono pode cadastrar N atividades). No `create` o `undefined` cai
          // no default do schema (`[]`), então o spread condicional não é necessário aqui — mas o
          // campo precisa estar na lista, senão o que o formulário escolheu na CRIAÇÃO da empresa
          // é descartado em silêncio, e o contador reabre o cadastro achando que não salvou.
          codigosServicoNacional: normalizedCompany.codigosServicoNacional,
          codigoServicoMunicipal: normalizedCompany.codigoServicoMunicipal,
          rpsSerie: normalizedCompany.rpsSerie,
          // ⚠ CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012), do formulário de criação. Mesma
          // regra de tudo o que está acima: **nada é derivado**. Não há de-para CNAE→presunção
          // neste repositório, e o número vai IMPRESSO ao tomador — quem o informa é o contador.
          // No `create` o `undefined` vira NULL, que é o estado certo para empresa nova: a
          // emissão do não optante RECUSA com motivo, em vez de declarar 0,00.
          pTotTribFed: normalizedCompany.pTotTribFed,
          pTotTribEst: normalizedCompany.pTotTribEst,
          pTotTribMun: normalizedCompany.pTotTribMun,
          // ⚠ BENEFÍCIO MUNICIPAL DO ISSQN — mesma regra: **nada é derivado**. O número é do
          // MUNICÍPIO, não há lista neste repositório e não se deduz do CNAE. No `create` o
          // `undefined` vira NULL, que é o estado certo para empresa nova: sem benefício
          // declarado, a nota sai com o imposto cheio, que é o desfecho seguro.
          beneficioMunicipalNumero: normalizedCompany.beneficioMunicipalNumero,
          beneficioMunicipalTipoReducao: normalizedCompany.beneficioMunicipalTipoReducao,
          beneficioMunicipalPRedBC: normalizedCompany.beneficioMunicipalPRedBC,
          // ── Ficha de cadastro (muito disso já vem preenchido da BrasilAPI) ──
          inscricaoMunicipalData: normalizedCompany.inscricaoMunicipalData,
          inscricaoEstadual: normalizedCompany.inscricaoEstadual,
          inscricaoEstadualData: normalizedCompany.inscricaoEstadualData,
          porte: normalizedCompany.porte,
          naturezaJuridica: normalizedCompany.naturezaJuridica,
          capitalSocial: normalizedCompany.capitalSocial,
          dataAbertura: normalizedCompany.dataAbertura,
          abriuCom: normalizedCompany.abriuCom,
          numeroRegistro: normalizedCompany.numeroRegistro,
          tipoRegistro: normalizedCompany.tipoRegistro,
          diarioNumero: normalizedCompany.diarioNumero,
          desoneracao: normalizedCompany.desoneracao,
          alteracaoNumero: normalizedCompany.alteracaoNumero,
          alteracaoData: normalizedCompany.alteracaoData,
          quantidadeSocios: normalizedCompany.socios
            ? normalizedCompany.socios.filter((s) => !s.dataSaida).length
            : null,
          ...(normalizedCompany.socios?.length
            ? { partners: { create: normalizedCompany.socios } }
            : {}),
          ...(normalizedCompany.regimeHistorico?.length
            ? { regimeHistorico: { create: normalizedCompany.regimeHistorico } }
            : {}),
        },
      });

      const portal = await tx.portalClient.create({
        data: {
          companyId: legacyCompany.id,
          razao,
          cnpj,
          guideNotificationEmail: normalizedCompany.guideNotificationEmail || null,
          hasProlabore: Boolean(payload.hasProlabore),
          temFolha: Boolean(payload.temFolha),
          empresaZerada: Boolean(payload.empresaZerada),
          inscricaoMunicipal: inscricaoMunicipalInput,
          uf: normalizedCompany.endereco?.uf || null,
          municipio: normalizedCompany.endereco?.cidade || null,
        },
      });

      await tx.companyClientUser.upsert({
        where: {
          companyId_userId: {
            companyId: portal.id,
            userId: ownerUser.id,
          },
        },
        create: {
          companyId: portal.id,
          userId: ownerUser.id,
          role: "OWNER",
          status: "ACTIVE",
        },
        update: {
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      await tx.companyFirmAccess.upsert({
        where: {
          companyId_userId: {
            companyId: portal.id,
            userId: actor,
          },
        },
        create: {
          companyId: portal.id,
          userId: actor,
          role: "FIRM_ADMIN",
          status: "ACTIVE",
          scopes: [],
        },
        update: {
          role: "FIRM_ADMIN",
          status: "ACTIVE",
        },
      });

      // ⚠ `companyId` aqui é o id do PORTAL CLIENT, não o da Company legada — os dois existem e são
      // diferentes. Quem guardar este valor achando que é a legada vai errar o certificado A1.
      return {
        portalId: portal.id,
        companyId: portal.id,
        ownerUserId: ownerUser.id,
        regime: normalizedCompany.regimeTributario,
        cnpj,
        razaoSocial: razao,
      };
    });
  } catch (err) {
    throw traduzirErroDeProvisionamento(err);
  }
}

/**
 * Traduz a exceção crua (Prisma / senha ausente) no erro de domínio com resposta HTTP.
 * ⚠ NEM TODA FALHA AQUI É "ERRO INTERNO". As duas de baixo são respostas do banco a um dado do
 * formulário, e têm conserto do lado de quem cadastra — devolvê-las como 500 genérico manda o
 * contador procurar bug onde há só um CNPJ repetido, sem nenhuma pista na tela.
 */
function traduzirErroDeProvisionamento(err) {
  if (err instanceof CompanyProvisioningError) return err;

  if (err?.code === "OWNER_PASSWORD_REQUIRED") {
    return new CompanyProvisioningError("owner_password_required_min_8", { status: 400 });
  }
  if (err?.code === "P2002") {
    const campo = Array.isArray(err?.meta?.target) ? err.meta.target.join(", ") : (err?.meta?.target || "");
    return new CompanyProvisioningError("empresa_ja_cadastrada", {
      status: 409,
      body: {
        error: "empresa_ja_cadastrada",
        message: `Já existe registro com este valor${campo ? ` em: ${campo}` : ""}. `
          + "Se a empresa já está na carteira, edite-a em vez de criar de novo.",
      },
    });
  }
  if (err?.code === "P2003") {
    return new CompanyProvisioningError("referencia_invalida", {
      status: 400,
      body: {
        error: "referencia_invalida",
        message: "Um dos vínculos do cadastro aponta para um registro que não existe.",
      },
    });
  }

  // Desconhecido: preserva a exceção original para a rota logar com stack e código do Prisma.
  const desconhecido = new CompanyProvisioningError("internal_error", {
    status: 500,
    body: { error: "internal_error", code: err?.code || null },
  });
  desconhecido.cause = err;
  return desconhecido;
}

/**
 * Bloco best-effort de PÓS-CRIAÇÃO. Roda FORA da transação de propósito: a empresa JÁ está criada
 * quando chegamos aqui, então uma falha aqui não pode desfazer o cadastro.
 *
 * @param {object}   args
 * @param {string}   args.portalClientId
 * @param {string[]} args.portalIds  empresas visíveis ao chamador (vem de `empresasVisiveis(req)`)
 * @param {string}   args.regime     regime tributário já normalizado (SIMPLES|LUCRO_PRESUMIDO|LUCRO_REAL)
 * @param {object}   [args.log]
 * @returns {Promise<{regrasAplicadas: object|null, rotinasCriadas: object|null}>}
 */
export async function aplicarPosCriacao({ portalClientId, portalIds = [], regime = null, log = null } = {}) {
  // Regras do escritório com "aplicar a novas empresas": a empresa recém-criada já nasce com as
  // obrigações que se encaixam no filtro dela.
  let regrasAplicadas = null;
  try {
    regrasAplicadas = await aplicarRegrasAEmpresaNova({ portalClientId, portalIds });
  } catch (err) {
    log?.warn?.(
      { err: err?.message || err, companyId: portalClientId },
      "Regras de obrigação não aplicadas à empresa nova"
    );
  }

  // Rotinas SERPRO da empresa nova.
  //
  // Antes disto, empresa nova só ganhava `CompanyRotina` quando ALGUÉM abria a página Rotinas e o
  // `seedRotinasFromLegacy` rodava — até lá as linhas não existiam. Semear aqui fecha a lacuna nos
  // dois caminhos de criação de empresa de uma vez.
  //
  // ⚠ `rotinasPadraoPorRegime` devolve um **Set**, e `saveCompanyRotinas` espera um **objeto**
  // (`rotinas[chave] === true`). Passar o Set direto faria o laço pular TODAS as chaves
  // (`rotinas[rotina] === undefined` → `continue`) e a função retornaria "0 atualizadas" sem gravar
  // nada — falha silenciosa. O mapa abaixo cobre as 7 chaves com true/false, exatamente como o
  // `seedRotinasFromLegacy` faz, para que os dois caminhos produzam a mesma linha.
  let rotinasCriadas = null;
  try {
    const padrao = rotinasPadraoPorRegime(String(regime || "").trim().toUpperCase());
    const rotinas = Object.fromEntries(ROTINA_KEYS.map((chave) => [chave, padrao.has(chave)]));
    rotinasCriadas = await saveCompanyRotinas([{ companyId: portalClientId, rotinas }]);
  } catch (err) {
    log?.warn?.(
      { err: err?.message || err, companyId: portalClientId },
      "Rotinas SERPRO não semeadas para a empresa nova"
    );
  }

  return { regrasAplicadas, rotinasCriadas };
}
