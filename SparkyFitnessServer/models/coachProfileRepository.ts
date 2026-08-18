import type {
  CoachProfiles,
  UpdateCoachProfileRequest,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

const SELECT_COLUMNS = `
  id,
  user_id,
  enabled,
  dietary_pattern,
  primary_goal,
  calorie_target,
  protein_target_g,
  water_target_ml,
  excluded_ingredients,
  preferred_ingredients,
  disliked_ingredients,
  routines,
  coaching_notes,
  created_at,
  updated_at
`;

async function getCoachProfile(
  userId: string
): Promise<CoachProfiles | undefined> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM coach_profiles WHERE user_id = $1`,
      [userId]
    );
    return rows[0] as CoachProfiles | undefined;
  } finally {
    client.release();
  }
}

async function upsertCoachProfile(
  userId: string,
  profile: UpdateCoachProfileRequest
): Promise<CoachProfiles> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `INSERT INTO coach_profiles (
         user_id,
         enabled,
         dietary_pattern,
         primary_goal,
         calorie_target,
         protein_target_g,
         water_target_ml,
         excluded_ingredients,
         preferred_ingredients,
         disliked_ingredients,
         routines,
         coaching_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         dietary_pattern = EXCLUDED.dietary_pattern,
         primary_goal = EXCLUDED.primary_goal,
         calorie_target = EXCLUDED.calorie_target,
         protein_target_g = EXCLUDED.protein_target_g,
         water_target_ml = EXCLUDED.water_target_ml,
         excluded_ingredients = EXCLUDED.excluded_ingredients,
         preferred_ingredients = EXCLUDED.preferred_ingredients,
         disliked_ingredients = EXCLUDED.disliked_ingredients,
         routines = EXCLUDED.routines,
         coaching_notes = EXCLUDED.coaching_notes,
         updated_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [
        userId,
        profile.enabled,
        profile.dietaryPattern,
        profile.primaryGoal,
        profile.calorieTarget,
        profile.proteinTargetG,
        profile.waterTargetMl,
        profile.excludedIngredients,
        profile.preferredIngredients,
        profile.dislikedIngredients,
        profile.routines,
        profile.coachingNotes,
      ]
    );
    return rows[0] as CoachProfiles;
  } finally {
    client.release();
  }
}

export default { getCoachProfile, upsertCoachProfile };
