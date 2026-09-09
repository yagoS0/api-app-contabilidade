import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { SERPRO_GUARDA_ATIVA, SERPRO_COOLDOWN_SEGUNDOS, SERPRO_TETO_DIARIO_EMPRESA,
  SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA, SERPRO_TETO_MENSAL_MINIMO, SERPRO_TETO_MENSAL_ABSOLUTO, SERPRO_ALERTA_FRACAO } from "../../../config.js";
import { contextoSerproAtual } from "./serproCallContext.js";
import { chaveResposta } from "./SerproRespostaCache.js";

// Ledger/contrato global desta instalação: modelo atual não tem firmId. Lock só durante reserva.
// Reserva órfã continua contando e bloqueia assinatura; ausência de resposta não prova ausência de consumo.
export const STATUS_ORCAMENTO_SERPRO = ["reservada", "ok", "erro", "incerta"];
export class SerproGuardError extends Error {
  constructor(code, message, detalhe = {}) {
    super(message); this.name = "SerproGuardError"; this.code = code; this.detalhe = detalhe;
    this.status = code === "SERPRO_MEDICAO_INDISPONIVEL" ? 503 : 409;
  }
}
export function identificarChamada(payload, rota) {
  const p = payload && typeof payload === "object" ? payload : {};
  let dados = p.pedidoDados?.dados; try { if (typeof dados === "string") dados = JSON.parse(dados); } catch { dados = null; }
  const pa = String(dados?.periodoApuracao || dados?.competencia || dados?.anoMesParcela || "");
  const competencia = /^\d{6}$/.test(pa) ? `${pa.slice(0,4)}-${pa.slice(4)}` : /^\d{4}-\d{2}$/.test(pa) ? pa : null;
  return { competencia, cnpj: String(p?.contribuinte?.numero || "").replace(/\D+/g, ""),
    idSistema: p?.pedidoDados?.idSistema ? String(p.pedidoDados.idSistema) : null,
    idServico: p?.pedidoDados?.idServico ? String(p.pedidoDados.idServico) : null,
    rota: String(rota || ""), assinatura: chaveResposta(payload ?? null, rota) };
}
function inicioPeriodo(agora = new Date(), mensal = false) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora).map((p) => [p.type, p.value]));
  return new Date(`${partes.year}-${partes.month}-${mensal ? "01" : partes.day}T00:00:00-03:00`);
}
function tetoPara(empresas) {
  const teto = Math.max(empresas * SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA, SERPRO_TETO_MENSAL_MINIMO);
  return SERPRO_TETO_MENSAL_ABSOLUTO > 0 ? Math.min(teto, SERPRO_TETO_MENSAL_ABSOLUTO) : teto;
}
function medicaoIndisponivel() {
  return new SerproGuardError("SERPRO_MEDICAO_INDISPONIVEL", "Não foi possível medir ou reservar o consumo SERPRO. Nenhuma nova consulta foi autorizada. Restabeleça o registro de consumo antes de tentar novamente.");
}
export async function tetoMensalGlobal(client = prisma) {
  try { return tetoPara(await client.portalClient.count({ where: { status: { not: "INATIVA" } } })); }
  catch { throw medicaoIndisponivel(); }
}
export async function consumoDoMes(client = prisma) {
  const desde = inicioPeriodo(new Date(), true);
  try {
    const [usadas, empresas, reservadas, incertas] = await Promise.all([
      client.serproChamada.count({ where: { status: { in: STATUS_ORCAMENTO_SERPRO }, createdAt: { gte: desde } } }),
      client.portalClient.count({ where: { status: { not: "INATIVA" } } }),
      client.serproChamada.count({ where: { status: "reservada", createdAt: { gte: desde } } }),
      client.serproChamada.count({ where: { status: "incerta", createdAt: { gte: desde } } }),
    ]);
    const teto = tetoPara(empresas), fracao = teto > 0 ? usadas / teto : 0;
    return { desde, usadas, teto, empresasAtivas: empresas, orcamentoPorEmpresa: SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA,
      restantes: Math.max(0, teto - usadas), fracao: Math.round(fracao * 100) / 100,
      alerta: fracao >= SERPRO_ALERTA_FRACAO && fracao < 1, estourado: usadas >= teto,
      reservadas, incertas, criterio: "Tentativas e reservas internas; faturamento depende de conciliação com o provedor." };
  } catch { throw medicaoIndisponivel(); }
}
export function segundosDeCooldown(chamada) {
  if (!chamada || chamada.status === "abortada_auth") return 0;
  if (["reservada", "incerta"].includes(chamada.status)) return Infinity;
  // SITFIS pode retomar 202/304 conforme tempo indicado pelo servidor.
  if (chamada.status === "ok" && [202, 304].includes(chamada.httpStatus)) return 0;
  if (chamada.status === "erro" && (chamada.httpStatus === 429 || chamada.httpStatus >= 500)) return Math.min(30, SERPRO_COOLDOWN_SEGUNDOS);
  return SERPRO_COOLDOWN_SEGUNDOS;
}
export async function autorizarChamada({ payload, rota }, client = prisma) {
  const id = identificarChamada(payload, rota), ctx = contextoSerproAtual();
  const base = { ...id, acaoId: ctx.acaoId || null, origem: ctx.origem || "nao_informada", userId: ctx.userId || null };
  let desfecho;
  try {
    desfecho = await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73517001)`;
      const empresa = id.cnpj ? await tx.portalClient.findFirst({ where: { cnpj: { contains: id.cnpj } }, select: { id: true } }) : null;
      base.portalClientId = empresa?.id || null;
      // Em voo/incerta não é ignorada por forcar nem pelo desligamento dos tetos.
      const assinaturaLegada = crypto.createHash("sha256").update(`${rota}|${JSON.stringify(payload ?? null)}`).digest("hex");
      const pendente = await tx.serproChamada.findFirst({ where: { assinatura: { in: [id.assinatura, assinaturaLegada] }, status: { in: ["reservada", "incerta"] } }, orderBy: { createdAt: "desc" } });
      const ultima = pendente || (SERPRO_GUARDA_ATIVA && SERPRO_COOLDOWN_SEGUNDOS > 0 && !(ctx.reconsultarAposTransmissao === true && id.idServico === "CONSDECLARACAO13")
        ? await tx.serproChamada.findFirst({ where: { assinatura: { in: [id.assinatura, assinaturaLegada] }, status: { in: ["ok", "erro"] }, createdAt: { gte: new Date(Date.now() - SERPRO_COOLDOWN_SEGUNDOS * 1000) } }, orderBy: { createdAt: "desc" } }) : null);
      const janela = segundosDeCooldown(ultima);
      const restantes = ultima ? Math.ceil((new Date(ultima.createdAt).getTime() + janela * 1000 - Date.now()) / 1000) : 0;
      let recusa = null;
      if (pendente) recusa = new SerproGuardError("SERPRO_CHAMADA_EM_ANDAMENTO", "Esta consulta está em andamento ou tem resultado desconhecido. Confira o registro anterior antes de repetir.");
      else if (restantes > 0) recusa = new SerproGuardError("SERPRO_CHAMADA_REPETIDA", `Esta consulta foi realizada há pouco. Aguarde ${restantes}s antes de repetir.`, { segundosRestantes: restantes, idServico: id.idServico });
      let forcado = false;
      if (!recusa && SERPRO_GUARDA_ATIVA) {
        const diario = id.cnpj && SERPRO_TETO_DIARIO_EMPRESA > 0 ? await tx.serproChamada.count({ where: { cnpj: id.cnpj, status: { in: STATUS_ORCAMENTO_SERPRO }, createdAt: { gte: inicioPeriodo() } } }) : 0;
        const mes = SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA > 0 || SERPRO_TETO_MENSAL_ABSOLUTO > 0 ? await consumoDoMes(tx) : null;
        const diarioEstourado = SERPRO_TETO_DIARIO_EMPRESA > 0 && diario >= SERPRO_TETO_DIARIO_EMPRESA;
        if (diarioEstourado || mes?.estourado) {
          // Rotas validam ADMIN via podeForcarSerpro. Sem identidade não há escape auditável.
          forcado = ctx.forcar === true && Boolean(ctx.userId);
          if (!forcado) recusa = new SerproGuardError(diarioEstourado ? "SERPRO_TETO_DIARIO" : "SERPRO_TETO_MENSAL_ESCRITORIO",
            "O orçamento SERPRO foi atingido, incluindo consultas em andamento. Um ADMIN pode liberar explicitamente uma nova consulta.",
            { usadas: diarioEstourado ? diario : mes.usadas, teto: diarioEstourado ? SERPRO_TETO_DIARIO_EMPRESA : mes.teto });
        }
      }
      if (recusa) {
        await tx.serproChamada.create({ data: { ...base, status: recusa.code.includes("TETO") ? "recusada_teto" : "recusada_cooldown", erroCodigo: recusa.code } });
        return { recusa }; // lançar só após commit: a recusa também precisa de rastro.
      }
      const reserva = await tx.serproChamada.create({ data: { ...base, status: "reservada", forcado } });
      return { autorizacao: { id: reserva.id, inicio: Date.now(), forcado } };
    }, { maxWait: 10000, timeout: 15000, isolationLevel: "ReadCommitted" });
  } catch (e) { if (e instanceof SerproGuardError) throw e; throw medicaoIndisponivel(); }
  if (desfecho.recusa) throw desfecho.recusa;
  return desfecho.autorizacao;
}
export async function concluirChamada(autorizacao, { httpStatus = null, erroCodigo = null, erroMensagem = null, abortadaAuth = false } = {}, client = prisma) {
  if (!autorizacao?.id) throw medicaoIndisponivel();
  const status = abortadaAuth ? "abortada_auth" : erroCodigo && httpStatus == null ? "incerta" : erroCodigo || httpStatus >= 400 ? "erro" : "ok";
  try {
    const r = await client.serproChamada.updateMany({ where: { id: autorizacao.id, status: "reservada" }, data: {
      status, httpStatus, erroCodigo, erroMensagem: erroMensagem ? String(erroMensagem).slice(0, 300) : null,
      duracaoMs: Date.now() - autorizacao.inicio,
    } });
    if (r.count !== 1) throw new Error("reserva_nao_atualizada");
  } catch {
    throw new SerproGuardError("SERPRO_REGISTRO_INDETERMINADO", "A tentativa SERPRO não pôde ter seu resultado registrado. Não repita a operação: confira o resultado anterior e restabeleça o registro de consumo.", { reservaId: autorizacao.id });
  }
}
