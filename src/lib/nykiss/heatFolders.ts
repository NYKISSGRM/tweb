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
  excludePeerIds: number[]
};

export type FolderOp =
  | {type: 'delete', id: number}
  | {type: 'upsert', key: HeatKey, id: number | null, peerIds: number[]};

const sameSet = (a: number[], b: number[]) => a.length === b.length && b.every((id) => a.includes(id));

/**
 * @param folders   the account's custom folders, fresh from the server
 * @param want      per temperature: chats that belong in the folder AND can be addressed (access_hash known), capped
 * @param unresolved per temperature: CRM chats with that temperature we could not address yet — while there are
 *                  some, an empty `want` must not delete the folder (the user list may simply not be loaded yet)
 */
export function planFolders(
  folders: PlannerFolder[],
  want: Record<HeatKey, number[]>,
  unresolved: Record<HeatKey, number> = {warm: 0, hot: 0}
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

  for(const key of ['hot', 'warm'] as HeatKey[]) {
    const f = byKey[key];
    const ids = want[key];
    if(!ids.length) {
      // a folder cannot be empty on the server — an emptied one goes away
      if(f && !unresolved[key]) ops.push({type: 'delete', id: f.id});
      continue;
    }
    const clean = f
      && sameSet([...f.pinnedPeerIds, ...f.includePeerIds], ids)
      && !f.pinnedPeerIds.length
      && !f.excludePeerIds.length;
    if(clean) continue;
    ops.push({type: 'upsert', key, id: f ? f.id : null, peerIds: ids});
  }

  return ops;
}
