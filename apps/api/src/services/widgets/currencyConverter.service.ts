import { db } from "@funtush/database";
import axios from "axios";


interface CurrencyWidgetPayload {
    enabled: boolean;
}

interface CurrencyPayload {
    from: string;
    to: string;
    amount: number;
}

export const updateCurrencyConverterWidgetService = async (
    agencyUserId: string,
    data: CurrencyWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId,
        },
        select: {
            agencyId: true,
        },
    });

    if (!agencyUser) {
        throw new Error("Agency user not found.");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId,
        },
        include: {
            tier: true,
        },
    });

    if (!agency) {
        throw new Error("Agency not found.");
    }

    if (!["MEDIUM", "LARGE"].includes(agency.tier.name)) {
        throw new Error(
            "Currency Converter is available only for Medium and Large plans."
        );
    }

    return await db.agencyProfile.update({
        where: {
            id: agency.id,
        },
        data: {
            currencyConverterEnabled: data.enabled,
        },
        select: {
            id: true,
            currencyConverterEnabled: true,
        },
    });
};

export const convertCurrencyService = async (
    data: CurrencyPayload
) => {
    const {from, to, amount } = data;

    const api_key = process.env.CURRENCY_API_KEY;
    if (!api_key) {
        throw new Error("Currency API key is not configured.");
    }

    const response = await axios.get(
        `https://v6.exchangerate-api.com/v6/${api_key}/pair/${from.toUpperCase()}/${to.toUpperCase()}/${amount}`,
    );

    if (response.data.result !== "success") {
        throw new Error("Unable to fetch exchange rate.");
    }

    return {
        from: response.data.base_code,
        to: response.data.target_code,
        amount,
        exchangeRate: response.data.conversion_rate,
        convertedAmount: response.data.conversion_result,
        date: response.data.time_last_update_utc,
    };

};