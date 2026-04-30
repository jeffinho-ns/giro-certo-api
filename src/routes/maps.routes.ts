import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { MapsController } from '../controllers/maps.controller';

const router = Router();
const mapsController = new MapsController();

router.get('/directions', authenticateToken, mapsController.directions.bind(mapsController));
router.get('/autocomplete', authenticateToken, mapsController.autocomplete.bind(mapsController));
router.get('/place-details', authenticateToken, mapsController.placeDetails.bind(mapsController));
router.get('/offline-regions', authenticateToken, mapsController.offlineRegions.bind(mapsController));

export default router;
