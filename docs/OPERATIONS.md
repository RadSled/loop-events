# Loop Events Operations

## Critical infrastructure

- Runtime API/OAuth/Billing backend: Render service at `https://loop-events.onrender.com`
- Data/auth provider: Supabase project configured through `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_ANON_KEY`
- Payments: Stripe keys and webhook secret configured through environment variables

## Required access controls

- Restrict Render dashboard access to least privilege roles only
- Enforce MFA for all maintainers with Render, Supabase, Stripe, and GitHub access
- Keep all secrets in platform environment variables (never commit to repo)

## Monitoring and alerting

- Enable Render health check monitoring for `/health`
- Enable Render alert notifications for deploy failures and service downtime
- Monitor error rate and 5xx spikes for `/api/*` endpoints

## Logging controls

- Do not log full bearer tokens, refresh tokens, OAuth codes, or raw authorization headers
- Keep OAuth callback logs minimal and non-sensitive
- Review log retention periodically and remove historical sensitive output if discovered

## Credential rotation procedure

Perform rotation immediately if a deployment or environment has been exposed.

1. Rotate `SUPABASE_ANON_KEY`
2. Rotate `SUPABASE_SECRET_KEY`
3. Rotate `STRIPE_SECRET_KEY`
4. Rotate `STRIPE_WEBHOOK_SECRET`
5. Rotate `WEBFLOW_CLIENT_SECRET`
6. Update Render environment variables
7. Redeploy backend and rebuild/re-upload extension bundle
8. Validate OAuth login, billing checkout, and schedule operations
