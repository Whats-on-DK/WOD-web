# Repository Migration Checklist (GitHub -> GitHub, same Netlify site)

## 1) GitHub (new repo/account)
- Create the new repository and push `main`.
- Recreate repository secrets:
  - `NETLIFY_AUTH_TOKEN`
  - `NETLIFY_SITE_ID`
- Confirm Actions are enabled and `main` remains the deploy branch.

## 2) Netlify (manual UI)
- Reconnect the existing Netlify site to the new GitHub repo.
- Verify production branch is `main`.
- Verify only one deploy path is active:
  - Netlify Git auto-deploy, or
  - GitHub Actions deploy (`deploy.yml`).
- Keep current domain/custom domain mapping unchanged until validation passes.

## 3) Supabase verification (manual UI)
- Keep the same Supabase project.
- Confirm Netlify environment variables still exist on the connected site:
  - `SUPABASE_URL` (or `SUPABASE_PROJECT_URL` / `SUPABASE_DATABASE_URL`)
  - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE`)
- Optional vars to verify if used:
  - `SUPABASE_STORAGE_BUCKET`
  - `SUPABASE_PARTNERS_BUCKET`
  - `WOD_APPROVED_TTL_DAYS`
  - `WOD_REJECTED_TTL_DAYS`
  - `WOD_PENDING_TTL_DAYS`
  - `WOD_AUDIT_TTL_DAYS`
  - `WOD_MAX_EVENTS`
  - `WOD_MAX_AUDIT`

## 4) Post-deploy smoke checks
- Open `/` and confirm event catalog loads.
- Open one event detail page and verify share menu works.
- Open `/admin-login.html` and verify Identity login opens.
- Verify admin access to `/admin-page.html`.
- Verify a read endpoint:
  - `/.netlify/functions/public-events`
- Verify an admin endpoint (authenticated):
  - `/.netlify/functions/admin-events`

## 5) Cutover sequence
- Keep existing production site/domain as-is during first deploy from new repo.
- Validate preview + production deploys from the new repo.
- Only then perform any domain or infra-level changes.

## 6) Rollback
- If issues appear, reconnect Netlify site to the previous GitHub repo.
- Re-run smoke checks.
- Pause migration until env/secrets/branch configuration mismatch is fixed.
