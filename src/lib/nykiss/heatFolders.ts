// Pure planner for the CRM-owned temperature folders. No tweb imports, so it is unit-tested.
// The folders «Тёплые» / «Горячие» belong to the CRM entirely: their content is exactly the chats
// with that temperature, nothing the user or an older version put there by hand stays.

export type HeatKey = 'warm' | 'hot';

export const HEAT_FOLDER_TITLES: Record<HeatKey, string> = {warm: 'Тёплые', hot: 'Горячие'};
export const HEAT_FOLDER_EMOTICONS: Record<HeatKey, string> = {warm: '🔥', hot: '💰'};
// Folders this feature created in earlier versions; temperature "cold" has no folder.
export const LEGACY_HEAT_FOLDER_TITLES = ['Холодные'];

export type PlannerFolder = {
  id: number,
  title: string,
  includePeerIds: number[],
  pinnedPeerIds: number[],
  excludePeerIds: number[],
  flags?: string[],   // names of the folder's pFlags that are set (contacts, groups, …)
  hasColor?: boolean
};

export type FolderOp =
  | {type: 'delete', id: number}
  | {type: 'upsert', key: HeatKey, id: number | null, peerIds: number[]};

export const FOLDER_CAP = 100; // Telegram: chats per folder

const sameSet = (a: number[], b: number[]) => a.length === b.length && b.every((id) => a.includes(id));

/**
 * The account's filters as the planner sees them. Only plain `dialogFilter`s with a real id take part:
 * shared chatlist folders (`dialogFilterChatlist`), the «All» default and anything else are never touched,
 * even when they carry one of our titles.
 */
export function toPlannerFolders(filters: any[]): PlannerFolder[] {
  return filters
  .filter((f) => f?._ === 'dialogFilter' && f.id > 1)
  .map((f) => ({
    id: f.id,
    title: f.title?.text || '',
    includePeerIds: f.includePeerIds || [],
    pinnedPeerIds: f.pinnedPeerIds || [],
    excludePeerIds: f.excludePeerIds || [],
    flags: Object.keys(f.pFlags || {}).filter((k) => f.pFlags[k]),
    hasColor: f.color != null
  }));
}

/**
 * The folder is the CRM's: after the plan it holds only chats the CRM gives that temperature.
 *
 * @param folders the account's custom folders, fresh from the server
 * @param want    per temperature: chats to ADD — the CRM says so and tweb can address them (access hash known)
 * @param owned   per temperature: EVERY chat the CRM gives that temperature, addressable or not. A chat of
 *                this set that is already in the folder stays even when it cannot be addressed right now;
 *                any other chat — cold, of the other temperature, unknown, hand-added — is taken out.
 */
export function planFolders(
  folders: PlannerFolder[],
  want: Record<HeatKey, number[]>,
  owned: Record<HeatKey, number[]> = want
): FolderOp[] {
  const ops: FolderOp[] = [];
  const byKey: Partial<Record<HeatKey, PlannerFolder>> = {};

  for(const f of [...folders].sort((a, b) => a.id - b.id)) {
    if(LEGACY_HEAT_FOLDER_TITLES.includes(f.title)) {
      ops.push({type: 'delete', id: f.id});
      continue;
    }
    const key = (Object.keys(HEAT_FOLDER_TITLES) as HeatKey[]).find((k) => HEAT_FOLDER_TITLES[k] === f.title);
    if(!key) continue; // somebody else's folder
    if(byKey[key]) ops.push({type: 'delete', id: f.id}); // duplicate: the oldest wins
    else byKey[key] = f;
  }

  // a chat handed to both temperatures is hot: the one folder per chat rule beats the input
  const hot = new Set(owned.hot);
  for(const key of ['hot', 'warm'] as HeatKey[]) {
    const f = byKey[key];
    const current = f ? [...new Set([...f.pinnedPeerIds, ...f.includePeerIds])] : [];
    const allowed = (id: number) => key === 'hot' || !hot.has(id);
    const target = [...new Set([...current.filter((id) => owned[key].includes(id)), ...want[key]])]
    .filter(allowed)
    .slice(0, FOLDER_CAP);

    if(!target.length) {
      // a folder cannot be empty on the server — an emptied one goes away
      if(f) ops.push({type: 'delete', id: f.id});
      continue;
    }
    const clean = f
      && sameSet(current, target)
      && !f.pinnedPeerIds.length
      && !f.excludePeerIds.length
      && !f.flags?.length
      && !f.hasColor;
    if(clean) continue;
    ops.push({type: 'upsert', key, id: f ? f.id : null, peerIds: target});
  }

  return ops;
}
