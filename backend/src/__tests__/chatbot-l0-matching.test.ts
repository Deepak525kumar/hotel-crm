import { describe, it, expect } from '@jest/globals';
import {
  matchL0,
  normalize,
  commandManifest,
  L0_COMMANDS,
} from '../modules/chatbot/orchestrator/router-l0.js';

/**
 * L0 matching, with the German cases the original suite could not have
 * caught.
 *
 * The regression these exist for: normalize() ran NFKD and then replaced
 * every non-letter with a SPACE. NFKD splits "ä" into "a" + U+0308 COMBINING
 * DIAERESIS, which is category Mn (Mark), not L -- so the mark became a
 * space and "nächste schicht" normalized to "na chste schicht", matching
 * nothing. Every German worker typing an umlaut word fell through to L1,
 * which is not built.
 *
 * It survived because the one German phrase under test, 'Meine Schichten',
 * contains no umlaut.
 */
describe('L0 normalize', () => {
  it('keeps an umlaut word as ONE word (the NFKD-splitting regression)', () => {
    // The bug produced 'na chste schicht'.
    expect(normalize('nächste Schicht')).toBe('naechste schicht');
    expect(normalize('nächste Schicht')).not.toContain('na ch');
  });

  it('folds umlaut and ae/oe/ue spellings to the same key', () => {
    expect(normalize('nächste')).toBe(normalize('naechste'));
    expect(normalize('Größe')).toBe(normalize('groesse'));
    expect(normalize('über')).toBe(normalize('ueber'));
  });

  it('strips non-German diacritics without splitting the word', () => {
    expect(normalize('José')).toBe('jose');
  });

  it('still lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalize('  My   SHIFTS!! ')).toBe('my shifts');
  });
});

describe('L0 matching', () => {
  it('matches German phrases written with a real umlaut', () => {
    expect(matchL0('nächste Schicht')?.id).toBe('my_upcoming_shifts');
    expect(matchL0('Nächste Schicht')?.id).toBe('my_upcoming_shifts');
    expect(matchL0('meine nächste Schicht')?.id).toBe('my_upcoming_shifts');
  });

  it('matches the same phrases typed without an umlaut key', () => {
    expect(matchL0('naechste schicht')?.id).toBe('my_upcoming_shifts');
    expect(matchL0('meine naechste schicht')?.id).toBe('my_upcoming_shifts');
  });

  it('matches the expanded German command set', () => {
    for (const phrase of ['Meine Schichten', 'mein Schichtplan', 'Wann arbeite ich?', 'Arbeitsplan']) {
      expect(matchL0(phrase)?.id).toBe('my_shifts');
    }
  });

  it('matches the expanded English command set', () => {
    for (const phrase of ['my roster', 'My Assignments', 'when am I working?', 'my work schedule']) {
      expect(matchL0(phrase)?.id).toBe('my_shifts');
    }
    for (const phrase of ['when is my next shift', 'confirmed shifts']) {
      expect(matchL0(phrase)?.id).toBe('my_upcoming_shifts');
    }
  });

  it('still refuses to guess, so an unmatched phrase escalates to L1', () => {
    expect(matchL0('can someone cover my thursday')).toBeUndefined();
    expect(matchL0('kann jemand meine schicht uebernehmen')).toBeUndefined();
    expect(matchL0('')).toBeUndefined();
    expect(matchL0(undefined as unknown as string)).toBeUndefined();
  });
});

describe('L0 command table invariants', () => {
  it('no phrase is claimed by two different commands', () => {
    // The module builds its lookup eagerly and throws on collision, so
    // importing it at all is most of this assertion. Restated here so the
    // reason is visible at the point of failure: a phrase claimed twice is
    // silently won by whichever command is declared last, routing a worker
    // to the wrong tool with no error anywhere.
    const seen = new Map<string, string>();
    for (const command of L0_COMMANDS) {
      for (const phrase of command.phrases) {
        const key = normalize(phrase);
        const owner = seen.get(key);
        expect(owner === undefined || owner === command.id).toBe(true);
        seen.set(key, command.id);
      }
    }
  });

  it('every phrase is already normalized, so no entry is unreachable', () => {
    // A phrase stored as "Nächste Schicht" would normalize at lookup time
    // but sit in the table in a form no lookup ever produces.
    for (const command of L0_COMMANDS) {
      for (const phrase of command.phrases) {
        expect(phrase).toBe(normalize(phrase));
      }
    }
  });

  it('every command resolves to a registered-looking tool and appears in the manifest', () => {
    const manifest = commandManifest();
    expect(manifest.length).toBe(L0_COMMANDS.length);
    for (const command of L0_COMMANDS) {
      expect(command.tool).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(manifest.some((m) => m.id === command.id && m.tool === command.tool)).toBe(true);
    }
  });
});

describe('the documents command (2026-09-07)', () => {
  it('matches the onboarding question in English and German', () => {
    for (const text of [
      'what documents do i need',
      'Which documents are missing?',
      'welche Unterlagen fehlen',
      'Meine Dokumente',
    ]) {
      const hit = matchL0(text);
      expect({ text, id: hit?.id }).toEqual({ text, id: 'my_documents' });
    }
  });

  it('matches through the German folding, umlauts and all', () => {
    // The stored phrase is 'sind meine unterlagen vollstaendig'; a person
    // types the umlaut. Folding is the whole reason this works, and it
    // regressed once before.
    expect(matchL0('sind meine Unterlagen vollständig')?.id).toBe('my_documents');
  });

  it('routes to the self-scoped tool with no arguments', () => {
    const hit = matchL0('my documents');
    expect(hit?.tool).toBe('documents.my_status');
    expect(hit?.args).toEqual({});
  });
});
