import { describe, it, expect } from '@jest/globals';
import { detectWritingLanguage } from '../modules/chatbot/orchestrator/reference-precheck.js';
import { buildSystemPrompt } from '../modules/chatbot/orchestrator/router-l1.js';
import { isUnbackedActionClaim } from '../modules/chatbot/orchestrator/templates.js';

/**
 * Facts the prompt was missing, found replaying the owner's conversation word
 * for word (2026-09-15): "harvir singh" was answered, in German, "Harvir Singh
 * ist nicht im Team" -- he was on the team, as a manager, and the manager
 * writes English.
 */
describe('detectWritingLanguage', () => {
  it('reads English from the conversation so far when the new message has no language', () => {
    expect(detectWritingLanguage(['15 16 17 what dates', 'make me plans for parveen', 'harvir singh'])).toBe('English');
  });

  it('reads German', () => {
    expect(detectWritingLanguage(['wir haben heute 90 Zimmer', 'ich möchte die Schicht von Anna'])).toBe('German');
  });

  it('says nothing when it cannot tell', () => {
    expect(detectWritingLanguage(['harvir singh'])).toBeNull();
    expect(detectWritingLanguage(['17 add'])).toBeNull();
  });
});

describe('the managers on the roster are stated', () => {
  it('names them as managers, so a manager is not "not on the team"', () => {
    const actor = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } } as never;
    const prompt = buildSystemPrompt(actor, [], { hotels: ['Premier Inn'], managers: ['Harvir Singh'] });
    expect(prompt).toContain('Managers in their hotel group (not workers, and not put on the cleaning schedule): Harvir Singh.');
  });
});

/** Same replay: a link claimed after the account tool had only asked for a name. */
describe('a link nobody made is an unbacked claim', () => {
  it.each([
    "I already created a link to make the new employee's account. You can use that link to complete the account creation.",
    'I provided a link to set up a new user account, which you can use to create the ID.',
  ])('catches "%s"', (text) => {
    expect(isUnbackedActionClaim(text)).toBe(true);
  });

  it('leaves an honest answer alone', () => {
    expect(isUnbackedActionClaim('You can copy this conversation using the Copy button in the chat window.')).toBe(false);
    expect(isUnbackedActionClaim("What is the new employee's name?")).toBe(false);
  });
});
