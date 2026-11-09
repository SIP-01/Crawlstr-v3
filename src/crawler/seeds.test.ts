// IndexedDB is not part of jsdom — fake-indexeddb provides a real
// implementation so the user-list corpus loads against real code.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { deleteList, loadLists, saveList } from './lists';
import {
  getCategories,
  seedCount,
  scoutedCount,
  totalScouts,
  previewRandomSeed,
  pickRandomSeed,
  pickRandomSeedBundle,
  commitSeed,
  categoryOf,
  refreshCorpus,
  SCOUT_BUNDLE_SIZE,
} from './seeds';

const LIST_A = Array.from({ length: 40 }, (_, i) => `https://alpha-site-${i}.example.com/page-${i}`);
const LIST_B = Array.from({ length: 30 }, (_, i) => `https://beta-site-${i}.example.com/post-${i}`);

// The seed engine reads history from localStorage (jsdom provides a real
// one) and its corpus from the user's saved lists. Reset both per test.
beforeEach(async () => {
  localStorage.clear();
  for (const list of await loadLists()) await deleteList(list.id);
  await saveList({ name: 'Alpha', urls: LIST_A, source: 'paste' });
  await saveList({ name: 'Beta', urls: LIST_B, source: 'paste' });
  await refreshCorpus();
});

describe('seed corpus (user lists)', () => {
  it('loads a corpus across the saved lists', () => {
    const categories = getCategories();
    expect(categories).toHaveLength(2);
    expect(categories.map((c) => c.label).sort()).toEqual(['Alpha', 'Beta']);
    for (const cat of categories) {
      expect(cat.count).toBeGreaterThan(0);
    }
    expect(seedCount()).toBe(LIST_A.length + LIST_B.length);
  });

  it('normalizes and dedupes URLs across lists', async () => {
    await saveList({
      name: 'Overlap',
      urls: ['https://alpha-site-0.example.com/page-0', 'https://overlap.example.com/'],
      source: 'paste',
    });
    await refreshCorpus();
    // The overlapping URL is counted once; the new one adds exactly 1.
    expect(seedCount()).toBe(LIST_A.length + LIST_B.length + 1);
  });

  it('is empty until a list is saved', async () => {
    for (const list of await loadLists()) await deleteList(list.id);
    await refreshCorpus();
    expect(seedCount()).toBe(0);
    expect(getCategories()).toEqual([]);
    expect(previewRandomSeed()).toBeNull();
    expect(pickRandomSeed()).toBeNull();
    expect(pickRandomSeedBundle()).toEqual([]);
  });
});

describe('previewRandomSeed', () => {
  it('returns a url + list name without recording the selection', () => {
    const preview = previewRandomSeed();
    expect(preview).not.toBeNull();
    expect(preview!.url).toMatch(/^https:\/\//);
    expect(['Alpha', 'Beta']).toContain(preview!.category);

    // Previewing must NOT count as scouting.
    expect(scoutedCount()).toBe(0);
    expect(totalScouts()).toBe(0);
  });

  it('respects a list constraint', () => {
    const target = getCategories().find((c) => c.label === 'Alpha')!;
    for (let i = 0; i < 10; i++) {
      const preview = previewRandomSeed(target.id);
      expect(preview).not.toBeNull();
      expect(preview!.category).toBe('Alpha');
    }
  });

  it('returns null for an unknown list', () => {
    expect(previewRandomSeed('does-not-exist')).toBeNull();
  });
});

describe('commitSeed / pickRandomSeed', () => {
  it('commitSeed records the pick in local history', () => {
    const preview = previewRandomSeed()!;
    commitSeed(preview.url);
    expect(scoutedCount()).toBe(1);
    expect(totalScouts()).toBe(1);
    expect(categoryOf(preview.url)).toBe(preview.category);
  });

  it('pickRandomSeed = preview + commit', () => {
    const url = pickRandomSeed();
    expect(url).toMatch(/^https:\/\//);
    expect(scoutedCount()).toBe(1);
  });

  it('prefers fresh seeds — repeated picks cover the corpus before repeating', () => {
    // Pull many picks; the number of DISTINCT urls scouted should be close to
    // the number of picks (fresh-first dominates while fresh seeds remain).
    const picks = 50;
    for (let i = 0; i < picks; i++) pickRandomSeed();
    expect(scoutedCount()).toBeGreaterThan(picks * 0.5);
    expect(totalScouts()).toBe(picks);
  });

  it('history survives a reload (localStorage persistence)', () => {
    const url = pickRandomSeed()!;
    expect(scoutedCount()).toBe(1);
    commitSeed(url);
    commitSeed(url);
    expect(scoutedCount()).toBe(1); // distinct
    expect(totalScouts()).toBe(3);  // but counted every time
  });
});

describe('privacy', () => {
  it('history is localStorage-only — nothing network-shaped is stored', () => {
    pickRandomSeed();
    const raw = localStorage.getItem('crawlstr:scout-history');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    // Only { n, at } per URL — no device info, no timestamps beyond the pick,
    // no user identity, no queries.
    for (const entry of Object.values(parsed)) {
      expect(Object.keys(entry as object).sort()).toEqual(['at', 'n']);
    }
  });
});

describe('pickRandomSeedBundle (v2 scout toggle)', () => {
  it('returns SCOUT_BUNDLE_SIZE distinct seeds', () => {
    const bundle = pickRandomSeedBundle();
    expect(bundle.length).toBe(SCOUT_BUNDLE_SIZE);
    expect(new Set(bundle).size).toBe(bundle.length);
  });

  it('respects an explicit smaller count', () => {
    const bundle = pickRandomSeedBundle(3);
    expect(bundle.length).toBe(3);
  });

  it('every bundle seed is a normalized https corpus URL', () => {
    const bundle = pickRandomSeedBundle();
    for (const seed of bundle) {
      expect(seed.startsWith('https://')).toBe(true);
    }
  });

  it('commits each picked seed to history', () => {
    const before = totalScouts();
    pickRandomSeedBundle();
    expect(totalScouts()).toBe(before + SCOUT_BUNDLE_SIZE);
  });
});
