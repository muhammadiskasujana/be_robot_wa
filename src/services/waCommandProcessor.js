export function commandRequestError(error) {
    const response = error.response;
    if (!response) return error.message;
    const code = typeof response.data?.error === "string" ? response.data.error : "gateway_error";
    const details = response.data?.details;
    const connection = details ? `; hasClient=${Boolean(details.hasClient)}; connectionState=${details.connectionState}; socketOpen=${Boolean(details.socketOpen)}` : "";
    return `${error.message}: ${code}${connection}`;
}

export function createCommandProcessor({ events, instances, config, execution, handleIncoming, gatewayRequest, pause }) {
    return async function processEvent(job) {
        const row = await events.findByPk(job.data.eventId);
        if (!row) throw new Error("Command event missing");
        if (["done", "sent", "failed", "unknown"].includes(row.status)) return row.result;
        if (row.status === "processing") {
            await row.update({ status: "unknown", error: "Worker interrupted during execution; inspect before any manual replay" });
            throw new Error("Interrupted command requires review");
        }
        if (row.provider !== config.provider || (row.provider === "baileys" && row.instance_key !== config.sessionId)) {
            await row.update({ status: "failed", error: "Provider/session changed before queue drained" });
            return;
        }
        const [claimed] = await events.update({ status: "processing" }, { where: { id: row.id, status: "queued" } });
        if (!claimed) return;
        try {
            if (row.direction === "in") {
                const instance = row.provider === "greenapi" ? await instances.findOne({
                    where: { id_instance: row.instance_key, is_active: true },
                }) : { provider: "baileys" };
                if (!instance || (row.provider === "greenapi" && !instance.meta?.roles?.includes("BOT"))) throw new Error("Command instance inactive or missing BOT role");
                await execution.run({ id: row.id, sequence: 0 }, () => handleIncoming({ instance, webhook: row.payload }));
                await row.update({ status: "done" });
                return;
            }
            let result;
            // Retry inside this job to keep later sends behind it. Only pre-send 503 is safe.
            for (let attempt = 0; ; attempt++) {
                try {
                    result = await gatewayRequest("send", { ...row.payload, request_id: `command-${row.id}` });
                    break;
                } catch (error) {
                    if (error.response?.status !== 503 || error.response?.data?.error !== "SESSION_NOT_CONNECTED" || attempt >= 2) throw error;
                    await pause(1000 * (attempt + 1));
                }
            }
            if (!result?.idMessage) throw new Error("Gateway returned no WhatsApp message ID");
            await row.update({ status: "sent", result });
            await pause(Number(process.env.WA_COMMAND_SEND_INTERVAL_MS || 1000));
        } catch (error) {
            const definitelyUnsent = error.response?.status === 503 && error.response?.data?.error === "SESSION_NOT_CONNECTED";
            await row.update({ status: definitelyUnsent ? "failed" : "unknown", error: commandRequestError(error) });
            throw error;
        }
    };
}
