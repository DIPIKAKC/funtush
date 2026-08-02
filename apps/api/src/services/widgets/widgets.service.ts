import { db } from "@funtush/database";

interface whatsappWidgetPayload {
    whatsappEnabled?: boolean;
    whatsappNumber?: string;
};

interface chatWidgetPayload {
    liveChatEnabled?: boolean;
    liveChatCode?: string;
};

interface googleAnalyticsWidgetPayload {
    googleAnalyticsId?: string;
};

interface facebookPixelWidgetPayload {
    facebookPixelId?: string;
};

export const whatsappWidgetService = async (
    agencyUserId: string,
    data: whatsappWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    if (data.whatsappEnabled && !data.whatsappNumber) {
        throw new Error("WhatsApp number is required.");
    }

    const profile = await db.agencyProfile.update({
        where: {
            agencyId: agencyUser.agencyId
        },
        data: {
            ...data
        }
    });

    return profile;
};

export const livechatWidgetService = async (
    agencyUserId: string,
    data: chatWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    if (
        data.liveChatEnabled &&
        agency.tier.name !== "LARGE"
    ) {
        throw new Error("Live Chat feature is only available for Large tier.");
    }

    if (data.liveChatEnabled && !data.liveChatCode?.trim()) {
        throw new Error("Live Chat embed code is required.");
    }

    const profile = await db.agencyProfile.update({
        where: {
            agencyId: agencyUser.agencyId
        },
        data: {
            liveChatEnabled: data.liveChatEnabled,
            liveChatCode: data.liveChatCode
        }
    });

    return profile;
};

export const googleAnalyticsWidgetService = async (
    agencyUserId: string,
    data: googleAnalyticsWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    if (
        data.googleAnalyticsId &&
        agency.tier.name !== "MEDIUM" &&
        agency.tier.name !== "LARGE"
    ) {
        throw new Error(
            "Google Analytics is available only for Medium and Large plans."
        );
    }

    const profile = await db.agencyProfile.update({
        where: {
            agencyId: agencyUser.agencyId
        },
        data: {
            googleAnalyticsId: data.googleAnalyticsId,
        }
    });

    return profile;
};

export const facebookPixelWidgetService = async (
    agencyUserId: string,
    data: facebookPixelWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    if (
        data.facebookPixelId &&
        agency.tier.name !== "MEDIUM" &&
        agency.tier.name !== "LARGE"
    ) {
        throw new Error(
            "Facebook pixel is available only for Medium and Large plans."
        );
    }

    const profile = await db.agencyProfile.update({
        where: {
            agencyId: agencyUser.agencyId
        },
        data: {
            facebookPixelId: data.facebookPixelId,
        }
    });

    return profile;
};

