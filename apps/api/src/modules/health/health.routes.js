import { Router } from 'express';
import * as healthController from './health.controller.js';

const router = Router();

router.get('/', healthController.show);

export default router;
