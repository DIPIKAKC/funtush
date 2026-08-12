import cron from "node-cron";
import { expireUnpaidBookings } from "../services/payment.service";

export const startExpireUnpaidBookingsCron = () => {

    /** Every 15 minutes — release slots on unpaid bookings past their 48h payment window */
    cron.schedule("*/15 * * * *", async () => {
        try {

            await expireUnpaidBookings();

            console.log("Expire unpaid bookings job ran successfully");

        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}