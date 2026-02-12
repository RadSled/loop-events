import express from "express"
import dotenv from "dotenv"

dotenv.config()

const app = express()

app.get("/oauth/callback", (req, res) => {
  const code = req.query.code

  if (!code) {
    res.status(400).send("Missing ?code")
    return
  }

  res.send(`
    <h1>Loop Events OAuth received</h1>
    <p>Code received. You can close this tab.</p>
    <pre style="padding:12px;background:#f3f3f3;border-radius:8px">${code}</pre>
  `)
})

app.get("/", (req, res) => {
  res.send("OAuth server running. Try /oauth/callback?code=123")
})

const port = process.env.OAUTH_PORT || 8787
app.listen(port, () => {
  console.log(`OAuth server listening on http://localhost:${port}`)
})
