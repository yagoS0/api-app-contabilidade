// O CICLO DE VIDA DE UMA OBRIGAÇÃO — uma leitura só para o calendário, a aba da empresa e o chip
// da listagem principal.
//
// ⚠ POR QUE OS ESTADOS SÃO DERIVADOS DO QUE O CONTADOR DECLAROU, E NÃO DE UM PRAZO FISCAL
// O plano pedia `Aguardando janela → Janela aberta → Urgente (≤30 dias) → Transmitida`. O "≤30
// dias" é um número que só faz sentido para obrigação ANUAL: numa mensal, 30 dias é o ciclo
// inteiro, e tudo ficaria vermelho o mês todo. E o schema **não tem** data de abertura de janela —
// tem `dataVencimento` e `antecedenciaLembreteDias`.
//
// `antecedenciaLembreteDias` é declarado pelo escritório POR OBRIGAÇÃO ("comece a me lembrar N dias
// antes"). Ou seja: a janela já existe no modelo, dita por quem sabe. Derivar dela é usar o dado
// real; cravar 30 dias seria inventar uma regra fiscal que ninguém confirmou (regra 1).
//
// ⚠ O CORTE DE "URGENTE" É REGRA DE TELA, NÃO PRAZO FISCAL — e está aqui declarado como tal: o
// último quarto da janela que o próprio contador definiu, com piso de 2 dias. Não afirma nada sobre
// a lei; só decide quando o âmbar vira vermelho.

export const CICLO = Object.freeze({
  CONCLUIDA: "concluida",
  VENCIDA: "vencida",
  URGENTE: "urgente",
  ABERTA: "aberta",
  AGUARDANDO: "aguardando",
});

const DIA_MS = 86400000;

function meiaNoite(v) {
  const d = v instanceof Date ? new Date(v) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Dias até o vencimento: 0 = vence hoje, negativo = venceu. `null` sem data legível. */
export function diasAte(dataVencimento, hoje = new Date()) {
  const venc = meiaNoite(dataVencimento);
  const ref = meiaNoite(hoje);
  if (!venc || !ref) return null;
  return Math.round((venc - ref) / DIA_MS);
}

/**
 * @param ocorrencia `{ dataVencimento, status }`
 * @param antecedenciaLembreteDias declarado na obrigação; ausente cai em 5 (o default do schema)
 */
export function cicloDaOcorrencia(ocorrencia, antecedenciaLembreteDias, hoje = new Date()) {
  if (!ocorrencia) return null;
  if (String(ocorrencia.status || "").toUpperCase() === "CONCLUIDA") return CICLO.CONCLUIDA;

  const dias = diasAte(ocorrencia.dataVencimento, hoje);
  // ⚠ Sem data legível NÃO se afirma atraso — mesma regra da guia sem vencimento na Circular.
  if (dias === null) return CICLO.ABERTA;
  if (dias < 0) return CICLO.VENCIDA;

  const janela = Number(antecedenciaLembreteDias) > 0 ? Number(antecedenciaLembreteDias) : 5;
  if (dias > janela) return CICLO.AGUARDANDO;
  return dias <= Math.max(2, Math.floor(janela / 4)) ? CICLO.URGENTE : CICLO.ABERTA;
}

/**
 * Cor + rótulo. A cor NUNCA viaja sozinha (princípio 2), e o rótulo carrega a CONTAGEM: "faltam 12
 * dias" responde a pergunta; "janela aberta" só diz que existe uma.
 */
export function aparenciaDaOcorrencia(ocorrencia, antecedenciaLembreteDias, hoje = new Date()) {
  const estado = cicloDaOcorrencia(ocorrencia, antecedenciaLembreteDias, hoje);
  const dias = diasAte(ocorrencia?.dataVencimento, hoje);
  const plural = (n) => (Math.abs(n) === 1 ? "dia" : "dias");

  switch (estado) {
    case CICLO.CONCLUIDA:
      return { estado, cor: "#50FA7B", rotulo: "Transmitida", titulo: "Entregue." };
    case CICLO.VENCIDA:
      return {
        estado, cor: "#FF5555",
        rotulo: `Vencida · ${Math.abs(dias)} ${plural(dias)}`,
        titulo: `O prazo passou há ${Math.abs(dias)} ${plural(dias)}.`,
      };
    case CICLO.URGENTE:
      return {
        estado, cor: "#FF5555",
        rotulo: dias === 0 ? "Vence hoje" : `Urgente · ${dias} ${plural(dias)}`,
        titulo: dias === 0 ? "O prazo é hoje." : `Faltam ${dias} ${plural(dias)} para o prazo.`,
      };
    case CICLO.ABERTA:
      return {
        estado, cor: "#FFB347",
        rotulo: dias === null ? "A entregar" : `A entregar · ${dias} ${plural(dias)}`,
        titulo: dias === null
          ? "A entregar — o vencimento desta ocorrência não é conhecido."
          : `Janela aberta: faltam ${dias} ${plural(dias)}.`,
      };
    default:
      return {
        estado, cor: "#6272A4",
        rotulo: `Aguardando · ${dias} ${plural(dias)}`,
        // Estado bom não grita (princípio 6): ainda não é trabalho de hoje.
        titulo: `Ainda não é trabalho desta semana — faltam ${dias} ${plural(dias)}.`,
      };
  }
}

/** É anual? O chip da listagem principal só existe para estas. */
export function ehAnual(obrigacao) {
  return String(obrigacao?.periodicidade || "").toUpperCase() === "ANUAL";
}
