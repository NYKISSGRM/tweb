// NYKISS: единая точка запуска клиентских модулей. Раньше index.ts запускал их только при загрузке страницы уже
// залогиненным, и без .catch: упавший import() молча убивал модуль. Теперь запускается и после входа по passkey.
let started = false;

const run = (name: string, p: Promise<unknown>) => p.catch((e) => console.warn('[nykiss] init failed:', name, e));

export function startNykiss() {
  if(started) return;
  started = true;
  run('quickBubble', import('@lib/nykiss/quickBubble').then(({initQuickBubble}) => initQuickBubble()));
  run('team', import('@lib/nykiss/team').then(({initTeam}) => initTeam()));
  run('dayStats', import('@lib/nykiss/dayStats').then(({initDayStats}) => initDayStats()));
  run('sessionWatch', import('@lib/nykiss/sessionWatch').then(({initSessionWatch}) => initSessionWatch()));
}
