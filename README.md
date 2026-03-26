# What's on DK?

## Local development

- npm i && npm run dev

## Tests

- Run locally:
  - npm i
  - npx playwright install
  - npm run test:e2e
- Open report:
  - npm run test:e2e:report

## Deployment (Netlify)

- Set the GitHub secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` in the currently active repository.
- Keep deploy branch as `main` unless workflow settings are intentionally changed.
- If Netlify Git auto-deploy is also enabled for the same site, disable one deploy path to avoid duplicate production deploys.

## Preview deploys (Netlify)

- Create a feature branch: `git checkout -b feature/your-change`
- Commit and push changes: `git push -u origin feature/your-change`
- Open a PR into `main` → Netlify creates a Preview Deploy automatically (when the Netlify site is linked to this repo).
- Test the Preview URL from the PR or Netlify Deploys.
- Merge the PR when ready → Netlify auto-deploys to production.

## Repo migration

- For migration from one GitHub repo/account to another, follow [MIGRATION_CHECKLIST.md](./MIGRATION_CHECKLIST.md).

## Admin access (Netlify Identity)

- Enable Identity in the Netlify site dashboard.
- Set registration to invite-only.
- Create users and add roles in Identity:
  - `admin` for moderation.
  - `super_admin` for access to rejected events and full moderation view.
- Use `admin-login.html` to sign in. Users without roles will be denied.

## Moderation storage (Netlify Blobs)

- Moderation events and audit logs are stored in Netlify Blobs under the `wod-admin` store.
- Use `netlify dev` if you need local Functions with Blobs support.

### Retention settings (optional env vars)

- `WOD_APPROVED_TTL_DAYS` (default: 180)
- `WOD_REJECTED_TTL_DAYS` (default: 30)
- `WOD_PENDING_TTL_DAYS` (default: 30)
- `WOD_AUDIT_TTL_DAYS` (default: 180)
- `WOD_MAX_EVENTS` (default: 500)
- `WOD_MAX_AUDIT` (default: 1000)
