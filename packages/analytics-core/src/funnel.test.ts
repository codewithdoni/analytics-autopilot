import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, previousPeriod, resolveDate } from './dates.js';
import { computeSequentialFunnel, funnelFromCounts } from './funnel.js';

describe('sequential funnel', () => {
  const steps = ['paywall_shown', 'purchase_started', 'purchase_confirmed'];

  it('requires steps to happen in order', () => {
    const result = computeSequentialFunnel(steps, [
      [{ id: 'a', ts: 100 }, { id: 'b', ts: 100 }, { id: 'c', ts: 100 }],
      [{ id: 'a', ts: 200 }, { id: 'b', ts: 200 }, { id: 'c', ts: 50 }], // c started before it saw the paywall
      [{ id: 'a', ts: 300 }],
    ]);
    assert.deepEqual(result.map((s) => s.reached), [3, 2, 1]);
    assert.equal(result[1]?.from_prev, 0.6667);
    assert.equal(result[2]?.from_first, 0.3333);
    assert.equal(result[1]?.dropped, 1);
  });

  it('uses the earliest first-step event as the anchor', () => {
    const result = computeSequentialFunnel(['a', 'b'], [
      [{ id: 'u', ts: 500 }, { id: 'u', ts: 100 }],
      [{ id: 'u', ts: 200 }],
    ]);
    assert.deepEqual(result.map((s) => s.reached), [1, 1]);
  });

  it('counts an entity once however many events it has', () => {
    const result = computeSequentialFunnel(['a', 'b'], [
      [{ id: 'u', ts: 1 }, { id: 'u', ts: 2 }, { id: 'u', ts: 3 }],
      [{ id: 'u', ts: 4 }, { id: 'u', ts: 5 }],
    ]);
    assert.deepEqual(result.map((s) => s.reached), [1, 1]);
    assert.equal(result[1]?.from_prev, 1);
  });

  it('ignores rows with no entity id', () => {
    const result = computeSequentialFunnel(['a', 'b'], [[{ id: '', ts: 1 }, { id: 'u', ts: 1 }], [{ id: 'u', ts: 2 }]]);
    assert.deepEqual(result.map((s) => s.reached), [1, 1]);
  });

  it('survives an empty first step', () => {
    const result = computeSequentialFunnel(steps, [[], [{ id: 'a', ts: 1 }], []]);
    assert.deepEqual(result.map((s) => s.reached), [0, 0, 0]);
    assert.equal(result[1]?.from_prev, 0);
  });
});

describe('fast funnel from independent counts', () => {
  it('reports conversions and treats a missing event as zero', () => {
    const result = funnelFromCounts(['a', 'b', 'c'], new Map([['a', 100], ['b', 40]]));
    assert.deepEqual(result.map((s) => s.reached), [100, 40, 0]);
    assert.equal(result[1]?.from_prev, 0.4);
    assert.equal(result[2]?.dropped, 40);
  });

  it('never reports a negative drop when a later step is larger', () => {
    const result = funnelFromCounts(['a', 'b'], new Map([['a', 10], ['b', 25]]));
    assert.equal(result[1]?.dropped, 0);
    assert.equal(result[1]?.from_prev, 2.5);
  });
});

describe('dates', () => {
  const now = new Date('2026-09-21T03:00:00Z'); // 08:00 in Tashkent

  it('resolves relative dates in the reporting timezone', () => {
    assert.equal(resolveDate('today', now, 'Asia/Tashkent'), '2026-09-21');
    assert.equal(resolveDate('yesterday', now, 'Asia/Tashkent'), '2026-09-20');
    assert.equal(resolveDate('7daysAgo', now, 'Asia/Tashkent'), '2026-09-14');
    assert.equal(resolveDate('2026-01-31', now), '2026-01-31');
  });

  it('crosses month and year boundaries', () => {
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  });

  it('rejects input it cannot understand', () => {
    assert.throws(() => resolveDate('last week'), /Unrecognised date/);
  });

  it('returns the equally long preceding period', () => {
    assert.deepEqual(previousPeriod('2026-09-15', '2026-09-21'), { date1: '2026-09-08', date2: '2026-09-14' });
  });
});
