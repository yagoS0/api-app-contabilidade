// O ESTADO DE UMA GUIA NA CIRCULAR — uma leitura só para a cor da célula, o chip do popover e os
// totais do rodapé.
//
// ⚠ VENCIDA ≠ A VENCER, e a Circular tratava as duas como a mesma coisa.
// `statusPagamento === "ABERTO"` pintava de VERMELHO — a guia que vence daqui a duas semanas com a
// mesma força da que venceu há dois meses. Vermelho é a cor de "bloqueia/vencido" (princípio 1):
// gasto no prazo normal, ele para de apontar o que de fato atrasou, e o mês inteiro vira paredão.
// É o mesmo defeito que a listagem já teve de desmontar.
//
// Estado bom NÃO grita (princípio 6): pago sai verde discreto, e "a vencer" é âmbar — ação
// programada, não alarme.

/** Meia-noite local da data — comparar timestamps crus faria "vence hoje" virar "vencida". */
function inicioDoDia(v) {
  const d = v instanceof Date ? new Date(v) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export const ESTADO_GUIA = Object.freeze({
  PLACEHOLDER: "placeholder",
  PAGA: "paga",
  PARCIAL: "parcial",
  VENCIDA: "vencida",
  A_VENCER: "aVencer",
  ABERTA: "aberta", // em aberto e SEM vencimento conhecido
});

/**
 * O estado de uma célula da Circular.
 *
 * `hoje` é injetável para o teste não depender do relógio.
 *
 * ⚠ SEM VENCIMENTO NÃO SE AFIRMA ATRASO. Guia cuja data não veio (INSS sintético, provisão criada
 * à mão, captura antiga) cai em `ABERTA` — neutra, com o texto dizendo que a data não é conhecida.
 * Chutar "vencida" por ausência de dado inventa um atraso; chutar "a vencer" esconde um real. O
 * honesto é dizer que não se sabe, que é o que a regra 1 do projeto manda.
 */
export function estadoDaGuia(entry, hoje = new Date()) {
  if (!entry) return null;
  if (entry.placeholder || entry.origem === "TEMPLATE") return ESTADO_GUIA.PLACEHOLDER;

  const status = String(entry.statusPagamento || "").toUpperCase();
  if (status === "PARCIAL") return ESTADO_GUIA.PARCIAL;
  if (status !== "ABERTO") return ESTADO_GUIA.PAGA;

  const venc = inicioDoDia(entry.sourceGuide?.vencimento || entry.vencimento);
  if (!venc) return ESTADO_GUIA.ABERTA;

  const ref = inicioDoDia(hoje);
  // Vence HOJE ainda é "a vencer": o pagamento do dia é possível até o fim do expediente bancário.
  return venc < ref ? ESTADO_GUIA.VENCIDA : ESTADO_GUIA.A_VENCER;
}

/** Dias de atraso (>= 1) de uma guia vencida; `null` quando não se aplica. */
export function diasDeAtraso(entry, hoje = new Date()) {
  const venc = inicioDoDia(entry?.sourceGuide?.vencimento || entry?.vencimento);
  const ref = inicioDoDia(hoje);
  if (!venc || !ref || venc >= ref) return null;
  return Math.round((ref - venc) / 86400000);
}

const DIA_MES = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Cor, fundo e rótulo de cada estado. A cor NUNCA viaja sozinha — sempre acompanhada do texto. */
export function aparenciaDaGuia(entry, hoje = new Date()) {
  const estado = estadoDaGuia(entry, hoje);
  switch (estado) {
    case ESTADO_GUIA.PLACEHOLDER:
      return { estado, cor: "#6272A4", fundo: "transparent", rotulo: "Prevista", titulo: "Provisão prevista — ainda não há guia." };
    case ESTADO_GUIA.PAGA:
      return { estado, cor: "#69FF47", fundo: "rgba(105,255,71,0.06)", rotulo: "Paga", titulo: "Paga." };
    case ESTADO_GUIA.PARCIAL:
      return { estado, cor: "#6EA8FF", fundo: "rgba(110,168,255,0.08)", rotulo: "Parcial", titulo: "Baixa parcial — ainda há saldo." };
    case ESTADO_GUIA.VENCIDA: {
      const dias = diasDeAtraso(entry, hoje);
      return {
        estado, cor: "#FF4757", fundo: "rgba(255,71,87,0.06)",
        rotulo: `Vencida · ${dias} dia${dias > 1 ? "s" : ""}`,
        titulo: `Vencida há ${dias} dia${dias > 1 ? "s" : ""} — juros e multa correndo.`,
      };
    }
    case ESTADO_GUIA.A_VENCER: {
      const venc = inicioDoDia(entry.sourceGuide?.vencimento || entry.vencimento);
      return {
        estado, cor: "#FFB347", fundo: "rgba(255,179,71,0.08)",
        rotulo: `A vencer · ${DIA_MES(venc)}`,
        titulo: `Em aberto, dentro do prazo — vence em ${DIA_MES(venc)}.`,
      };
    }
    default:
      return {
        estado: ESTADO_GUIA.ABERTA, cor: "#FFB347", fundo: "rgba(255,179,71,0.08)",
        rotulo: "Em aberto",
        titulo: "Em aberto — o vencimento desta guia não é conhecido, então não dá para dizer se já venceu.",
      };
  }
}

/**
 * Totais do rodapé, separando o que ainda tem prazo do que já venceu.
 *
 * Um "Total em aberto" único soma dívida vencida com compromisso futuro e responde a pergunta
 * errada: o contador quer saber quanto está ATRASADO, não quanto existe.
 */
export function totaisEmAberto(entries, hoje = new Date()) {
  const out = { aVencer: 0, vencido: 0, parcial: 0, semData: 0 };
  for (const e of entries || []) {
    const valor = Number(e?.saldo ?? e?.valor ?? e?.totalD ?? 0) || 0;
    switch (estadoDaGuia(e, hoje)) {
      case ESTADO_GUIA.VENCIDA: out.vencido += valor; break;
      case ESTADO_GUIA.A_VENCER: out.aVencer += valor; break;
      // ⚠ SEM DATA NÃO ENTRA EM "a vencer". Somá-lo ali faria o rodapé afirmar um prazo que a
      // célula, logo acima, se recusa a afirmar — a mesma tela dizendo as duas coisas. Balde
      // próprio, com rótulo próprio ("em aberto"), e a soma total continua batendo.
      case ESTADO_GUIA.ABERTA: out.semData += valor; break;
      case ESTADO_GUIA.PARCIAL: out.parcial += valor; break;
      default: break;
    }
  }
  return out;
}
