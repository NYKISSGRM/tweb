// NYKISS Gram — командная видимость: чистая модель (без зависимостей от tweb, чтобы тестировалась отдельно).

export type TeamRank = {level: number, name: string, color: string} | null;
export type TeamFire = {len: number, tier: number, tier_name: string | null, state: string} | null;

export type TeamMember = {
  telegram_id: number,
  name: string,
  role: 'worker' | 'lead',
  rank: TeamRank,
  fire: TeamFire,
  achievements: string[],
  online: boolean,
  me: boolean
};

/** Подсказка над аватаркой коллеги. Денег и мамонтов тут нет и быть не может: сервер их не отдаёт. */
export function memberTitle(m: TeamMember): string {
  const parts = ['NYKISS', m.name];
  if(m.role === 'lead') parts.push('тимлид');
  if(m.rank) parts.push(m.rank.name);
  if(m.fire) parts.push(`серия ${m.fire.len} дн.`);
  parts.push(m.online ? 'в сети' : 'не в сети');
  return parts.join(' · ');
}

/** Индекс по peer id: бейдж ставим только коллегам (себя не помечаем). Ответ сервера считаем недоверенным. */
export function buildIndex(items: unknown): Map<string, TeamMember> {
  const idx = new Map<string, TeamMember>();
  if(!Array.isArray(items)) return idx;
  for(const raw of items) {
    if(!raw || typeof raw !== 'object') continue;
    const m = raw as TeamMember;
    if(typeof m.telegram_id !== 'number' || m.me) continue;
    idx.set(String(m.telegram_id), {
      telegram_id: m.telegram_id,
      name: String(m.name ?? ''),
      role: m.role === 'lead' ? 'lead' : 'worker',
      rank: m.rank && typeof m.rank.name === 'string' ? m.rank : null,
      fire: m.fire && typeof m.fire.len === 'number' ? m.fire : null,
      achievements: Array.isArray(m.achievements) ? m.achievements.map(String).slice(0, 3) : [],
      online: !!m.online,
      me: false
    });
  }
  return idx;
}
