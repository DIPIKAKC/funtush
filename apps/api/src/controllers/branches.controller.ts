import type { Request, Response } from "express";
import { createBranchService, getBranchesService, updateBranchService } from "src/services/branches.service";

export const createBranch = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const branch = await createBranchService(
            agencyUserId,
            req.body
        );

        return res.status(201).json({
            success: true,
            data: branch,
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

export const updateBranch = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const branchId = req.params.id as string;

        const branch = await updateBranchService(
            agencyUserId,
            branchId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: branch,
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

export const getAgencyBranches = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const branches = await getBranchesService(
            agencyUserId
        );

        return res.status(200).json({
            success: true,
            count: branches.length,
            data: branches,
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

