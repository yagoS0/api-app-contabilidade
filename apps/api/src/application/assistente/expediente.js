// Calendário do escritório no Rio de Janeiro, confirmado pelo dono em 07/09/2026.
// Não altera vencimentos fiscais. Pontos facultativos não são feriados deste calendário.
export const FUSO_EXPEDIENTE = "America/Sao_Paulo";
const FIXOS = {
  "01-01": "Confraternização Universal", "01-20": "São Sebastião",
  "04-21": "Tiradentes", "04-23": "São Jorge", "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil", "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados", "11-15": "Proclamação da República",
  "11-20": "Consciência Negra", "12-25": "Natal",
};
const iso = (data) => data.toISOString().slice(0, 10);
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  return new Date(Date.UTC(ano, Math.floor(n / 31) - 1, n % 31 + 1));
}
export function feriadoDoEscritorio(dataIso) {
  if (FIXOS[dataIso.slice(5)]) return FIXOS[dataIso.slice(5)];
  const domingo = pascoa(Number(dataIso.slice(0, 4)));
  for (const [dias, nome] of [[-47, "Carnaval"], [-2, "Sexta-feira Santa"], [60, "Corpus Christi"]]) {
    const data = new Date(domingo);
    data.setUTCDate(data.getUTCDate() + dias);
    if (iso(data) === dataIso) return nome;
  }
  return null;
}
export function expedienteDoEscritorio(agora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_EXPEDIENTE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(agora).map(({ type, value }) => [type, value]));
  const dataIso = `${partes.year}-${partes.month}-${partes.day}`;
  const data = new Date(`${dataIso}T00:00:00Z`);
  const diaUtil = (d) => ![0, 6].includes(d.getUTCDay()) && !feriadoDoEscritorio(iso(d));
  const minutos = Number(partes.hour) * 60 + Number(partes.minute);
  const aberto = Boolean(diaUtil(data) && minutos >= 540 && minutos < 1020);
  const proximo = new Date(data);
  if (!diaUtil(proximo) || minutos >= 1020) {
    do { proximo.setUTCDate(proximo.getUTCDate() + 1); } while (!diaUtil(proximo));
  }
  const retorno = iso(proximo).split("-").reverse().join("/");
  return { aberto, feriado: feriadoDoEscritorio(dataIso),
    proximaAbertura: aberto ? null : `${iso(proximo)}T09:00:00-03:00`,
    mensagem: aberto
      ? "O escritório está no horário de atendimento humano, de segunda a sexta, das 9h às 17h. O encaminhamento não garante resposta imediata."
      : `O escritório está fora do horário de atendimento humano. O próximo expediente começa em ${retorno}, às 9h, no horário do Rio de Janeiro. A IA continua disponível para as funções autorizadas.`,
  };
}
