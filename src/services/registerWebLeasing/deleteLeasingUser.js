import axios from "axios";

const BASE_URL =
    process.env.FINANCE_API_BASE || "https://finance.digitalmanager.id";

/**
 * Delete leasing user by phone number
 */
export async function deleteLeasingUser({ phoneNumber }) {
    if (!phoneNumber) {
        return { ok: false, error: "phoneNumber kosong" };
    }

    const url = `${BASE_URL}/api/internal/user`;

    const res = await axios.delete(url, {
        params: { phoneNumber },
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
        return {
            ok: true,
            status: res.status,
            data: res.data,
        };
    }

    return {
        ok: false,
        status: res.status,
        error:
            res?.data?.message ||
            res?.data?.error ||
            `Delete user gagal (${res.status})`,
        data: res.data,
    };
}