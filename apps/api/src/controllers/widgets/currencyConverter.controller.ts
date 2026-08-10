import { Request, Response } from "express";
import { convertCurrencyService, updateCurrencyConverterWidgetService } from "src/services/widgets/currencyConverter.service";


export const currencyConverterWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const { enabled } = req.body;

        if (typeof enabled !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "enabled is required and must be a boolean.",
            });
        }

        const widget = await updateCurrencyConverterWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            message: widget.currencyConverterEnabled
                ? "Currency Converter enabled successfully."
                : "Currency Converter disabled successfully.",
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

export const convertCurrencyController = async (
    req: Request,
    res: Response
) => {
    try {
        const { from, to, amount } = req.query;

        if (!from || !to || !amount) {
            return res.status(400).json({
                success: false,
                message: "from, to and amount are required.",
            });
        }

        const parsedAmount = Number(amount);

        if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Amount must be a positive number.",
            });
        }

        const result = await convertCurrencyService({
            from: String(from),
            to: String(to),
            amount: parsedAmount,
        });

        return res.status(200).json({
            success: true,
            message: "Currency converted successfully.",
            data: result,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Currency API request failed."
        });
    }
};