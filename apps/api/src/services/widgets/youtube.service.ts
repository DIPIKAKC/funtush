// validate URL, 
// generate lazy-loaded embed, 
// configurable max count by Super Admin

import { db } from "@funtush/database";

interface YoutubeWidgetPayload {
    enabled: boolean;
    youtubeVideos: string[];
}


export const extractYoutubeVideoId = (url: string): string | null => {

    //(index[0]) (index[1]) -> if no '?' betn '()' then, set as index++
    const regex =
        /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

    // Array of url and video Id
    const match = url.match(regex);

    if (match) {
        return match[1]
    }
    return null;
};

export const updateYoutubeWidgetService = async (
    agencyUserId: string,
    data: YoutubeWidgetPayload
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
        throw new Error("Agency user not found.");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        include: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found.");
    }

    // if (!["MEDIUM", "LARGE"].includes(agency.tier.name)) {
    //     throw new Error(
    //         "YouTube widget is available only for Medium and Large plans."
    //     );
    // }

    const videoCount = await db.agencyProfile.findFirst({
        where: {
            agencyId: agency.id
        },
        select: {
            maxYoutubeVideos: true
        }
    });

    const maxVideos = videoCount?.maxYoutubeVideos ?? 10;

    if (data.youtubeVideos.length > maxVideos) {
        throw new Error(
            `Maximum ${maxVideos} YouTube videos are allowed.`
        );
    }

    // Empty set
    const ids = new Set<string>();

    for (const url of data.youtubeVideos) {

        const id = extractYoutubeVideoId(url);

        if (!id) {
            throw new Error(`Invalid YouTube URL: ${url}`);
        }

        if (ids.has(id)) {
            throw new Error("Duplicate YouTube video.");
        }

        ids.add(id);
    }

    const updatedData= await db.agencyProfile.update({
        where: {
            agencyId: agency.id
        },
        data: {
            youtubeEnabled: data.enabled,
            youtubeVideos: data.youtubeVideos,
        },
        select: {
            youtubeEnabled: true,
            youtubeVideos: true
        }
    });
    console.log("updatedYTBdata:",updatedData)

};


export const getYoutubeWidgetService = async (
    agencyUserId: string
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
        throw new Error("Agency user not found.");
    }

    const profile = await db.agencyProfile.findUnique({
        where: {
            agencyId: agencyUser.agencyId
        },
        select: {
            youtubeEnabled: true,
            youtubeVideos: true
        }
    });

    // if (!profile) {
    //     throw new Error("Agency profile not found.");
    // }

    const videos = profile?.youtubeVideos.map((url) => {
        const id = extractYoutubeVideoId(url);
        return {
            url,
            videoId: id,
            embedUrl: id
                ? `https://www.youtube.com/embed/${id}`
                : null,
        };
    });

    return {
        youtubeEnabled: profile?.youtubeEnabled,
        youtubeVideos: videos
    };

};