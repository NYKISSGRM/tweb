import {planFolders, PlannerFolder, FolderOp} from '@lib/nykiss/heatFolders';

const F = (id: number, title: string, include: number[], extra: Partial<PlannerFolder> = {}): PlannerFolder =>
  ({id, title, includePeerIds: include, pinnedPeerIds: [], excludePeerIds: [], ...extra});
const W = (warm: number[], hot: number[]) => ({warm, hot});
const apply = (folders: PlannerFolder[], ops: FolderOp[], nextId = 100) => {
  let out = [...folders];
  for(const op of ops) {
    if(op.type === 'delete') out = out.filter((f) => f.id !== op.id);
    else {
      const title = op.key === 'warm' ? 'Тёплые' : 'Горячие';
      out = out.filter((f) => f.id !== op.id);
      out.push(F(op.id ?? nextId++, title, op.peerIds));
    }
  }
  return out;
};

describe('planFolders', () => {
  it('does nothing when there is nothing to show', () => {
    expect(planFolders([], W([], []))).toEqual([]);
  });

  it('creates a folder on the first warm chat', () => {
    expect(planFolders([], W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: null, peerIds: [1]}]);
  });

  it('moves a chat from warm to hot — never in both', () => {
    const ops = planFolders([F(10, 'Тёплые', [1]), F(11, 'Горячие', [])], W([], [1]));
    const after = apply([F(10, 'Тёплые', [1]), F(11, 'Горячие', [])], ops);
    const inWarm = after.find((f) => f.title === 'Тёплые')?.includePeerIds ?? [];
    const inHot = after.find((f) => f.title === 'Горячие')?.includePeerIds ?? [];
    expect(inHot).toEqual([1]);
    expect(inWarm).toEqual([]);
  });

  it('removes a chat that is in both folders from the wrong one', () => {
    const folders = [F(10, 'Тёплые', [1, 2]), F(11, 'Горячие', [1])];
    const after = apply(folders, planFolders(folders, W([2], [1])));
    expect(after.find((f) => f.title === 'Тёплые')?.includePeerIds).toEqual([2]);
    expect(after.find((f) => f.title === 'Горячие')?.includePeerIds).toEqual([1]);
  });

  it('drops what was put in by hand — the folder is the CRM\'s', () => {
    const folders = [F(10, 'Тёплые', [1, 999])];
    expect(planFolders(folders, W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
  });

  it('clears pinned and excluded chats', () => {
    const folders = [F(10, 'Тёплые', [], {pinnedPeerIds: [1]})];
    expect(planFolders(folders, W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
    const folders2 = [F(10, 'Тёплые', [1], {excludePeerIds: [5]})];
    expect(planFolders(folders2, W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
  });

  it('deletes the legacy «Холодные» folder', () => {
    expect(planFolders([F(7, 'Холодные', [3])], W([], []))).toEqual([{type: 'delete', id: 7}]);
  });

  it('keeps one folder per title and deletes duplicates', () => {
    const folders = [F(12, 'Тёплые', [1]), F(10, 'Тёплые', [1])];
    expect(planFolders(folders, W([1], []))).toEqual([{type: 'delete', id: 12}]);
  });

  it('leaves somebody else\'s folders alone', () => {
    expect(planFolders([F(5, 'в', [9]), F(6, 'Работа', [8])], W([], []))).toEqual([]);
  });

  it('deletes an emptied folder, but not while chats are still unresolved', () => {
    const folders = [F(10, 'Тёплые', [1])];
    expect(planFolders(folders, W([], []))).toEqual([{type: 'delete', id: 10}]);
    expect(planFolders(folders, W([], []), {warm: 2, hot: 0})).toEqual([]);
  });

  it('is idempotent: applying the plan leaves nothing more to do', () => {
    const folders = [F(10, 'Тёплые', [1, 5]), F(11, 'Горячие', [1]), F(12, 'Холодные', [2]), F(13, 'Горячие', [3])];
    const want = W([5], [1, 2]);
    const after = apply(folders, planFolders(folders, want));
    expect(planFolders(after, want)).toEqual([]);
  });
});
