/**
 * VORPEX NEXUS — Discord OAuth token exchange
 * -------------------------------------------
 * WHY THIS FILE HAS TO EXIST SEPARATELY FROM THE WEBSITE:
 * Discord's Authorization Code flow requires a `client_secret`
 * to exchange the code for an access token. A client secret
 * must never be shipped in front-end JavaScript (anyone could
 * read it from the page source and impersonate your app), so
 * this one small step has to run on a server you control.
 *
 * This file is written for Vercel's Node serverless functions,
 * which is a free, zero-config way to host just this one
 * endpoint without running a full server. Steps:
 *
 *   1. Create a new GitHub repo containing ONLY this /api folder
 *      (or add it alongside a Vercel project).
 *   2. In the Discord Developer Portal, create an application,
 *      copy the Client ID + Client Secret, and add this exact
 *      redirect URI under OAuth2 → Redirects:
 *        https://yoursite.example.com/auth/callback.html
 *   3. In Vercel, set two environment variables on the project:
 *        DISCORD_CLIENT_ID
 *        DISCORD_CLIENT_SECRET
 *   4. Deploy. Vercel gives you a URL like
 *        https://your-project.vercel.app/api/discord-callback
 *      Put that exact URL into DISCORD_TOKEN_ENDPOINT in
 *      /js/auth.js on the main site.
 *
 * You can swap this for Netlify Functions or Cloudflare Workers
 * with only minor syntax changes — the OAuth logic is identical.
 */

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    var CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    var CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
        return res.status(500).json({ error: "Server is missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET env vars." });
    }

    var body = req.body || {};
    var code = body.code;
    var redirectUri = body.redirect_uri;

    if (!code || !redirectUri) {
        return res.status(400).json({ error: "Missing code or redirect_uri." });
    }

    try {
        var tokenResp = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: "authorization_code",
                code: code,
                redirect_uri: redirectUri,
            }),
        });

        if (!tokenResp.ok) {
            var errText = await tokenResp.text();
            return res.status(400).json({ error: "Discord token exchange failed", detail: errText });
        }

        var tokenData = await tokenResp.json();

        var userResp = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: "Bearer " + tokenData.access_token },
        });

        if (!userResp.ok) {
            return res.status(400).json({ error: "Failed to fetch Discord profile" });
        }

        var user = await userResp.json();

        // Only return what the front end actually needs — never
        // forward the access/refresh tokens to the browser.
        return res.status(200).json({
            id: user.id,
            username: user.username,
            global_name: user.global_name,
            avatar: user.avatar,
            email: user.email || null,
        });
    } catch (err) {
        return res.status(500).json({ error: "Unexpected server error", detail: String(err) });
    }
};
