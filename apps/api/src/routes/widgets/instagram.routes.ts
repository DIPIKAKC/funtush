import { Router } from "express";

const router = Router();

router.route('/auth/instagram/connect')
    .get();

router.route('/auth/instagram')
    .get();

router.route('/auth/instagram/oauth-callback')
    .get();

export default router;