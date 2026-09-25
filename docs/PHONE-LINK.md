# Orin Code phone link

The phone-link path is split into three trust boundaries:

1. The desktop obtains a Core device access token with `code:use`. It calls
   `/api/pc-link` with that bearer token.
2. Telegram sends updates only to `/api/telegram` or `/api/telegram-code` with
   the configured `TELEGRAM_WEBHOOK_SECRET` header. Bot-only actions use the
   server-only `ORIN_PC_LINK_SECRET` header; no secret is accepted in JSON.
3. A queued task is returned only to the registered machine. Core signs a
   short-lived HMAC grant with a per-PC device secret delivered during the
   authenticated link-start response. The desktop stores that secret in its OS
   credential manager and verifies the task ID, machine ID, instruction hash,
   expiry, and allowed-tool list before accepting the task.

The grant does not bypass approvals. Every mutating file, shell, service, MCP,
or computer-control action still produces an individual approval request. The
grant proves that the task came from the user's confirmed phone flow; it is
not a blanket `autoApprove` flag.

## Required deployment secrets

- `TELEGRAM_CODE_BOT_TOKEN`: Bot API token for the Orin Code bot.
- `TELEGRAM_WEBHOOK_SECRET`: Telegram webhook secret-token header value.
- `ORIN_PC_LINK_SECRET`: at least 32 random characters for authenticated bot
  actions.

Never commit these values. Configure the Telegram webhook to POST to one of
the two authenticated Telegram routes. If any secret is missing, the routes
fail closed rather than falling back to the old body-secret protocol.
