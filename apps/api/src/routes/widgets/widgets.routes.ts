import { Router } from "express";
import { whatsappWidgetController } from "src/controllers/widgets/widgets.controller";

const router = Router();

router.route('/agencies/me/widgets/whatsapp')
    .patch(whatsappWidgetController);

export default router;