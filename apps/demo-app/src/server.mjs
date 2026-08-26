/**
 * A deliberately tiny web app for the workspace's own BDD suite to drive.
 *
 * Zero dependencies and no build step: the acceptance suite should fail because
 * the plugin broke, never because this server needed installing or compiling.
 * It exists only to give the shared steps in @willstjohnbacon/nx-bdd/steps
 * something real to click — a labelled login form, a session cookie, a
 * protected page and a link between them.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || '127.0.0.1';

const USERS = new Map([
  ['admin', { password: 'admin', display: 'Ada Admin', role: 'Administrator' }],
  ['viewer', { password: 'viewer', display: 'Vic Viewer', role: 'Viewer' }],
]);

const sessions = new Map();

const page = (title, body) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body>
    <nav><a href="/">Home</a> <a href="/dashboard">Dashboard</a> <a href="/logout">Sign out</a></nav>
    <main>${body}</main>
  </body>
</html>`;

const LOGIN = (error) =>
  page(
    'Sign in',
    `<h1>Sign in</h1>
     ${error ? `<p role="alert">${error}</p>` : ''}
     <form method="post" action="/login">
       <label for="username">Username</label>
       <input id="username" name="username" autocomplete="username" />
       <label for="password">Password</label>
       <input id="password" name="password" type="password" autocomplete="current-password" />
       <button type="submit">Sign in</button>
     </form>`
  );

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(new URLSearchParams(raw)));
  });

const sessionFor = (req) => {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(cookie);
  return match ? sessions.get(match[1]) : undefined;
};

const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { location, ...headers });
  res.end();
};

const html = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && pathname === '/login') {
    const form = await readBody(req);
    const username = form.get('username') ?? '';
    const user = USERS.get(username);

    if (!user || user.password !== form.get('password')) {
      return html(res, 401, LOGIN('Those credentials were not recognised.'));
    }

    const sid = `${username}-${Math.random().toString(36).slice(2)}`;
    sessions.set(sid, { username, ...user });
    return redirect(res, '/dashboard', {
      'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`,
    });
  }

  switch (pathname) {
    case '/':
      return html(res, 200, page('Demo App', '<h1>Demo App</h1><p>An app under test.</p>'));

    case '/login':
      return html(res, 200, LOGIN());

    case '/logout':
      return redirect(res, '/login', {
        'set-cookie': 'sid=; Path=/; Max-Age=0',
      });

    case '/dashboard': {
      const session = sessionFor(req);
      if (!session) {
        return redirect(res, '/login');
      }
      return html(
        res,
        200,
        page(
          'Dashboard',
          `<h1>Dashboard</h1>
           <p>Welcome, ${session.display}.</p>
           <p>Signed in as ${session.role}.</p>`
        )
      );
    }

    default:
      return html(res, 404, page('Not found', '<h1>Not found</h1>'));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`demo-app listening on http://${HOST}:${PORT}`);
});
