import type { Request, Response } from "express";
import { livechatWidgetService, whatsappWidgetService } from "src/services/widgets.service";

export const whatsappWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const whatsapp = await whatsappWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: whatsapp,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const livechatWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const livechat = await livechatWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: livechat,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};