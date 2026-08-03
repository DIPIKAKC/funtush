import type { Request, Response } from "express";
import { facebookPixelWidgetService, getWidgetsService, googleAnalyticsWidgetService, livechatWidgetService, whatsappWidgetService } from "src/services/widgets/widgets.service";

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

export const googleAnalyticsWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const googleAnalytics = await googleAnalyticsWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: googleAnalytics,
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

export const facebookPixelWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const facebookPixel = await facebookPixelWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: facebookPixel,
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

export const getWidgetsController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const widgets = await getWidgetsService(agencyUserId);

        return res.status(200).json({
            success: true,
            message: "Widgets retrieved successfully.",
            data: widgets,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Failed to retrieve widgets.",
        });
    }
};