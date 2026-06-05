import type { Request } from "express";

export type AgencyUser = {
  id: string;
  role: string;
  agencyId?: string;
  status?: "ACTIVE" | "LOCKED";
};

export type AgencyRequest = Request & {
  agencyUser?: AgencyUser;
};