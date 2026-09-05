/**
 * Repository location and configuration (SPEC §7 preamble, §8).
 *
 * This module currently holds only the configuration decoder; the nearest-repository walk and the
 * local-then-global configuration resolution land with the CLI skeleton.
 */
import { SnapError } from '../core/errors.ts';
import { JsonCursor, parseJson } from '../core/json.ts';
import { type ContributorId, isValidContributorId } from '../core/version.ts';

/** The value of one configuration file. `contributorId` is `undefined` when the file names none. */
export interface Configuration {
  readonly contributorId: ContributorId | undefined;
}

/**
 * Decodes the text of a configuration file (SPEC §8): `{"contributor":{"id":"<id>"}}`.
 *
 * Both `contributor` and `id` may be absent — SPEC §8 only says a file that "provides an ID" stops
 * the fallback to global configuration — but no other field may be present, and a present `id`
 * must be a valid contributor ID. Throws `SnapError` with `invalid JSON: …`,
 * `duplicate JSON key …`, `configuration… has unknown field: …`, or `invalid contributor id: <id>`.
 */
export function decodeConfiguration(text: string): Configuration {
  const root = new JsonCursor(parseJson(text, 'configuration'), 'configuration').object();
  const contributor = root.optionalField('contributor');
  root.finishObject();
  if (contributor === undefined) {
    return { contributorId: undefined };
  }
  contributor.object();
  const id = contributor.optionalField('id')?.string();
  contributor.finishObject();
  if (id !== undefined && !isValidContributorId(id)) {
    throw new SnapError(`invalid contributor id: ${id}`);
  }
  return { contributorId: id };
}
