// NYKISS: pure helpers for the profile "technical data" rows (ID, data center, registration estimate).

/** Rough anchor points (user id -> month), good to within a few months. Telegram does not expose the real date. */
const ID_ANCHORS: Array<[number, number, number]> = [
  [2768409, 2013, 11], [7679610, 2013, 12], [11538514, 2014, 2], [15835244, 2014, 3], [23646077, 2014, 6],
  [38015510, 2014, 12], [44634663, 2015, 2], [63263518, 2015, 8], [101260938, 2016, 1], [200000000, 2017, 3],
  [400000000, 2018, 4], [700000000, 2019, 4], [1000000000, 2020, 3], [1500000000, 2020, 12], [2000000000, 2021, 8],
  [5000000000, 2022, 8], [6000000000, 2023, 8], [7000000000, 2024, 6], [8000000000, 2025, 3]
];

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const DC_PLACES: Record<number, string> = {1: 'Майами', 2: 'Амстердам', 3: 'Майами', 4: 'Амстердам', 5: 'Сингапур'};

export function estimateRegistration(userId: number): string {
  if(!(userId > 0)) return '';
  const first = ID_ANCHORS[0];
  const last = ID_ANCHORS[ID_ANCHORS.length - 1];
  let months: number;
  if(userId <= first[0]) {
    months = first[1] * 12 + first[2] - 1;
  } else if(userId >= last[0]) {
    months = last[1] * 12 + last[2] - 1;
  } else {
    let i = 1;
    while(ID_ANCHORS[i][0] < userId) i++;
    const [id0, y0, m0] = ID_ANCHORS[i - 1];
    const [id1, y1, m1] = ID_ANCHORS[i];
    const k = (userId - id0) / (id1 - id0);
    months = Math.round((y0 * 12 + m0 - 1) * (1 - k) + (y1 * 12 + m1 - 1) * k);
  }

  return `≈ ${MONTHS[months % 12]} ${Math.floor(months / 12)}`;
}

export function dcLabel(dcId: number): string {
  if(!dcId) return '';
  const place = DC_PLACES[dcId];
  return place ? `DC ${dcId} · ${place}` : `DC ${dcId}`;
}
