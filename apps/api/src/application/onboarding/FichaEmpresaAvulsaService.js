import { prisma } from "../../infrastructure/db/prisma.js";
import { exigirEscopo } from "./ComercialService.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { OnboardingError } from "./OnboardingService.js";
import { exigirContratoAvulsoConcluivel } from "./PoliticaJornadaComercial.js";
import { prepararArquivoConversao, conferirFontesDoArquivo } from "./ArquivoConversaoService.js";
import { validateAndNormalizeCompanyProfile } from "../company/companyProfile.js";
import { GuideStorageService } from "../guides/GuideStorageService.js";

const erro = (code, message) => new OnboardingError(code, message, 409);
const publicacao = ficha => ficha && ({ ...ficha, documentos: (ficha.documentos || []).map(({ fileKey, ...d }) => d), modalidade: "AVULSO", contabilidadeAtiva: false, portalHabilitado: false });
// Cadastro documental próprio. Não chama provisionamento, cria usuário ou dispara workers fiscais.
export function criarFichaEmpresaAvulsa({ db = prisma, storage = new GuideStorageService(), preparar = prepararArquivoConversao } = {}) {
  async function obter(id, user) {
    exigirGestor(user); await exigirEscopo(id, user, db);
    return publicacao(await db.fichaEmpresaAvulsa.findUnique({ where: { onboardingId: id }, include: { documentos: true } }));
  }
  async function salvar(id, user, body = {}) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    if (ficha.origem !== "ABERTURA" || ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(ficha.status)) throw erro("ficha_avulsa_indisponivel", "Use uma abertura avulsa ainda em execução.");
    if (!Number.isInteger(body.versao) || body.versao !== ficha.versao) throw erro("formulario_alterado", "A ficha mudou. Recarregue antes de salvar.");
    const perfil = validateAndNormalizeCompanyProfile(body.dados);
    if (!perfil.ok) throw new OnboardingError("cadastro_avulso_incompleto", "Confira CNPJ definitivo, razão social, atividade, regime e endereço da empresa aberta.", 400, { campo: perfil.error });
    const dados = JSON.parse(JSON.stringify(perfil.data));
    const contrato = await exigirContratoAvulsoConcluivel(db, id);
    const arquivo = await preparar({ db, onboardingId: id, proposta: contrato.proposta, contrato, storage });
    return db.$transaction(async tx => {
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { versao: { increment: 1 } } });
      if (!reserva.count) throw erro("formulario_alterado", "O atendimento mudou durante o arquivamento.");
      const atual = await exigirContratoAvulsoConcluivel(tx, id);
      if (atual.id !== contrato.id) throw erro("contrato_alterado", "A contratação mudou durante o arquivamento.");
      await conferirFontesDoArquivo(tx, id, arquivo);
      const anterior = await tx.fichaEmpresaAvulsa.findUnique({ where: { onboardingId: id } });
      if (anterior && anterior.cnpj !== dados.cnpj) throw erro("cnpj_alterado", "O CNPJ da ficha arquivada mudou. Abra uma nova solicitação para outra empresa.");
      const salva = await tx.fichaEmpresaAvulsa.upsert({ where: { onboardingId: id }, create: { onboardingId: id, cnpj: dados.cnpj, dados, criadoPor: user.id }, update: { dados, versao: { increment: 1 } } });
      for (const d of arquivo.documentos) await tx.documentoFichaAvulsa.upsert({ where: { id: `avulso-${d.id}` }, create: { id: `avulso-${d.id}`, fichaId: salva.id, nome: d.nome, mimeType: d.mimeType, fileKey: d.fileKey, bytes: d.bytes, createdAt: d.createdAt }, update: {} });
      await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "FICHA_EMPRESA_AVULSA_CONFERIDA", atorId: user.id, dados: { fichaId: salva.id, cnpj: dados.cnpj, versao: salva.versao, contratoId: contrato.id, documentos: arquivo.documentos.map(d => `avulso-${d.id}`), contabilidadeAtiva: false } } });
      return publicacao(await tx.fichaEmpresaAvulsa.findUnique({ where: { onboardingId: id }, include: { documentos: true } }));
    });
  }
  async function documento(id, documentoId, user) {
    exigirGestor(user); await exigirEscopo(id, user, db);
    const d = await db.documentoFichaAvulsa.findFirst({ where: { id: documentoId, ficha: { onboardingId: id } } });
    if (!d) throw new OnboardingError("documento_ausente", "Documento não encontrado nesta ficha.", 404);
    return { nome: d.nome, mimeType: d.mimeType, buffer: await storage.downloadBuffer({ key: d.fileKey }) };
  }
  return { obter, salvar, documento };
}
