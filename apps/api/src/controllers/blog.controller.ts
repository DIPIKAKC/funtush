import type { Request, Response } from "express";
import { createCategoryService, getCategoriesService, updateCategoryService } from "src/services/blog.service";

export const createcategory = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const category = await createCategoryService(
            agencyUserId,
            req.body
        );

        return res.status(201).json({
            success: true,
            data: category,
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

export const updatecategory = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const categoryId = req.params.id as string;

        const category = await updateCategoryService(
            agencyUserId,
            categoryId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: category,
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

export const getAgencycategories = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const categories = await getCategoriesService(
            agencyUserId
        );

        return res.status(200).json({
            success: true,
            count: categories.length,
            data: categories,
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
