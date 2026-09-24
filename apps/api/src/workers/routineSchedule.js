export const SCHEDULE_TIME_ZONE = "America/Sao_Paulo";
const HOUR = 3600000;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function localCalendar(date = new Date()) {
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}

function localInstant(year, month, day, hour) {
  const target = Date.UTC(year, month - 1, day, hour);
  let instant = target;
  // Resolve the IANA zone rather than relying on the host's TZ or a fixed UTC offset.
  for (let i = 0; i < 3; i += 1) {
    const p = localCalendar(new Date(instant));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const correction = target - represented;
    instant += correction;
    if (!correction) break;
  }
  return new Date(instant);
}

export function scheduleSlots(config, now = new Date()) {
  if (!config || config.enabled === false) return [];
  const p = localCalendar(now);
  const hour = Math.max(0, Math.min(23, Number(config.hour ?? 7)));
  const slots = [];
  if (config.frequency === "DAILY") {
    for (let delta = -1; delta <= 2; delta += 1) {
      const d = new Date(Date.UTC(p.year, p.month - 1, p.day + delta));
      slots.push(localInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour));
    }
  } else {
    const requestedDay = Math.max(1, Math.min(31, Number(config.day ?? 5)));
    for (let delta = -1; delta <= 2; delta += 1) {
      const month = new Date(Date.UTC(p.year, p.month - 1 + delta, 1));
      const year = month.getUTCFullYear();
      const m = month.getUTCMonth() + 1;
      const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const day = Math.min(requestedDay, lastDay);
      for (let retry = 0; retry <= 2; retry += 1) {
        if (day + retry <= lastDay) slots.push(localInstant(year, m, day + retry, hour));
      }
    }
  }
  return slots.sort((a, b) => a - b);
}

export function describeSchedule(config, now = new Date()) {
  const slots = scheduleSlots(config, now);
  const previous = slots.filter((date) => date <= now).at(-1) || null;
  const catchupHours = config?.frequency === "DAILY" ? 24 : 72;
  return {
    timeZone: SCHEDULE_TIME_ZONE,
    dueAt: previous && now - previous < catchupHours * HOUR ? previous.toISOString() : null,
    previousAt: previous?.toISOString() || null,
    nextAt: slots.find((date) => date > now)?.toISOString() || null,
  };
}

export function previousCompetencia(date = new Date()) {
  const p = localCalendar(date);
  const ref = new Date(Date.UTC(p.year, p.month - 2, 1));
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`;
}
