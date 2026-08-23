import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { titleMatches } from '../dist/toolset/publishVerify.js';

describe('titleMatches', () => {
  it('exact match', () => {
    assert.equal(titleMatches('副业小实验（十二）', '副业小实验（十二）'), true);
  });

  it('ignores whitespace differences', () => {
    assert.equal(titleMatches('副业 小实验（十二）', '副业小实验 （ 十二 ）'), true);
  });

  it('case insensitive', () => {
    assert.equal(titleMatches('Side Hustle 12', 'side hustle 12'), true);
  });

  it('rejects different titles', () => {
    assert.equal(titleMatches('副业小实验（十二）', '副业小实验（十一）'), false);
  });

  it('rejects empty inputs', () => {
    assert.equal(titleMatches('', '任意标题'), false);
    assert.equal(titleMatches('任意标题', ''), false);
    assert.equal(titleMatches('   ', '   '), false);
  });
});
