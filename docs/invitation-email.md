# Invitation email deployment

`supabase/functions/send-invitation` is a server-to-server mail adapter. It accepts one `{to, subject, text}` JSON message per authenticated POST and sends plain text via Resend. It does not create Supabase Auth users or memberships. The Worker and PostgreSQL remain responsible for organization invitations and authorization.

## Prerequisites and secrets

Verify a sending domain in Resend and create a sending API key, preferably restricted to that domain. Configure these secrets in the target project's Supabase dashboard under Edge Functions → Secrets:

| Name | Value |
| --- | --- |
| `INVITATION_DELIVERY_TOKEN` | A cryptographically random shared secret (at least 32 random bytes), also configured on the Worker |
| `RESEND_API_KEY` | Resend API key |
| `INVITATION_FROM_EMAIL` | Sender on your verified domain, such as `Burnrate <invitations@example.com>` |

Use a password manager/secure secret provisioning tool. Do not put real values in repository files, CLI arguments, chat, or logs. Supabase Auth's SMTP settings are separate; this function calls the Resend API directly.

## Deployment

From the repository root, use an authenticated Supabase CLI with access to the intended project. The existing `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` operator/CI variables can be supplied securely:

```sh
npx supabase functions deploy send-invitation --project-ref "$SUPABASE_PROJECT_ID" --use-api
```

The committed `supabase/config.toml` sets `verify_jwt = false` for this function. Keep this setting: the caller uses the separate shared bearer secret, not a Supabase user JWT. The handler checks the secret before processing the body or calling Resend. No database migration or service-role key is required for this function. Deploying the Worker does not deploy Edge Functions; deploy this separately.

On Cloudflare, configure:

| Setting | Value |
| --- | --- |
| `INVITATION_DELIVERY_URL` | `https://<project-ref>.supabase.co/functions/v1/send-invitation` |
| `INVITATION_DELIVERY_TOKEN` (secret) | Exactly the same shared secret configured on Supabase |

## Verification and failures

`npm test` exercises authorization, body/field validation, provider acceptance/rejection, timeouts/network failures, and safe responses using mocked delivery. It sends no real email. After deployment, create an invitation to an approved test recipient from organization settings and verify receipt and acceptance. Do not use a production recipient merely for an automated smoke check.

HTTP 200 means Resend accepted the message and returned an email ID; it does not guarantee inbox delivery. Monitor bounces/delivery in Resend. Invalid credentials return 401; missing configuration returns 503; invalid requests return 400/413/415/405; provider rejection, malformed response, timeout, or network failure returns 502. Responses never include provider details, tokens, or the email body. Requests have a 16 KiB body limit, one recipient, a 200-character subject limit, a 10,000-character text limit, and an eight-second provider timeout (inside the Worker's ten-second delivery timeout).

The Worker reports delivery failure while retaining the invitation for resend/revoke. Resending rotates its one-time token. A timeout can occur after the provider accepted a message; a subsequent resend can produce another email, and only the newest invitation link is valid. There are no automatic retries in the adapter.
