export function aiConfig(env = process.env) {
  const provider = env.WA_AI_PROVIDER || 'baileys';
  if (!['baileys', 'bawa'].includes(provider)) throw new Error('Invalid WA_AI_PROVIDER');
  const config = {
    provider,
    sessionId: provider === 'bawa' ? env.WA_AI_BAWA_INSTANCE_ID : env.WA_AI_GATEWAY_SESSION_ID,
    tenant: env.WA_AI_GATEWAY_TENANT,
    secret: provider === 'bawa' ? env.WA_AI_BAWA_WEBHOOK_SECRET : env.WA_AI_GATEWAY_WEBHOOK_SECRET,
    baseURL: (provider === 'bawa' ? env.WA_AI_BAWA_BASE_URL || 'https://api-gateway.intelixstudio.tech' : env.WA_AI_GATEWAY_BASE_URL || '').replace(/\/$/, ''),
    token: provider === 'bawa' ? env.WA_AI_BAWA_TOKEN : env.WA_AI_GATEWAY_TOKEN,
    agentURL: (env.LLM_AGENT_BASE_URL || '').replace(/\/$/, ''),
    apiKey: env.LLM_AGENT_API_KEY,
  };
  if (config.sessionId && [env.WA_COMMAND_GATEWAY_SESSION_ID, env.WA_COMMAND_BAWA_INSTANCE_ID].includes(config.sessionId)) throw new Error('AI session must differ from command session');
  const reserved = [env.NOTIF_SESSIONS, env.TARIKAN_NOTIF_SESSIONS, env.WA_COMMAND_RESERVED_SESSIONS, env.NOTIF_BAWA_INSTANCE_ID, env.TARIKAN_NOTIF_BAWA_INSTANCE_ID]
    .filter(Boolean).flatMap(value => value.split(',').map(item => item.trim()));
  if (config.sessionId && reserved.includes(config.sessionId)) throw new Error('AI session must differ from notification sessions');
  return config;
}
