import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { MapsController } from '../controllers/maps.controller';

const router = Router();
const mapsController = new MapsController();

router.get('/directions', authenticateToken, mapsController.directions.bind(mapsController));

export default router;
