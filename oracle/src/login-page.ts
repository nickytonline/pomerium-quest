// The Oracle's sign-in page. It accepts any email: the domain decides what the player can
// reach in the game (kingdom.com citizens get into town; anyone else is turned away).

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function loginPage(uid: string, error = '') {
  const action = `/interaction/${encodeURIComponent(uid)}/login`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Oracle · Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=Pixelify+Sans:wght@700&display=swap">
<style>
  :root { color-scheme: dark; --night: #15102a; --panel: #1d1736; --edge: #6d3fc4; --ink: #f3ecff; --muted: #a99ecb; --violet: #8b5cf6; --sun: #ffd86b; --deny: #ff5d73; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    background: radial-gradient(circle at 50% 30%, #3a1f63, var(--night) 65%); color: var(--ink);
    font-family: 'IBM Plex Sans', system-ui, sans-serif; }
  main { width: min(420px, 100%); padding: 28px 24px; background: var(--panel); border: 2px solid var(--edge);
    border-radius: 10px; box-shadow: 0 0 60px rgb(139 92 246 / 0.35); }
  h1 { margin: 0 0 6px; font-family: 'Pixelify Sans', monospace; color: var(--sun); font-size: 1.9rem; }
  p { margin: 0 0 16px; color: var(--muted); line-height: 1.5; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--edge); background: #0e0a1d;
    color: var(--ink); font: inherit; }
  button { margin-top: 14px; width: 100%; padding: 11px; border: 0; border-radius: 6px; background: var(--violet);
    color: white; font: inherit; font-weight: 600; cursor: pointer; }
  .error { color: var(--deny); }
  small { display: block; margin-top: 14px; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>The Oracle</h1>
  <p>I am this kingdom's identity provider. Tell me who you are, and I will vouch for you to Pomerium with signed claims.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="${action}">
    <label for="email">Your email</label>
    <input id="email" name="email" type="email" value="hero@kingdom.com" autocomplete="email" required autofocus>
    <button type="submit">Sign in</button>
  </form>
  <small>Any address works. Citizens of kingdom.com can enter the town; try another domain to watch its gate refuse you. This page stands in for Google, Okta or GitHub, and there is no password.</small>
</main>
</body>
</html>`
}
