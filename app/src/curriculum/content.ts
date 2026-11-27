// The bundled curriculum (content/curriculum/curriculum.json), checked on
// load. The JSON ships in the JavaScript bundle, so EAS Update can fix
// curriculum content without an app release (tech-stack doc).

import raw from '../../../content/curriculum/curriculum.json';
import { REFERENCE_NORMS } from '../feedback/referenceNorms';
import type { Curriculum } from './types';
import { validateCurriculum } from './validate';

const curriculum = raw as unknown as Curriculum;
const problems = validateCurriculum(curriculum, new Set(Object.keys(REFERENCE_NORMS.vowels)));
if (problems.length > 0) {
  // CI runs the same check, so this only fires on a broken over-the-air update.
  throw new Error(`Curriculum failed validation: ${problems.slice(0, 3).join('; ')}`);
}

export const CURRICULUM: Curriculum = curriculum;
