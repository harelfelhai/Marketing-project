/**
 * vocabOptions — helpers that turn the operator-managed vocabularies (the
 * closed lists hydrated into MockDataContext) into the {value,label} option
 * shape the dropdowns render.
 *
 * Labels: known seed tokens map to Hebrew via the maps below; operator-added
 * tokens fall back to the raw value. This keeps existing UX labels while
 * letting admins add new types from the System Settings tab without code.
 *
 * // HOOK FOR ENTERPRISE LABELS — extend the maps when proprietary terms land.
 */

import {
  ENTITY_OPTION_FAMILY, ENTITY_OPTION_FRIEND,
  ENTITY_OPTION_COLLEAGUE, ENTITY_OPTION_SPOUSE,
} from './strings.he';

export const RELATION_LABELS = {
  family:     ENTITY_OPTION_FAMILY,
  friend:     ENTITY_OPTION_FRIEND,
  colleague:  ENTITY_OPTION_COLLEAGUE,
  spouse:     ENTITY_OPTION_SPOUSE,
  associated: 'קשור',
};

/**
 * Relation-type options from the managed `relation_types` vocabulary.
 * @param {object} vocabularies  MockDataContext.vocabularies
 * @param {{excludePrimary?: boolean}} opts  Exclude the root-only 'primary'
 *        (true for the ingestion panels, which create members not roots).
 * @returns {{value:string,label:string}[]}
 */
export function relationOptions(vocabularies, { excludePrimary = true } = {}) {
  return (vocabularies?.relation_types || [])
    .filter((v) => !(excludePrimary && v === 'primary'))
    .map((v) => ({ value: v, label: RELATION_LABELS[v] || v }));
}
