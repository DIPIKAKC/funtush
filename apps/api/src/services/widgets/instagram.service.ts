import { db } from "@funtush/database";

interface instagramWidgetPayload {
    instagramFeedEnabled?: boolean;
    instagramConnected?: boolean;
};
interface instagramConnectionPayload {
    instagramBusinessId?: string;
    instagramAccessToken?: string;
    instagramTokenExpiresAt?: Date
};


export const instagramWidgetService = async (
    agencyUserId: string,
    data: instagramWidgetPayload
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

    if (agency.tier.name !== "LARGE") {
        throw new Error("Instagram Feed is only available for Large tier.");
    }

    const profile = await db.agencyProfile.findUnique({
        where: {
            agencyId: agencyUser.agencyId
        }
    });

    if (!profile) {
        throw new Error("Agency profile not found");
    }

    if (
        data.instagramFeedEnabled &&
        !data.instagramConnected
    ) {
        throw new Error("Connect your Instagram Business account first.");
    }

    const updatedProfile = await db.agencyProfile.update({
        where: {
            agencyId: agencyUser.agencyId
        },
        data: {
            instagramFeedEnabled: data.instagramFeedEnabled
        }
    });

    return updatedProfile;
};

export const saveInstagramConnectionService = async (
    agencyId: string,
    data: instagramConnectionPayload
) => {

    return db.agencyProfile.update({
        where: {
            agencyId
        },
        data: {
            instagramConnected: true,
            instagramBusinessId: data.instagramBusinessId,
            instagramAccessToken: data.instagramAccessToken,
            instagramTokenExpiresAt: data.instagramTokenExpiresAt
        }
    });

};
