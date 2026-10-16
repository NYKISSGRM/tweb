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
    const folders = [F(10, 'Тёплые', [1]), F(11, 'Горячие', [])];
    const after = apply(folders, planFolders(folders, W([], [1])));
    expect(after.find((f) => f.title === 'Горячие')?.includePeerIds).toEqual([1]);
    expect(after.find((f) => f.title === 'Тёплые')).toEqual(undefined);
  });

  it('removes a chat that is in both folders from the wrong one', () => {
    const folders = [F(10, 'Тёплые', [1, 2]), F(11, 'Горячие', [1])];
    const after = apply(folders, planFolders(folders, W([2], [1])));
    expect(after.find((f) => f.title === 'Тёплые')?.includePeerIds).toEqual([2]);
    expect(after.find((f) => f.title === 'Горячие')?.includePeerIds).toEqual([1]);
  });

  it('REGRESSION: a chat that turned hot leaves «Тёплые» even while another warm chat cannot be addressed', () => {
    // 1 is hot now; 2 is warm in the CRM but tweb has no access hash for it yet (not in want, but owned)
    const folders = [F(10, 'Тёплые', [1, 2]), F(11, 'Горячие', [1])];
    const ops = planFolders(folders, W([], [1]), {warm: [2], hot: [1]});
    expect(ops).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [2]}]);
    const folders2 = [F(10, 'Тёплые', [1])];
    const after = apply(folders2, planFolders(folders2, W([], [1]), {warm: [2], hot: [1]}));
    expect(after.find((f) => f.title === 'Тёплые')).toEqual(undefined);
    expect(after.find((f) => f.title === 'Горячие')?.includePeerIds).toEqual([1]);
  });

  it('keeps an owned chat that cannot be addressed right now', () => {
    const folders = [F(10, 'Тёплые', [1, 2])];
    expect(planFolders(folders, W([1], []), {warm: [1, 2], hot: []})).toEqual([]);
  });

  it('drops what was put in by hand — the folder is the CRM\'s', () => {
    const folders = [F(10, 'Тёплые', [1, 999])];
    expect(planFolders(folders, W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
  });

  it('clears pinned, excluded, flagged and coloured folders', () => {
    expect(planFolders([F(10, 'Тёплые', [], {pinnedPeerIds: [1]})], W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
    expect(planFolders([F(10, 'Тёплые', [1], {excludePeerIds: [5]})], W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
    expect(planFolders([F(10, 'Тёплые', [1], {flags: ['contacts']})], W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
    expect(planFolders([F(10, 'Тёплые', [1], {hasColor: true})], W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
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

  it('deletes an emptied folder', () => {
    expect(planFolders([F(10, 'Тёплые', [1])], W([], []))).toEqual([{type: 'delete', id: 10}]);
  });

  it('is idempotent: applying the plan leaves nothing more to do', () => {
    const folders = [F(10, 'Тёплые', [1, 5]), F(11, 'Горячие', [1]), F(12, 'Холодные', [2]), F(13, 'Горячие', [3])];
    const want = W([5], [1, 2]);
    const after = apply(folders, planFolders(folders, want));
    expect(planFolders(after, want)).toEqual([]);
  });
});
