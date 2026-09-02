// A FOTO DA SIMULAÇÃO DE PLANEJAMENTO — gravar, ler, e virar PDF em Documentos.
//
// > Dono: *"ela deve poder ser impressa, salva e colocada na área de documento ou na área fiscal,
// > onde melhor encaixar para termos isso em mão para nosso cliente"*.
//
// ⚠⚠ POR QUE SE GRAVA (e o DANFSe não): o DANFSe sai inteiro de um `xmlRaw` imutável — recalcular
// devolve o mesmo documento, sempre, então salvá-lo seria cache. Aqui o resultado depende do que o
// contador DIGITOU POR CIMA, do RBT12 e da folha **no instante da simulação**, e das tabelas
// vigentes naquela data. Recalcular amanhã devolve outro número, **legitimamente** — e o PDF que já
// foi ao cliente afirma o de ontem. Sem a foto, não há como reabrir o que foi entregue.
//
// ⚠⚠ O PDF É GERADO A PARTIR DA FOTO, NUNCA DA TELA. É isso que impede o papel e o ecrã de
// divergirem: se o gerador lesse o estado do formulário, dois PDFs "da mesma simulação" poderiam
// sair diferentes conforme o que estivesse aberto na hora.
//
// ⚠⚠ E O ARMAZENAMENTO É O QUE JÁ EXISTE. `CompanyDocumentsService.adicionar` é chamado com o PDF
// em memória — **não se escreve um segundo caminho de storage**. Foi um segundo caminho que fez os
// PDFs sumirem a cada deploy no Railway, e a lição está no `apps/api/CLAUDE.md`.
// ⚠⚠ ISSO EXIGE O VOLUME EM `/app/storage` + `GUIDE_LOCAL_STORAGE_DIR` ABSOLUTO. Sem isso todo
// deploy apaga o arquivo, e **não há, neste repositório, prova de que a produção esteja assim**.

import { prisma } from "../../infrastructure/db/prisma.js";
import { adicionar as adicionarDocumento } from "../companies/CompanyDocumentsService.js";
import { gerarPdfPlanejamento } from "./pdf/gerarPdfPlanejamento.js";

/** O tipo do documento gerado. ⚠ Tem de estar em `TIPOS_DOCUMENTO`, senão `adicionar` recusa. */
export const TIPO_DOCUMENTO_PLANEJAMENTO = "PLANEJAMENTO_TRIBUTARIO";

export class SimulacaoPlanejamentoError extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

/** `YYYY-MM` ou nada. ⚠ Não se inventa a competência a partir de "hoje": ela descreve a JANELA de
 *  dados que a simulação usou, e quem sabe disso é a tela que fez a conta. */
function competenciaValida(v) {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/**
 * GRAVA A FOTO. Não gera PDF — são dois atos, e o segundo pode falhar sem desfazer o primeiro.
 *
 * ⚠ `entradas` e `resultado` são obrigatórios: uma foto sem um dos dois não responde nem "o que foi
 * digitado" nem "o que deu", e seria um registro que só ocupa lugar na lista.
 */
export async function salvarSimulacao({
  portalClientId,
  competencia,
  entradas,
  resultado,
  procedencias = null,
  vigenciaTabelas = null,
  geradoPor = null,
}) {
  if (!portalClientId) throw new SimulacaoPlanejamentoError("empresa_ausente", "Empresa não informada.");
  if (!competenciaValida(competencia)) {
    throw new SimulacaoPlanejamentoError("competencia_invalida", "Competência deve ser AAAA-MM.");
  }
  if (!entradas || typeof entradas !== "object") {
    throw new SimulacaoPlanejamentoError("entradas_ausentes", "A simulação precisa das entradas usadas.");
  }
  if (!resultado || typeof resultado !== "object") {
    throw new SimulacaoPlanejamentoError("resultado_ausente", "A simulação precisa do resultado calculado.");
  }

  return prisma.simulacaoPlanejamento.create({
    data: {
      portalClientId,
      competencia,
      entradas,
      resultado,
      procedencias,
      vigenciaTabelas,
      geradoPor,
    },
  });
}

/** As fotos de uma empresa, da mais nova para a mais velha. */
export function listarSimulacoes({ portalClientId, limite = 50 }) {
  return prisma.simulacaoPlanejamento.findMany({
    where: { portalClientId },
    orderBy: { geradoEm: "desc" },
    take: Math.min(Number(limite) || 50, 200),
  });
}

/**
 * ⚠ A LEITURA É SEMPRE ESCOPADA PELA EMPRESA. `findUnique({ where: { id } })` alcançaria a
 * simulação de outro cliente conhecendo o id — multi-tenancy é invariante desta casa.
 */
export function lerSimulacao({ portalClientId, id }) {
  return prisma.simulacaoPlanejamento.findFirst({ where: { id, portalClientId } });
}

/**
 * GERA O PDF DA FOTO e o guarda em Documentos da empresa.
 *
 * ⚠⚠ Ele lê a FOTO, nunca a tela — ver o cabeçalho deste arquivo.
 * ⚠ Idempotência NÃO é prometida: mandar gerar duas vezes produz dois documentos. É deliberado —
 * um "já existe, não gero" esconderia do contador o fato de o primeiro ter sido apagado, e
 * sobrescrever apagaria um PDF que pode já ter circulado.
 */
export async function gerarDocumentoDaSimulacao({ portalClientId, id, empresa, uploadedById = null }) {
  const foto = await lerSimulacao({ portalClientId, id });
  if (!foto) {
    throw new SimulacaoPlanejamentoError("simulacao_nao_encontrada", "Simulação não encontrada.", 404);
  }

  const pdf = await gerarPdfPlanejamento({ foto, empresa });

  const nome = `Planejamento tributário — ${empresa?.razao || "empresa"} — ${foto.competencia}`;
  const doc = await adicionarDocumento({
    portalClientId,
    tipo: TIPO_DOCUMENTO_PLANEJAMENTO,
    nome,
    uploadedById,
    // ⚠ A forma de `arquivo` é a do multer, porque é ela que `adicionar` já conhece. Passar um
    // formato próprio obrigaria a mexer naquele serviço — e ele é o caminho testado do upload.
    arquivo: { buffer: pdf, mimetype: "application/pdf", originalname: `${nome}.pdf` },
  });

  // ⚠ O vínculo é gravado DEPOIS de o documento existir. Ao contrário, uma falha no storage
  // deixaria a foto apontando para um documento que não existe.
  await prisma.simulacaoPlanejamento.update({
    where: { id: foto.id },
    data: { documentoId: doc.id },
  });

  return { simulacao: { ...foto, documentoId: doc.id }, documento: doc };
}
