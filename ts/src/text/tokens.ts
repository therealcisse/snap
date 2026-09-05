/**
 * Line tokens (SPEC §4.4).
 *
 * A text file's canonical token sequence splits immediately after every LF byte, LF retained in
 * the token, so every token except possibly a file's final one ends in LF and no token contains
 * LF before its final byte. These exact strings are the shared vocabulary of edit scripts
 * (§4.4), the canonical diff (§5), and the inclusion transform (§6.3): all three operate on
 * tokens, never on raw bytes or arbitrary substrings.
 */

/**
 * Splits `text` into its canonical tokens (SPEC §4.4): each token ends at the first LF after its
 * start, LF included. The empty text has no tokens, and a final segment without LF is its own
 * token; `tokenize(text).join('') === text` always holds.
 *
 * An `indexOf` loop with `slice` avoids `split` plus re-appending the delimiter to every piece.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  for (;;) {
    const lf = text.indexOf('\n', start);
    if (lf === -1) {
      break;
    }
    tokens.push(text.slice(start, lf + 1));
    start = lf + 1;
  }
  if (start !== text.length) {
    tokens.push(text.slice(start));
  }
  return tokens;
}

/**
 * Whether `tokens` satisfies the canonical shape every token sequence Snap produces or accepts
 * must have (SPEC §4.4): tokens are nonempty, no token contains LF before its final byte, and
 * every token except possibly the last ends in LF.
 */
export function isCanonicalTokenSequence(tokens: readonly string[]): boolean {
  const last = tokens.length - 1;
  for (const [index, token] of tokens.entries()) {
    if (token.length === 0) {
      return false;
    }
    const lf = token.indexOf('\n');
    if (lf !== -1 && lf !== token.length - 1) {
      // An LF anywhere but as the final byte would split into two canonical tokens.
      return false;
    }
    if (index !== last && lf === -1) {
      // Content continues after this token, so the token must have ended with LF.
      return false;
    }
  }
  return true;
}
