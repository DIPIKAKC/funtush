import type { Request, Response } from "express";
import { agencyCustomerListService } from "src/services/agencyCustomer.service.js";

export const getAgencyCustomers = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.agencyId;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await agencyCustomerListService(
      agencyId,
      req.query
    );

    return res.status(200).json({
      success: true,
      result,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error,
    });
  }
};

