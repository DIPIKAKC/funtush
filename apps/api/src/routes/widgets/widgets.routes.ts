import { Router } from "express";
import { convertCurrencyController, currencyConverterWidgetController } from "src/controllers/widgets/currencyConverter.controller";
import { InstagramWidgetController } from "src/controllers/widgets/instagram.controller";
import { weatherRequestController, weatherWidgetController } from "src/controllers/widgets/weather.controller";
import { facebookPixelWidgetController, getWidgetsController, googleAnalyticsWidgetController, livechatWidgetController, whatsappWidgetController } from "src/controllers/widgets/widgets.controller";
import { updateYoutubeWidgetController } from "src/controllers/widgets/youtube.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { tierGate } from "src/middleware/tierGateCheck.middleware";

const router = Router();


router.route('/')
    .get(authenticateWithRefreshToken, getWidgetsController);

router.route('/whatsapp')
    .patch(whatsappWidgetController);

router.route('/livechat')
    .patch(tierGate(["LARGE"]), livechatWidgetController);

router.route('/google')
    .patch(tierGate(["MEDIUM", "LARGE"]), googleAnalyticsWidgetController);

router.route('/facebook')
    .patch(tierGate(["MEDIUM", "LARGE"]), facebookPixelWidgetController);

router.route('/youtube')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), updateYoutubeWidgetController);

router.route('/instagram')
    .patch(tierGate(["LARGE"]), InstagramWidgetController);

router.route('/weather-enable')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), weatherWidgetController);
router.route('/weather-check')
    .get(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), weatherRequestController);

router.route('/currency-enable')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), currencyConverterWidgetController);

router.route('/currency-check')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), convertCurrencyController);


// ["FREE","MEDIUM","LARGE"]
export default router;