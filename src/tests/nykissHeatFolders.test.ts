import {planFolders, toPlannerFolders, FOLDER_CAP} from '@lib/nykiss/heatFolders';
import type {PlannerFolder, FolderOp} from '@lib/nykiss/heatFolders';

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
  it('ignores duplicates in want and owned', () => {
    expect(planFolders([], W([1, 1, 2], []), {warm: [1, 1, 2, 2], hot: []}))
    .toEqual([{type: 'upsert', key: 'warm', id: null, peerIds: [1, 2]}]);
    // a chat that is both pinned and included is written once (the pin itself is dropped)
    expect(planFolders([F(10, 'Тёплые', [1], {pinnedPeerIds: [1]})], W([1], []))).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1]}]);
  });

  it('keeps a folder at the cap: kept chats first, new ones only while there is room', () => {
    const kept = Array.from({length: 60}, (_, i) => i + 1);
    const fresh = Array.from({length: 60}, (_, i) => i + 1001);
    const folders = [F(10, 'Тёплые', kept)];
    const ops = planFolders(folders, W(fresh, []), {warm: [...kept, ...fresh], hot: []});
    expect(ops.length).toEqual(1);
    const peerIds = (ops[0] as any).peerIds as number[];
    expect(peerIds.length).toEqual(FOLDER_CAP);
    expect(peerIds.slice(0, 60)).toEqual(kept);
    expect(peerIds.slice(60)).toEqual(fresh.slice(0, 40));
  });

  it('a folder already at the cap is left alone and never grows', () => {
    const full = Array.from({length: FOLDER_CAP}, (_, i) => i + 1);
    expect(planFolders([F(10, 'Тёплые', full)], W([...full, 999], []), {warm: [...full, 999], hot: []})).toEqual([]);
  });

  it('pinned chats of the CRM are kept in the plan but the pin is dropped', () => {
    const ops = planFolders([F(10, 'Тёплые', [2], {pinnedPeerIds: [1]})], W([1, 2], []));
    expect(ops).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [1, 2]}]);
  });

  it('a pinned chat that is not the CRM\'s any more leaves the folder', () => {
    const ops = planFolders([F(10, 'Тёплые', [2], {pinnedPeerIds: [1]})], W([2], []));
    expect(ops).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [2]}]);
  });

  it('touches only the exact titles: case, spaces and lookalikes are somebody else\'s folders', () => {
    const others = [F(1, 'тёплые', [1]), F(2, 'Тёплые ', [1]), F(3, ' Горячие', [1]), F(4, 'Теплые', [1]), F(5, 'ХОЛОДНЫЕ', [1]), F(6, 'Холодные!', [1])];
    expect(planFolders(others, W([], []))).toEqual([]);
    // and a new real folder is created next to them rather than hijacking one
    expect(planFolders(others, W([7], []))).toEqual([{type: 'upsert', key: 'warm', id: null, peerIds: [7]}]);
  });

  it('a chat given to both temperatures is hot only', () => {
    const ops = planFolders([], W([1, 2], [1]), {warm: [1, 2], hot: [1]});
    expect(ops).toEqual([{type: 'upsert', key: 'hot', id: null, peerIds: [1]}, {type: 'upsert', key: 'warm', id: null, peerIds: [2]}]);
  });

  it('handles empty input everywhere', () => {
    expect(planFolders([], W([], []), {warm: [], hot: []})).toEqual([]);
    expect(planFolders([F(10, 'Тёплые', []), F(11, 'Горячие', [])], W([], []))).toEqual([{type: 'delete', id: 11}, {type: 'delete', id: 10}]); // hot is planned first
  });

  it('a duplicate folder with different content is deleted, the oldest one decides', () => {
    const folders = [F(12, 'Горячие', [9]), F(10, 'Горячие', [1])];
    expect(planFolders(folders, W([], [1]))).toEqual([{type: 'delete', id: 12}]);
  });

  it('the plan is stable after being applied, also with duplicates, pins and a missing server folder', () => {
    const folders = [F(10, 'Тёплые', [1, 1, 8], {pinnedPeerIds: [8]}), F(11, 'Тёплые', [3]), F(12, 'Холодные', [4])];
    const want = W([1, 3], [5]);
    const once = apply(folders, planFolders(folders, want));
    expect(planFolders(once, want)).toEqual([]);
  });
});

describe('planFolders: limits and edge cases', () => {
  it('a folder with more chats than the cap is cut to the cap, and the result is stable', () => {
    const over = Array.from({length: FOLDER_CAP + 50}, (_, i) => i + 1);
    const folders = [F(10, 'Тёплые', over)];
    const want = W(over.slice(0, FOLDER_CAP), []);
    const ops = planFolders(folders, want, {warm: over, hot: []});
    expect(ops.length).toEqual(1);
    expect((ops[0] as any).peerIds).toEqual(over.slice(0, FOLDER_CAP));
    expect(planFolders(apply(folders, ops), want, {warm: over, hot: []}).length).toEqual(0);
  });

  it('the cap is per folder: a full warm folder does not stop hot from filling up', () => {
    const warm = Array.from({length: FOLDER_CAP}, (_, i) => i + 1);
    const hot = Array.from({length: FOLDER_CAP + 5}, (_, i) => i + 1001);
    const ops = planFolders([F(10, 'Тёплые', warm)], W(warm, hot), {warm, hot});
    expect(ops.length).toEqual(1);
    expect((ops[0] as any).key).toEqual('hot');
    expect((ops[0] as any).peerIds.length).toEqual(FOLDER_CAP);
  });

  it('a hot chat tweb cannot address yet leaves «Тёплые» and does not get stuck in both', () => {
    // 1 is hot in the CRM but not addressable: it is not in want.hot, yet it must not stay warm
    const folders = [F(10, 'Тёплые', [1, 2])];
    const ops = planFolders(folders, W([2], []), {warm: [2], hot: [1]});
    expect(ops).toEqual([{type: 'upsert', key: 'warm', id: 10, peerIds: [2]}]);
  });

  it('a hot chat that is not the CRM\'s any more leaves «Горячие»', () => {
    const folders = [F(11, 'Горячие', [1, 2])];
    expect(planFolders(folders, W([], [1]))).toEqual([{type: 'upsert', key: 'hot', id: 11, peerIds: [1]}]);
  });

  it('never plans more than one op per live folder, never an empty upsert', () => {
    const folders = [F(10, 'Тёплые', [1]), F(11, 'Горячие', [2]), F(12, 'Холодные', [3]), F(13, 'Тёплые', [4])];
    const ops = planFolders(folders, W([], [3]), {warm: [], hot: [3]});
    ops.forEach((op) => { if(op.type === 'upsert') expect(op.peerIds.length > 0).toEqual(true); });
    const ids = ops.filter((op) => op.type === 'delete').map((op: any) => op.id).sort();
    expect(ids).toEqual([10, 12, 13]);
    expect(ops.filter((op) => op.type === 'upsert')).toEqual([{type: 'upsert', key: 'hot', id: 11, peerIds: [3]}]);
  });

  it('works on the output of toPlannerFolders: shared chatlist folders with our title are never touched', () => {
    const raw = [
      {_: 'dialogFilterChatlist', id: 20, title: {text: 'Тёплые'}, includePeerIds: [1]},
      {_: 'dialogFilter', id: 21, title: {text: 'Горячие'}, includePeerIds: [1], pinnedPeerIds: [], excludePeerIds: [], pFlags: {}}
    ];
    expect(planFolders(toPlannerFolders(raw), W([], [1]))).toEqual([]);
    expect(planFolders(toPlannerFolders(raw), W([], []))).toEqual([{type: 'delete', id: 21}]);
  });
});

describe('toPlannerFolders', () => {
  const raw = (extra: any) => ({_: 'dialogFilter', id: 10, title: {text: 'Тёплые'}, ...extra});

  it('takes plain folders only: not «All», not shared chatlist folders, even with our title', () => {
    const list = [
      {_: 'dialogFilterDefault'},
      raw({id: 1}),
      raw({id: 0}),
      {_: 'dialogFilterChatlist', id: 20, title: {text: 'Тёплые'}, includePeerIds: [1]},
      raw({id: 30})
    ];
    expect(toPlannerFolders(list).map((f) => f.id)).toEqual([30]);
  });

  it('maps fields, set flags and the colour, and survives missing arrays and title', () => {
    expect(toPlannerFolders([raw({includePeerIds: [1], pinnedPeerIds: [2], excludePeerIds: [3], pFlags: {contacts: true, bots: false}, color: 0})]))
    .toEqual([{id: 10, title: 'Тёплые', includePeerIds: [1], pinnedPeerIds: [2], excludePeerIds: [3], flags: ['contacts'], hasColor: true}]);
    expect(toPlannerFolders([{_: 'dialogFilter', id: 11}]))
    .toEqual([{id: 11, title: '', includePeerIds: [], pinnedPeerIds: [], excludePeerIds: [], flags: [], hasColor: false}]);
    expect(toPlannerFolders([])).toEqual([]);
  });
});
