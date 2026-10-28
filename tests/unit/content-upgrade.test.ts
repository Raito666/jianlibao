import { describe, expect, it } from 'vitest';
import { builtinExercises, guideFor, mediaUrls } from '../../src/content/catalog';
import { createInitialData } from '../../src/domain/seed';
import { textSource, supplementFor } from '../../src/content/external-guidance';
import { mediaAssetFor } from '../../src/content/media-source';
import { textLicense } from '../../src/content/text-license';

describe('stage 8 guidance is a read-only supplement', () => {
  it('adds a reviewed, attributed Chinese hint to the exact dead-bug exercise', () => {
    const exercise = builtinExercises.find((item) => item.id === 'catalog-dead-bug')!;
    expect(guideFor(exercise)).toMatchObject({
      supplement: { sourceId: '0276', sourceName: 'dead bug', license: 'MIT' },
    });
    expect(JSON.stringify(guideFor(exercise))).toContain('对侧手臂和腿');
  });
  it('does not borrow the triceps kickback instructions for a glute kickback', () => {
    const exercise = builtinExercises.find((item) => item.id === 'catalog-cable-kickback')!;
    expect(guideFor(exercise)).not.toHaveProperty('supplement.sourceId');
  });
  it('keeps all 302 original brief/detailed guides and their 906 active SVG URLs', () => {
    expect(builtinExercises).toHaveLength(302);
    expect(new Set(mediaUrls).size).toBe(906);
    for (const exercise of builtinExercises) {
      const guide = guideFor(exercise)!;
      expect(guide.quickSteps.length).toBeGreaterThanOrEqual(3);
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.breathing.length).toBeGreaterThan(0);
      expect(guide.cues.length).toBeGreaterThan(0);
      expect(guide.mistakes.length).toBeGreaterThan(0);
    }
  });
  it('does not add teaching-source fields to saved exercises or seed snapshots', () => {
    const data = createInitialData();
    for (const exercise of data.exercises) {
      expect(exercise).not.toHaveProperty('supplement');
      expect(exercise).not.toHaveProperty('license');
      expect(exercise).not.toHaveProperty('sourceId');
    }
    expect(
      guideFor({
        id: 'personal',
        name: '我的死虫式',
        muscle: '核心',
        equipment: '自重',
        kind: 'reps',
        description: '个人原文',
      }),
    ).toBeNull();
  });
  it('includes only the reviewed 34 text adaptations and retains their author, revision and MIT notice', () => {
    const supplements = builtinExercises
      .map((exercise) => supplementFor(exercise.id))
      .filter((item) => item !== undefined);
    expect(supplements).toHaveLength(34);
    expect(new Set(supplements.map((item) => item.sourceId)).size).toBe(34);
    expect(textSource.author).toBe('Hasan Emir Yıldırım');
    expect(textSource.revision).toBe('7455efae41b330c265e7cd4b78dfa848e7ce5ebd');
    expect(textLicense).toContain('Copyright (c) 2026 Hasan Emir Yıldırım');
    expect(textLicense).toContain('The above copyright notice and this permission notice');
    for (const item of supplements) {
      expect(item.hints).toHaveLength(2);
      expect(item.hints.every((hint) => hint.trim().length > 0 && !/<\/?\w+/.test(hint))).toBe(true);
      expect(item.license).toBe('MIT');
    }
  });
  it('keeps third-party media out and supplies only the existing three local SVGs for every builtin', () => {
    for (const exercise of builtinExercises) {
      const asset = mediaAssetFor(exercise.id)!;
      expect(asset.kind).toBe('svg-frames');
      expect(asset.license).toBe('CC-BY-SA-4.0');
      expect(asset.urls).toHaveLength(3);
      expect(
        asset.urls.every(
          (url) => url.startsWith('/exercise-art/aac59922/') && url.endsWith('.svg') && mediaUrls.includes(url),
        ),
      ).toBe(true);
      expect(asset.attribution.trim().length).toBeGreaterThan(0);
    }
    expect(mediaAssetFor('personal')).toBeUndefined();
  });
  it('distinguishes the original Pallof diagrams from upstream pose artwork', () => {
    const exercise = builtinExercises.find((item) => item.id === 'catalog-pallof-press')!;
    const asset = mediaAssetFor(exercise.id)!;
    expect(asset.attribution).toBe('健力宝原创姿势示意');
    expect(asset.urls.every((url) => url.includes('/diagram-'))).toBe(true);
  });
});
