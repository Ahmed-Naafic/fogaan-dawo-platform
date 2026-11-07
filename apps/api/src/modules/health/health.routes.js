import { Router } from 'express';
import * as healthController from './health.controller.js';

const router = Router();

router.get('/', healthController.show); // liveness: the process answers (no database access)
router.get('/ready', healthController.ready); // readiness: configuration valid + database reachable

export default router;
