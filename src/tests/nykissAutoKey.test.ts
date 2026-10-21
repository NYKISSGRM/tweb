import {extractInitData} from '@lib/nykiss/autoKeyModel';

describe('nykiss auto key', () => {
  test('extractInitData reads tgWebAppData from the URL fragment', () => {
    const url = 'https://wcrm.example/app#tgWebAppData=query_id%3DAAH%26user%3D%257B%2522id%2522%253A7%257D%26hash%3Dabc&tgWebAppVersion=8.0';
    expect(extractInitData(url)).toBe('query_id=AAH&user=%7B%22id%22%3A7%7D&hash=abc');
  });

  test('extractInitData returns nothing for links without data and for garbage', () => {
    expect(extractInitData('https://wcrm.example/app#tgWebAppVersion=8.0')).toBeUndefined();
    expect(extractInitData('https://wcrm.example/app')).toBeUndefined();
    expect(extractInitData('not a url')).toBeUndefined();
    expect(extractInitData('')).toBeUndefined();
  });
});
