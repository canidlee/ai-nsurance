# AI-nsurance — Deploy Guide

## File Structure
```
ainsurance/
├── index.html              ← Homepage
├── netlify.toml            ← Netlify config (clean URLs + security headers)
├── css/
│   └── style.css           ← Shared styles
├── js/
│   └── components.js       ← Shared nav + footer
└── pages/
    ├── how-it-works.html
    ├── sample-report.html
    ├── get-my-review.html  ← Stripe link lives here
    └── about.html
```

---

## Step 1 — Push to GitHub

Open your terminal and run:

```bash
# Clone your existing repo
git clone https://github.com/canidlee/ai-nsurance.git
cd ai-nsurance

# Copy all files from the ainsurance/ folder into your repo root
# (Drag the files in Finder, or use cp -r)

git add .
git commit -m "Initial site launch"
git push origin main
```

---

## Step 2 — Connect Netlify to GitHub

1. Go to **[app.netlify.com](https://app.netlify.com)**
2. Click **"Add new site" → "Import an existing project"**
3. Choose **GitHub** → select `canidlee/ai-nsurance`
4. Build settings:
   - **Base directory:** *(leave blank)*
   - **Build command:** *(leave blank — no build needed)*
   - **Publish directory:** `/` *(or leave blank)*
5. Click **"Deploy site"**

Netlify will deploy in ~30 seconds. You'll get a URL like `https://random-name-123.netlify.app`.

---

## Step 3 — Set a Custom Domain (Optional)

1. In Netlify: **Site settings → Domain management → Add custom domain**
2. Enter your domain (e.g. `ai-nsurance.com`)
3. Update your domain's DNS nameservers to Netlify's (they'll show you exactly what to change)
4. Netlify provisions SSL automatically — no setup needed

---

## Step 4 — Update Your Stripe Link

Your Stripe payment link is already wired into two places:
- `/pages/get-my-review.html` — the main CTA button
- `/pages/sample-report.html` — the bottom CTA banner

When you create new pricing tiers, search for `buy.stripe.com` in those files to find and replace.

**Current link:** `https://buy.stripe.com/fZu00l3QWecR8UK4tMbAs04`

---

## Step 5 — Future Deploys (Auto)

Once connected, **every `git push` auto-deploys** to Netlify. No manual steps needed.

```bash
# Make a change, then:
git add .
git commit -m "Update copy on homepage"
git push
# → Live in ~30 seconds
```

---

## Stripe Tips

- To add a second or third pricing tier later: go to **Stripe Dashboard → Payment Links → Create new**
- Match the link in `get-my-review.html` for each tier's button
- For the free lead magnet form: wire it to **Mailchimp, ConvertKit, or Beehiiv** — add their embed script to `get-my-review.html`

---

## Pages Summary

| Page | URL | Purpose |
|------|-----|---------|
| Homepage | `/` | Hero, proof, how-it-works, testimonials, magnet |
| How It Works | `/pages/how-it-works.html` | 3-step process detail |
| Sample Report | `/pages/sample-report.html` | Full auto policy example → converts to paid |
| Get My Review | `/pages/get-my-review.html` | Free form + Stripe payment |
| About | `/pages/about.html` | Mission, values, giving story |
