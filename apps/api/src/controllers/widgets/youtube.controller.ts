import { Request, Response } from "express";
import {
    updateYoutubeWidgetService,
    getYoutubeWidgetService
} from "src/services/widgets/youtube.service";

export const updateYoutubeWidgetController = async (
    req: Request,
    res: Response
) => {

    try {

        const agencyUserId = req.tenantId as string;

        const widget = await updateYoutubeWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            message: "YouTube widget updated successfully.",
            data: widget
        });

    } catch (error) {

        return res.status(400).json({
            success: false,
            message:
                error instanceof Error
                    ? error.message
                    : "Something went wrong."
        });

    }

};

export const getYoutubeWidgetController = async (
    req: Request,
    res: Response
) => {

    try {

        const agencyUserId = req.tenantId as string;

        const data = await getYoutubeWidgetService(
            agencyUserId
        );

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {

        return res.status(400).json({
            success: false,
            message:
                error instanceof Error
                    ? error.message
                    : "Something went wrong."
        });

    }

};