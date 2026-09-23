import { prisma } from "../../infrastructure/db/prisma.js";
import { OnboardingError } from "./OnboardingService.js";
import { preencherTexto, catalogoValido } from "./CatalogoComercial.js";
import { RECURSOS_INICIAIS } from "./MensagensPadrao.js";
import { CAMPOS_CONTRATO } from "../../../../../packages/shared/src/onboarding/contratoComercialCampos.js";
import { validarPadroesContrato } from "./ContratoComercialCampos.js";
import { configuracaoModeloContratoValida } from "../../../../../packages/shared/src/onboarding/modeloContrato.js";
export const variaveisPermitidas = CAMPOS_CONTRATO.map(c => c.chave);
export function exigirGestor(user) {
  if (!user?.id || !["admin", "contador"].includes(String(user.role).toLowerCase())) throw new OnboardingError("forbidden", "Ação reservada ao contador.", 403);
}
const objeto = v => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const chavesPermitidas = (v, permitidas) => Object.keys(v).every(k => permitidas.includes(k));
const canonico = v => JSON.stringify(v, function (chave, valor) {
  return objeto(valor) ? Object.fromEntries(Object.keys(valor).sort().map(k => [k, valor[k]])) : valor;
});
const conteudoDoRecurso = r => ({ tipo: r.tipo, chave: r.chave, versao: r.versao, titulo: r.titulo, texto: r.texto || "", dados: r.dados || {} });

/** Formato de transporte privado. Não aceita autor, aprovação, IDs nem instruções de execução. */
export function validarImportacaoRecursos(payload) {
  if (!objeto(payload) || !chavesPermitidas(payload, ["formatVersion", "resources"]) || payload.formatVersion !== 1 || !Array.isArray(payload.resources) || payload.resources.length < 1 || payload.resources.length > 100) {
    throw new OnboardingError("importacao_invalida", "Use formatVersion 1 e de 1 a 100 recursos.");
  }
  const vistos = new Set();
  return payload.resources.map(r => {
    if (!objeto(r) || !chavesPermitidas(r, ["tipo", "chave", "versao", "titulo", "texto", "dados"]) || !["ORIENTACAO", "CATALOGO", "CONTRATO", "INSTITUCIONAL"].includes(r.tipo)
      || !/^[a-z][a-z0-9_-]{1,60}$/.test(r.chave || "") || !Number.isSafeInteger(r.versao) || r.versao < 1 || r.versao > 2147483647
      || typeof r.titulo !== "string" || !r.titulo.trim() || r.titulo.length > 300 || (r.texto != null && typeof r.texto !== "string")
      || (r.texto || "").length > 60000 || (r.dados != null && !objeto(r.dados)) || JSON.stringify(r.dados || {}).length > 60000) {
      throw new OnboardingError("recurso_importado_invalido", "Confira o formato, versão e limites dos recursos. Aprovação não é aceita na importação.");
    }
    const key = `${r.tipo}:${r.chave}:${r.versao}`;
    if (vistos.has(key)) throw new OnboardingError("recurso_duplicado", "O arquivo repete a mesma versão de um recurso.");
    vistos.add(key);
    return conteudoDoRecurso({ ...r, titulo: r.titulo.trim() });
  });
}
export function criarRecursosComerciais({
  db = prisma
} = {}) {
  async function importarRascunhos(payload, atorId, { aplicar = false } = {}) {
    const recursos = validarImportacaoRecursos(payload);
    if (typeof aplicar !== "boolean") throw new OnboardingError("modo_importacao_invalido", "A gravação exige aplicar booleano.");
    if (typeof atorId !== "string" || !atorId.trim()) throw new OnboardingError("ator_necessario", "Informe o ID de um gestor existente.", 403);
    // A conta é relida do banco: passar um objeto com role=admin não autoriza a importação.
    const executar = () => db.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: atorId }, select: { id: true, role: true, status: true, accountType: true } });
      exigirGestor(user);
      if (user.status !== "active" || String(user.accountType).toUpperCase() !== "FIRM") throw new OnboardingError("forbidden", "A importação exige um gestor ativo do escritório.", 403);
      const resultado = { modo: aplicar ? "IMPORTACAO" : "PREVIA", atorId: user.id, criados: 0, existentes: 0, previstos: 0, recursos: [] };
      // A ordenação torna um arquivo com várias versões independente da ordem das linhas.
      for (const recurso of [...recursos].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.chave.localeCompare(b.chave) || a.versao - b.versao)) {
        const where = { tipo_chave_versao: { tipo: recurso.tipo, chave: recurso.chave, versao: recurso.versao } };
        const existente = await tx.recursoComercial.findUnique({ where });
        if (existente) {
          if (canonico(conteudoDoRecurso(existente)) !== canonico(recurso)) throw new OnboardingError("versao_divergente", "Uma versão do arquivo já existe com outro conteúdo. Nenhum recurso foi importado.", 409);
          resultado.existentes += 1;
          resultado.recursos.push({ tipo: recurso.tipo, chave: recurso.chave, versao: recurso.versao, estado: existente.aprovadoEm ? "JA_EXISTIA_APROVADO" : "JA_EXISTIA_RASCUNHO" });
          continue;
        }
        if (aplicar) {
          await tx.recursoComercial.create({ data: { ...recurso, aprovadoEm: null, aprovadoPor: null } });
          resultado.criados += 1;
        } else resultado.previstos += 1;
        resultado.recursos.push({ tipo: recurso.tipo, chave: recurso.chave, versao: recurso.versao, estado: aplicar ? "RASCUNHO_CRIADO" : "RASCUNHO_PREVISTO" });
      }
      return resultado;
    }, { isolationLevel: "Serializable" });
    // Uma importação concorrente pode reservar a versão antes desta. Reabrir a transação
    // compara o conteúdo já gravado; jamais troca um recurso nem sua aprovação.
    for (let tentativa = 0; ; tentativa += 1) {
      try { return await executar(); }
      catch (err) {
        if (tentativa < 2 && ["P2034", "P2002"].includes(err.code)) continue;
        throw err;
      }
    }
  }
  async function listar({
    aprovados = false,
    tipo = undefined
  } = {}) {
    return db.recursoComercial.findMany({
      where: {
        ...(aprovados ? {
          aprovadoEm: {
            not: null
          }
        } : {}),
        ...(tipo ? {
          tipo
        } : {})
      },
      orderBy: [{
        chave: "asc"
      }, {
        versao: "desc"
      }],
      take: 200
    });
  }
  async function criar(body, user) {
    exigirGestor(user);
    if (!["ORIENTACAO", "CATALOGO", "CONTRATO", "INSTITUCIONAL"].includes(body.tipo) || !/^[a-z][a-z0-9_-]{1,60}$/.test(body.chave || "") || !body.titulo?.trim() || String(body.texto || "").length > 60000 || JSON.stringify(body.dados || {}).length > 60000) throw new OnboardingError("recurso_invalido", "Confira título, chave e conteúdo.");
    const ultima = await db.recursoComercial.findFirst({
      where: {
        tipo: body.tipo,
        chave: body.chave
      },
      orderBy: {
        versao: "desc"
      }
    });
    try {
      return await db.recursoComercial.create({
        data: {
          tipo: body.tipo,
          chave: body.chave,
          titulo: body.titulo,
          texto: body.texto || "",
          dados: body.dados || {},
          versao: (ultima?.versao || 0) + 1
        }
      });
    } catch (e) {
      if (e.code === "P2002") throw new OnboardingError("versao_concorrente", "Outra versão foi criada. Recarregue.", 409);
      throw e;
    }
  }
  async function aprovar(id, user) {
    exigirGestor(user);
    const r = await db.recursoComercial.findUnique({
      where: {
        id
      }
    });
    if (!r) throw new OnboardingError("recurso_ausente", "Recurso não encontrado.", 404);
    const marcadores = [...r.texto.matchAll(/\{\{(.*?)\}\}/g)].map(m => m[1]);
    if (marcadores.some(k => !variaveisPermitidas.includes(k))) throw new OnboardingError("variavel_invalida", "O texto usa variáveis não permitidas.");
    if (["ORIENTACAO", "CONTRATO"].includes(r.tipo) && !r.texto.trim()) throw new OnboardingError("texto_ausente", "Preencha o texto antes de aprovar.");
    if (r.tipo === "CATALOGO" && !catalogoValido(r.dados)) throw new OnboardingError("catalogo_invalido", "Confira as faixas, valores e condições do catálogo.");
    if (r.tipo === "CONTRATO" && (/\[[^\]]+\]/.test(r.texto) || r.texto.includes("MINUTA PARA VALIDAÇÃO"))) throw new OnboardingError("modelo_pendente", "Revise a minuta de referência e substitua todos os marcadores antes da aprovação.");
    if (r.tipo === "CONTRATO" && !validarPadroesContrato(r)) throw new OnboardingError("padroes_contrato_invalidos", "Confira os campos padrão do contrato. Honorários e escopo vêm da proposta aceita.");
    if (r.tipo === "CONTRATO" && !configuracaoModeloContratoValida(r.dados)) throw new OnboardingError("modelo_configuracao_invalida", "Confira modalidade, origens e identificação PF/PJ do modelo.");
    if (r.tipo === "INSTITUCIONAL" && (!/^\d{14}$/.test(r.dados.procuradorCnpj || "") || !String(r.dados.linkAutorizacao || "").startsWith("https://"))) throw new OnboardingError("institucional_incompleto", "Confirme CNPJ do procurador e link HTTPS das instruções.");
    if (r.aprovadoEm) return r;
    return db.recursoComercial.update({
      where: {
        id
      },
      data: {
        aprovadoEm: new Date(),
        aprovadoPor: user.id
      }
    });
  }
  async function prepararOrientacao(id, variaveis = {}) {
    const r = await db.recursoComercial.findUnique({
      where: {
        id
      }
    });
    if (r?.tipo !== "ORIENTACAO" || !r.aprovadoEm) throw new OnboardingError("orientacao_nao_aprovada", "Selecione uma orientação aprovada.", 409);
    const institucional = await db.recursoComercial.findFirst({
      where: {
        tipo: "INSTITUCIONAL",
        chave: "escritorio",
        aprovadoEm: {
          not: null
        }
      },
      orderBy: {
        versao: "desc"
      }
    });
    // Identificadores e links institucionais vêm exclusivamente da configuração aprovada.
    const permitidas = Object.fromEntries(Object.entries(variaveis).filter(([k]) => ["nome", "cnpj", "servico"].includes(k)));
    try {
      return {
        texto: preencherTexto(r.texto, {
          ...permitidas,
          ...(institucional?.dados || {})
        }),
        referencia: {
          tipo: "ORIENTACAO",
          recursoId: r.id,
          chave: r.chave,
          versao: r.versao
        }
      };
    } catch (e) {
      throw new OnboardingError(e.code || "variaveis_ausentes", e.message, e.status || 409);
    }
  }
  async function excluirRascunho(id, versao, user) {
    exigirGestor(user);
    if (typeof id !== "string" || !id.trim() || id.length > 200) throw new OnboardingError("recurso_necessario", "Selecione o rascunho que deseja excluir.", 400);
    if (!Number.isSafeInteger(versao) || versao < 1 || versao > 2147483647) throw new OnboardingError("versao_necessaria", "Recarregue a biblioteca antes de excluir o rascunho.", 409);
    // Uma aprovação concorrente torna o registro inelegível no próprio DELETE.
    // Nenhuma versão publicada pode desaparecer junto do rascunho escolhido.
    const resultado = await db.recursoComercial.deleteMany({ where: { id, versao, aprovadoEm: null } });
    if (resultado.count !== 1) throw new OnboardingError("rascunho_indisponivel", "Este rascunho mudou, já foi excluído ou foi aprovado. Atualize a biblioteca.", 409);
    return { excluido: true };
  }
  async function iniciarBiblioteca(user) {
    exigirGestor(user);
    // Catálogo de preços e modelos contratuais são configurações privadas. A biblioteca
    // pública inicia apenas orientações genéricas; importar recursos nunca os aprova.
    const iniciais = RECURSOS_INICIAIS;
    for (const item of iniciais) {
      await db.recursoComercial.upsert({
        where: {
          tipo_chave_versao: {
            tipo: item.tipo,
            chave: item.chave,
            versao: 1
          }
        },
        create: {
          ...item,
          versao: 1
        },
        update: {}
      });
    }
    return listar();
  }
  return {
    listar,
    criar,
    aprovar,
    prepararOrientacao,
    iniciarBiblioteca,
    importarRascunhos,
    excluirRascunho
  };
}
