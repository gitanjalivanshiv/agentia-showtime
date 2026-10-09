# Slack setup (about 5 minutes)

Showtime talks to Slack with **Socket Mode**, so you do not need a public URL, a tunnel or a server.

## 1. Pick a workspace
A free workspace works. A [Slack Developer Program sandbox](https://docs.slack.dev/tools/developer-sandboxes/) is nicer: it is free, has all paid features and lasts 180 days.
Free-plan limits that matter here: up to 10 custom apps, 90 days of visible history, 5 GB of shared file storage. A 60–90 second demo video is a few megabytes.

## 2. Create the app from the manifest
1. Go to <https://api.slack.com/apps> and choose **Create New App → From a manifest**.
2. Pick your workspace and paste the contents of [`slack-app-manifest.yml`](../slack-app-manifest.yml).
3. Review the summary and choose **Create**.

## 3. Get two tokens
- **Bot token** (`xoxb-…`): **OAuth & Permissions → Install to Workspace → Allow**, then copy the *Bot User OAuth Token*.
- **App-level token** (`xapp-…`): **Basic Information → App-Level Tokens → Generate Token and Scopes**, name it `socket`, add the scope `connections:write`, and copy the token.

Put both in a file named `.env` in the project folder (it is git-ignored). Never paste them into chat, issues or commits.

```bash
cp .env.example .env
# then edit .env:
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...
```

## 4. Create two channels and invite the app
- `#uat-reviews` for the business owner. Reviews arrive here.
- `#release` for the release manager. "Approved for release" notices arrive here.

In each channel, type `/invite @Showtime`. The app needs to be a member to upload the video.

## 5. Check it
```bash
agentia showtime doctor
```
The Slack line should read: tokens present, and the connection test passes.

## Who may approve?
By default anyone who can see the message can click **Approve**. To limit it, set `slack.approverIds` in `.showtime/config.json` to a list of Slack member IDs (open a profile → ⋮ → Copy member ID). Everyone else gets a private note instead.

## What Showtime never does
It never promotes or deploys a story. **Approve** records a decision, tells the release channel, and adds a dated note to the story in Copado. The release manager promotes.
