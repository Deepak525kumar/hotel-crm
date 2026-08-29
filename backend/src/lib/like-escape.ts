/**
 * Neutralise LIKE metacharacters in a user-supplied search term.
 *
 * Prisma's `contains` compiles to `LIKE '%term%'` and does NOT escape the
 * term. A search for "%" therefore matched every row -- found by probing the
 * quality search against a real database, where a bare % returned all 8 of the
 * caller's checks instead of 0. Not SQL injection (the value is still
 * parameterised) but wildcard injection, which is a correctness bug the moment
 * a room is called "A_1" or someone types a stray %.
 *
 * Backslash first, or it would double-escape the escapes added after it.
 * Postgres LIKE treats backslash as the escape character by default, which is
 * what makes this work without an explicit ESCAPE clause.
 *
 * Lives in lib/ rather than in one module because every free-text search has
 * this defect by default: the escaping has to be applied at each `contains`,
 * and a second copy of the rule is a second chance to get it wrong.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
