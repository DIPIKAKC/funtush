import { db } from "@funtush/database";

interface CreateCategoryPayload {
    name: string;
    description: string;
}

interface UpdateCategoryPayload {
    name?: string;
    description?: string;
}

export const createCategoryService = async (
    agencyUserId: string,
    data: CreateCategoryPayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const name = data.name.trim().toLowerCase();

    if (!name) {
        throw new Error("Category name is required");
    }

    const existingCategory = await db.category.findUnique({
        where: {
            agencyId_name: {
                agencyId: agencyUser.agencyId,
                name,
            },
        },
    });

    if (existingCategory) {
        throw new Error("Category already exists");
    }

    return await db.category.create({
        data: {
            agencyId: agencyUser.agencyId,
            name,
            description: data.description?.trim(),
        }
    });

}

export const updateCategoryService = async (
    agencyUserId: string,
    categoryId: string,
    data: UpdateCategoryPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const category = await db.category.findFirst({
        where: {
            id: categoryId,
            agencyId: agencyUser.agencyId
        },
        select: {
            name: true
        }
    });

    if (!category)
        throw new Error("Category not found");

    const name = data.name?.trim().toLowerCase();

    // to detect whether the new name conflicts with another category
    if (name && name !== category.name) {
        const existingCategory = await db.category.findUnique({
            where: {
                agencyId_name: {
                    agencyId: agencyUser.agencyId,
                    name,
                },
            },
        });

        if (existingCategory) {
            throw new Error("Category already exists");
        }
    }

    return await db.category.update({
        where: {
            id: categoryId
        },
        data: {
            name,
            description: data.description?.trim(),
        }
    });
}

export const getCategoriesService = async (
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

    if (!agencyUser)
        throw new Error("Agency user not found");

    return await db.category.findMany({
        where: {
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true,
            description: true,
        },
        orderBy: {
            createdAt: "asc"
        }
    });
}

interface CreateBlogPayload {
    title: string;
    subtitle: string;
    content: string;
    categoryId: string;
    status: string;
    tag: string;
    photos: string[];
}

interface UpdateBlogPayload {
    title?: string;
    subtitle?: string;
    content?: string;
    categoryId?: string;
    status?: string;
    tag?: string;
    photos?: string[];
}

export const createBlogService = async (
    agencyUserId: string,
    data: CreateBlogPayload
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


    if (!data.title || !data.subtitle || !data.content || !data.categoryId) {
        throw new Error("Please fill out the required fields.");
    }

    return await db.blog.create({
        data: {
            agencyId: agencyUser.agencyId,
            title: data.title?.trim(),
            subtitle: data.subtitle?.trim(),
            content: data.content?.trim(),
            categoryId: data.categoryId,
            status: data.status,
            tag: data.tag,
            photos: data.photos,
        },
        include: {
            category: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
}

export const updateBlogService = async (
    agencyUserId: string,
    blogId: string,
    data: UpdateBlogPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const blog = await db.blog.findFirst({
        where: {
            id: blogId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true
        }
    });

    if (!blog)
        throw new Error("Blog not found");

    if (data.categoryId) {
        const category = await db.category.findFirst({
            where: {
                id: data.categoryId,
                agencyId: agencyUser.agencyId,
            },
            select: {
                id: true,
            },
        });

        if (!category) {
            throw new Error("Category not found");
        }
    }

    return await db.blog.update({
        where: {
            id: blogId
        },
        data: {
            title: data?.title?.trim(),
            subtitle: data?.subtitle?.trim(),
            content: data?.content?.trim(),
            categoryId: data?.categoryId,
            status: data?.status,
            tag: data?.tag,
            photos: data?.photos,
        },
        include: {
            category: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
}

export const getBlogsService = async (
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

    if (!agencyUser)
        throw new Error("Agency user not found");

    return await db.blog.findMany({
        where: {
            agencyId: agencyUser.agencyId
        },
        select: {
            title: true,
            subtitle: true,
            content: true,
            status: true,
            tag: true,
            photos: true,
            category: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
        orderBy: {
            createdAt: "asc"
        }
    });
}