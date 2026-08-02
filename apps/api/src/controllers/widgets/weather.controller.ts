import { Request, Response } from "express";
import { updateWeatherWidgetService, weatherApiService } from "src/services/widgets/weather.service";

export const weatherWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const widget = await updateWeatherWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            message:  widget.weatherWidgetEnabled
                ? "Weather widget enabled successfully."
                : "Weather widget disabled successfully.",
            data: widget,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong.",
        });
    }
};

export const weatherRequestController = async (
    req: Request,
    res: Response
) => {
    try {
        const { city_name, cnt } = req.query;

        if (!city_name) {
            return res.status(400).json({
                success: false,
                message: "city name is required.",
            });
        }

        const parsedCnt = Number(cnt);

        if (Number.isNaN(parsedCnt) || parsedCnt <= 0) {
            return res.status(400).json({
                success: false,
                message: "Count must be a positive number.",
            });
        }

        const result = await weatherApiService({
                city_name: String(city_name),
                cnt: parsedCnt
            });

        return res.status(200).json({
            success: true,
            message: "Weather fetched successfully.",
            data: result,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Weather API request failed."
        });
    }
};