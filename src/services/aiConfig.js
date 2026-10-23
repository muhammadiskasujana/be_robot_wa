export function aiConfig(env = process.env) {
  const config = {
    sessionId: env.WA_AI_GATEWAY_SESSION_ID,
    tenant: env.WA_AI_GATEWAY_TENANT,
    secret: env.WA_AI_GATEWAY_WEBHOOK_SECRET,
    baseURL: (env.WA_AI_GATEWAY_BASE_URL || '').replace(/\/$/, ''),
    token: env.WA_AI_GATEWAY_TOKEN,
    agentURL: (env.LLM_AGENT_BASE_URL || '').replace(/\/$/, ''),
    apiKey: env.LLM_AGENT_API_KEY,
  };
  if (config.sessionId && config.sessionId === env.WA_COMMAND_GATEWAY_SESSION_ID) throw new Error('AI session must differ from command session');
  const reserved = [env.NOTIF_SESSIONS, env.TARIKAN_NOTIF_SESSIONS, env.WA_COMMAND_RESERVED_SESSIONS]
    .filter(Boolean).flatMap(value => value.split(',').map(item => item.trim()));
  if (config.sessionId && reserved.includes(config.sessionId)) throw new Error('AI session must differ from notification sessions');
  return config;
}
