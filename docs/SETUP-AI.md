# Turning on the AI features (one-time setup, about 15 minutes)

The website works without this. These steps switch on:
- **सल्लाह (Ask a question)**: AI answers for the public, paid from **your** Anthropic account, with a daily limit.
- **वकिल (Find a lawyer)**: lawyer directory, lawyer sign-up and consultation requests.
- **AI सहायक (AI assistant)** for lawyers, using an access code you give them.
- **सञ्चालक प्यानल (Admin)** at `#/admin`.

Lawyers can always use the AI assistant and AI drafting with **their own** Anthropic key, without any of this.

## 1. Anthropic API key (pays for the AI answers)
1. Go to https://console.anthropic.com, sign up, and add a payment method / credits.
2. **Settings → Limits**: set a **monthly spend limit** you are comfortable with (e.g. $20). This is your hard safety cap.
3. **API Keys → Create Key**, and copy it (`sk-ant-…`).

Cost guide: about $0.03–0.10 per public answer and $0.10–0.50 per lawyer-assistant answer. The site also stops after
**200 answers per day** in total (change `DAILY_LIMIT` in `worker/wrangler.toml`), **15 per visitor per day**, and
**40 per lawyer access code per day**.

## 2. Cloudflare (free; runs the small AI server)
1. Sign up at https://dash.cloudflare.com (the free plan is enough).
2. Copy your **Account ID**: it's on the right side of the Workers & Pages overview page.
3. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template → Continue → Create**. Copy the token.

## 3. Put the four secrets into GitHub
In the repository: **Settings → Secrets and variables → Actions → New repository secret**, four times:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the `sk-ant-…` key from step 1 |
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 2 |
| `ADMIN_PASSWORD` | a long password you choose, for the admin page |

## 4. Run it
**Actions → Daily court update → Run workflow.** The run deploys the AI server and connects the website to it.
After that, the AI features appear on the site within a few minutes and stay on.

## Using the admin page
Open `https://<your-site>/#/admin` and enter `ADMIN_PASSWORD`. There you can:
- **Approve lawyers.** Check their licence number with the Nepal Bar Council first. On approval you get a one-time
  **access code**; send it to the lawyer so they can use the AI assistant.
- **See consultation requests** (name, phone, problem) and mark them done. Requests are deleted automatically after 180 days.
- **See today's AI usage** against the daily limit.

## Privacy
- Public questions and lawyer requests are sent to Anthropic to generate answers. The site asks people not to include
  personal details, and lawyers' client names can be hidden automatically before sending.
- Consultation requests and lawyer sign-ups are stored in your Cloudflare account (Workers KV).
- Your API key stays in GitHub/Cloudflare secrets and is never sent to visitors' browsers.
