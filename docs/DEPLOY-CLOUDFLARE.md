# Deploying the family-play pairing function to Cloudflare

What this sets up: a tiny Cloudflare Worker that lets the TV and the grandparents' laptop find each other from a
five-letter room code. See [ONLINE.md](ONLINE.md) for how family play works. You need a free Cloudflare account
(https://dash.cloudflare.com/sign-up). Nothing here costs money to set up; the Worker and its rooms are tiny, but
check Cloudflare's current pricing and your dashboard usage after the first evenings, because plans change.

Pick one: **A** deploys once from your computer, **B** deploys automatically from GitHub every time
`cloudflare/` changes. B is the one to keep; do the one-time step first either way.

## One-time: give your account a workers.dev name

Workers live at `https://<worker-name>.<your-name>.workers.dev`. The first time, Cloudflare asks you to pick
`<your-name>`.

1. Cloudflare dashboard > **Workers & Pages**.
2. If it asks you to choose a subdomain (your `workers.dev` name), pick one and confirm.

## A. Deploy once from your computer

You need Node.js 22 or newer.

```
cd cloudflare
npx wrangler login      # opens the browser to sign in to Cloudflare
npx wrangler deploy
```

It prints the address, like `https://kids-camera-game-pairing.<your-name>.workers.dev`. Skip to
**Point the game at it**.

## B. Deploy automatically with GitHub Actions

The workflow is `.github/workflows/pairing.yml`. It runs whenever something in `cloudflare/` changes on `main`
(and by hand: Actions > Deploy pairing function > Run workflow). Without the secrets below it just says so and stops.

1. **Create an API token.** Cloudflare dashboard > your profile (top right) > **API Tokens** > **Create Token** >
   use the **Edit Cloudflare Workers** template > continue > **Create Token**. Copy the token now; it is shown once.
2. **Find your Account ID.** Dashboard > **Workers & Pages**; the Account ID is on the right-hand side (or in the
   address bar after `dash.cloudflare.com/`).
3. **Add them to GitHub.** Repository **Settings > Secrets and variables > Actions > New repository secret**:

   | Secret name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 2 |

4. **Run it.** Actions > **Deploy pairing function** > **Run workflow**. When it finishes, the run's summary shows
   the address of your Worker (`https://kids-camera-game-pairing.<your-name>.workers.dev`).

## Point the game at it

The published game needs to know the Worker's address. Add it as a repository **variable** (not a secret; it is
public anyway):

**Settings > Secrets and variables > Actions > Variables tab > New repository variable**

| Variable name | Value |
|---|---|
| `PAIRING_URL` | the address from the deploy, e.g. `https://kids-camera-game-pairing.<your-name>.workers.dev` |

The next run of **Check and publish** (push to `main`, or Actions > Check and publish > Run workflow) writes it into
the published game. It must start with `https://`; the publish step stops with a clear message if it does not.

Without `PAIRING_URL` the game still works; family play then pairs two windows on one computer only.
(For running it yourself without GitHub Pages, edit `SIGNAL_URL` in `src/online-config.js`.)

## Try it

1. On the TV open the game, press **O** (or tap **Family** in the menu). It shows a room code and a link.
2. On the other computer open the link (or `<game address>?room=CODE`) and allow the camera and microphone.
3. The host's screen shows "connected" with the round-trip time in milliseconds.

## Optional: the relay for tricky home networks

Most homes connect directly. For the roughly one in ten whose router blocks that, a relay (TURN) carries the video.

1. Cloudflare dashboard > **Realtime** > **TURN** > create a TURN key. Note its **Key ID** and **API token**.
2. Add two more GitHub secrets: `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`.
3. Run **Deploy pairing function** again. When both secrets are set it stores them on the Worker, which then hands
   out short-lived relay credentials to the browsers (the token itself never reaches a browser).

## Checking it works / troubleshooting

- Open `https://<your worker>/ice` in a browser: it should show a JSON list of servers (with a `turn:` entry once
  the relay is set up).
- The host's screen says "reaching the pairing service..." for more than a few seconds: the game has no or a wrong
  address. Check the `PAIRING_URL` variable and that **Check and publish** ran after you set it.
- The guest keeps saying "Looking for family room": the code is wrong, or the host has not opened the room (the
  host must press O first), or someone is already in that room as the guest.
- The workflow says to add secrets: the two `CLOUDFLARE_*` secrets are missing or misspelt.
- The workflow fails with an authentication error: the token was created from another template or has expired;
  create a new one with **Edit Cloudflare Workers**.
- Run the Worker on your own computer instead: `cd cloudflare && npx wrangler dev`, then open the game with
  `?signal=http://127.0.0.1:8787`.
