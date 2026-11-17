# Turning on the AI features: free (one-time setup, about 10 minutes)

The website works without this. These steps switch on:
- **सल्लाह (Ask a question)**: AI answers for the public.
- **वकिल (Find a lawyer)**: lawyer directory, lawyer sign-up and consultation requests.
- **AI सहायक (AI assistant)** and **AI drafting** for lawyers, using an access code you give them.
- **सञ्चालक प्यानल (Admin)** at `#/admin`.

## Cost: free
The AI runs on **Cloudflare Workers AI** with the model `@cf/qwen/qwen3-30b-a3b-fp8`. On the **Workers Free plan** you get
**10,000 Neurons per day free**, roughly 100 or more answers. When the day's allowance is used up, AI answers stop until
00:00 UTC (5:45 AM Nepal time). Cloudflare **does not charge** on the Free plan. No credit card is needed.

> Keep the Cloudflare account on the **Free** plan. If you ever upgrade to Workers Paid, use beyond the free allowance
> would be billed.

The site also limits itself: **100 answers/day** in total (`DAILY_LIMIT` in `worker/wrangler.toml`), 15 per visitor and
40 per lawyer access code.

**Quality note:** this free model is smaller than paid models. Its Nepali legal writing is weaker, and it can make
mistakes. Every answer shows its sources, and references outside them are flagged in red. Lawyers must check everything.

## 1. Cloudflare account (free)
1. Sign up at https://dash.cloudflare.com (choose the Free plan).
2. Open **Workers & Pages** once, so that Workers is enabled. Copy your **Account ID** from the right side of that page.
3. **My Profile → API Tokens → Create Token**. Use the **"Edit Cloudflare Workers"** template, then **Continue → Create Token**.
   Copy the token.

## 2. Put three secrets into GitHub
In the repository: **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 1 |
| `ADMIN_PASSWORD` | a long password you choose, for the admin page |

## 3. Run it
**Actions → Daily court update → Run workflow.** The run deploys the AI server and connects the website to it.
The AI features appear on the site a few minutes later.

## Using the admin page
Open `https://<your-site>/#/admin` and enter `ADMIN_PASSWORD`. There you can:
- **Approve lawyers.** Check their licence number with the Nepal Bar Council first. On approval you get an **access code**;
  send it to the lawyer. They paste it into AI सहायक / मस्यौदा.
- **See consultation requests** (name, phone, problem) and mark them done. Requests are deleted automatically after 180 days.
- **See today's AI usage.**

## Optional later: better quality (paid)
Adding a fourth secret, `ANTHROPIC_API_KEY` (from console.anthropic.com, with credit), switches the site's AI to Claude
(`claude-opus-5-5`) for stronger Nepali legal writing. This costs about $0.03–0.10 per public answer; set a monthly spend
limit in the Anthropic console. Remove the secret to go back to free. Individual lawyers can also paste their own Anthropic
key in AI सहायक / मस्यौदा without any of this.

## Privacy
- Questions are sent to the AI service (Cloudflare Workers AI, or Anthropic if you enable it) to generate answers.
  The site asks people not to include personal details, and lawyers' client names can be hidden automatically.
- Consultation requests and lawyer sign-ups are stored in your Cloudflare account (Workers KV).
- Secrets stay in GitHub/Cloudflare and are never sent to visitors' browsers.
