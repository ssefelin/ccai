import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../practice/counter.ts';

test('两个正数相加', () => { assert.equal(add(2, 3), 5); });
test('负数相加', () => { assert.equal(add(-2, -3), -5); });
test('与零相加', () => { assert.equal(add(0, 3), 3); });
