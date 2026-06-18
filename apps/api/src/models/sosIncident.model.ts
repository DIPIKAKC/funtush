import { ObjectId } from "mongodb";
import { getMongo } from "../lib/mongo";

/**
 * SOS incident tracking for trekker safety. Stored in MongoDB so the
 * live feed and history are fast to query and the timeline is append-only.
 */

export const SOS_STATUSES = ["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"] as const;
export type SosStatus = typeof SOS_STATUSES[number];

export interface SosTimelineEntry {
  at:      Date;
  event:   string;          //  "TRIGGERED", "ACKNOWLEDGED", "NOTE_ADDED", "RESOLVED"
  actor:   string;          // who caused it (trekker id, agency id, admin id)
  detail?: string;
}

export interface SosIncident {
  _id?:            ObjectId;
  agency_id:       string;
  agency_name:     string;
  guide_id:        string | null;
  guide_name:      string | null;
  trekker_id:      string;
  trekker_name:    string;
  coordinates:     { lat: number; lng: number };
  status:          SosStatus;
  triggered_at:    Date;
  acknowledged_at: Date | null;
  resolved_at:     Date | null;
  resolution:      string | null;
  admin_notes:     Array<{ at: Date; admin_id: string; note: string }>;
  timeline:        SosTimelineEntry[];
}

export async function getSosCollection() {
  const db = await getMongo();
  return db.collection<SosIncident>("sos_incidents");
}

export async function ensureSosIndexes(): Promise<void> {
  try {
    const col = await getSosCollection();
    await col.createIndex({ status: 1, triggered_at: -1 });
    await col.createIndex({ agency_id: 1, triggered_at: -1 });
    await col.createIndex({ triggered_at: -1 });
    console.log("[SOS] MongoDB indexes ensured");
  } catch (err) {
    console.error("[SOS] Failed to ensure indexes:", err);
  }
}

// Acknowledgment SLA: agencies must acknowledge within 15 minutes
export const ACK_SLA_MINUTES = 15;
