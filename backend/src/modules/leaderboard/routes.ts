import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { getGlobalLeaderboard, getHotelLeaderboard } from './controller.js';

const router = Router();

router.use(authMiddleware);

// Read-only standings, visible to all authenticated roles.
router.get('/', getGlobalLeaderboard);
router.get('/by-hotel/:hotel_id', getHotelLeaderboard);

export default router;
