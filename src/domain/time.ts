const krasnoyarskDateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Krasnoyarsk",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const krasnoyarskParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Krasnoyarsk",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const formatKrasnoyarskDateTime = (
  timestamp: number | null | undefined,
): string => {
  if (timestamp == null || !Number.isFinite(timestamp)) return "—";
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? krasnoyarskDateTime.format(date)
    : "—";
};

export const isValidDate = (value: string): boolean => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

export const isValidTime = (value: string): boolean => {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
};

export const krasnoyarskToday = (now = Date.now()): string => {
  const parts = Object.fromEntries(
    krasnoyarskParts
      .formatToParts(new Date(now))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const formatTournamentDate = (
  value: string,
  weekday = false,
  year = false,
): string => {
  if (!isValidDate(value)) return "Дата не задана";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Krasnoyarsk",
    day: "numeric",
    month: "long",
    ...(weekday ? { weekday: "long" as const } : {}),
    ...(year ? { year: "numeric" as const } : {}),
  }).format(new Date(`${value}T12:00:00+07:00`));
};

export const formatCountdown = (seconds: number): string => {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
};

export const isBeforeKrasnoyarskCutoff = (
  startedAt: number | null | undefined,
  cutoff: string,
  now = Date.now(),
): boolean => {
  if (!cutoff) return true;
  const cutoffMatch = isValidTime(cutoff)
    ? cutoff.match(/^(\d{2}):(\d{2})$/)
    : null;
  if (!cutoffMatch) return false;

  const parts = (timestamp: number) =>
    Object.fromEntries(
      krasnoyarskParts
        .formatToParts(new Date(timestamp))
        .map(({ type, value }) => [type, value]),
    );
  const nowParts = parts(now);
  if (startedAt != null) {
    const startParts = parts(startedAt);
    const nowDate = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
    const startDate = `${startParts.year}-${startParts.month}-${startParts.day}`;
    if (nowDate > startDate) return false;
    if (nowDate < startDate) return true;
  }

  const nowMinutes = Number(nowParts.hour) * 60 + Number(nowParts.minute);
  const cutoffMinutes = Number(cutoffMatch[1]) * 60 + Number(cutoffMatch[2]);
  return nowMinutes <= cutoffMinutes;
};
