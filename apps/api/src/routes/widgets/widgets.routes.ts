import { Router } from "express";
import { getWidgetsController, livechatWidgetController, whatsappWidgetController } from "src/controllers/widgets/widgets.controller";
import { tierGate } from "src/middleware/tierGateCheck.middleware";

const router = Router();


router.route('/agencies/me/widgets')
    .get(getWidgetsController);

router.route('/agencies/me/widgets/whatsapp')
    .patch(whatsappWidgetController);

router.route('/agencies/me/widgets/livechat')
    .patch(tierGate(["LARGE"]), livechatWidgetController);

// ["FREE","MEDIUM","LARGE"]
export default router;