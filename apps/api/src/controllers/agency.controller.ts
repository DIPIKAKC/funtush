import type { Request, Response } from "express";
import { agencySubscription, createAgency, getSubscription } from "../services/agency.service";
import type { AgencyRequest } from "../types/auth-request";

export const registerAcency = async (req: Request, res: Response) => {
    try {
        const newAgency = await createAgency(req.body);
        res.status(201).json({
            status: "success",
            data: newAgency
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};

export const getSubscriptionTiers = async (req: Request, res: Response) => {
    try {
        const tiers = await getSubscription();
        res.status(200).json({
            status: "success",
            data: tiers
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};

export const updateAgencySubscription = async (req: AgencyRequest, res: Response) => {
    try {
        const agencyId = req.agencyUser?.id;
        const { tier } = req.body;

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await agencySubscription(agencyId, tier);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};