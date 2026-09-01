const { z } = require('zod');
const INSPECTION_CHECKLIST_ITEMS = ['dust', 'bathroom'];
const CreateRatingSchema = z.object({
  criteria_scores: z.preprocess((val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }, z.record(z.enum(INSPECTION_CHECKLIST_ITEMS), z.coerce.number().int().min(0).max(100)).optional()),
});

try {
  console.log(CreateRatingSchema.parse({ criteria_scores: "{}" }));
} catch (e) {
  console.log(e);
}
