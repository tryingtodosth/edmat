// A local stand-in for Google, Apple, GitHub, Facebook and Microsoft's sign-in endpoints, so the whole "Sign in with
// …" round trip (backend `sso/`) can be driven in a browser on a machine with no client id.
//
//   node e2e/sso-stub.mjs            # listens on SSO_STUB_PORT (default 8049)
//
// The backend uses it only when BOTH `EDMAT_SSO_DEV_STUB_URL=http://localhost:8049` is set AND
// DEBUG is on — `config/settings.py` refuses to start with the variable set and DEBUG off, and
// `sso/providers.py` checks DEBUG again on every read (`sso.tests.DevStubGuardTests`). It signs an
// id_token for anybody who types an address, which is exactly why it must never be reachable from
// a real deployment.
//
// What it does for real, so the browser run exercises the same checks production does:
//   - signs RS256 id_tokens with a key generated at start, published at /jwks;
//   - echoes the `nonce` the backend sent, and checks the PKCE `code_verifier` against the
//     `code_challenge` (S256) on the token request;
//   - Apple answers with an auto-submitted form POST (response_mode=form_post) and a one-time
//     `user` field carrying the name, like the real thing; Google and Microsoft redirect with a query;
//   - "Cancel" returns the provider's own cancel error.
// The page at /<provider>/authorize asks for an email and a subject, so a script can sign in as
// whoever it needs to be (and as the same person twice).

import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const PORT = Number(process.env.SSO_STUB_PORT ?? 8049);
const BASE = `http://localhost:${PORT}`;
const KID = 'stub-1';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };
const codes = new Map(); // code -> { provider, clientId, nonce, email, sub, challenge, redirectUri }
const tokens = new Map(); // access token -> the same entry (GitHub and Facebook have no id_token)
// GitHub's and Facebook's ids are numbers; derive a stable one from whatever "subject" was typed.
const numericId = (sub) =>
	Number.parseInt(createHash('sha256').update(String(sub)).digest('hex').slice(0, 10), 16);

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);

function idToken(entry) {
	const now = Math.floor(Date.now() / 1000);
	const claims = {
		iss: `${BASE}/${entry.provider}`,
		aud: entry.clientId,
		sub: entry.sub,
		iat: now,
		exp: now + 600,
		nonce: entry.nonce,
		email: entry.email
	};
	if (entry.provider === 'google')
		Object.assign(claims, { email_verified: true, name: entry.name });
	if (entry.provider === 'apple') Object.assign(claims, { email_verified: 'true' });
	if (entry.provider === 'microsoft') {
		// A work account in some tenant; xms_edov true so the address counts as verified.
		Object.assign(claims, {
			tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			oid: `oid-${entry.sub}`,
			xms_edov: true,
			name: entry.name
		});
	}
	const head = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
	const body = b64url(JSON.stringify(claims));
	const sig = sign('sha256', Buffer.from(`${head}.${body}`), privateKey);
	return `${head}.${body}.${b64url(sig)}`;
}

function answer(res, provider, redirectUri, params) {
	if (provider === 'apple') {
		const inputs = Object.entries(params)
			.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
			.join('');
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(
			`<!doctype html><form id="f" method="post" action="${esc(redirectUri)}">${inputs}</form><script>document.getElementById('f').submit()</script>`
		);
		return;
	}
	const url = new URL(redirectUri);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	res.writeHead(302, { Location: url.toString() });
	res.end();
}

async function readBody(req) {
	let data = '';
	for await (const chunk of req) data += chunk;
	return new URLSearchParams(data);
}

createServer(async (req, res) => {
	const url = new URL(req.url, BASE);
	const [, provider, action] = url.pathname.split('/');
	try {
		if (url.pathname === '/jwks') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ keys: [jwk] }));
			return;
		}
		if (action === 'authorize') {
			const q = url.searchParams;
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<!doctype html><meta charset="utf-8"><title>Stub ${esc(provider)}</title>
<body style="font-family:sans-serif;max-width:28rem;margin:3rem auto">
<h1>Stub ${esc(provider)} sign-in</h1><p>Development only — signs anybody in.</p>
<form method="get" action="/${esc(provider)}/approve">
${[...q.entries()].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
<label>Email <input name="email" value="stub.person@example.com"></label><br>
<label>Subject <input name="sub" value="stub-subject-1"></label><br>
<label>Name <input name="name" value="Stub Person"></label><br>
<button id="approve" type="submit">Continue</button>
<button id="cancel" type="submit" name="cancel" value="1">Cancel</button>
</form></body>`);
			return;
		}
		if (action === 'approve') {
			const q = url.searchParams;
			const redirectUri = q.get('redirect_uri');
			if (q.get('cancel')) {
				answer(res, provider, redirectUri, {
					state: q.get('state'),
					error: provider === 'apple' ? 'user_cancelled_authorize' : 'access_denied'
				});
				return;
			}
			const code = randomBytes(16).toString('hex');
			const name = q.get('name') ?? '';
			codes.set(code, {
				provider,
				clientId: q.get('client_id'),
				nonce: q.get('nonce'),
				email: q.get('email'),
				sub: q.get('sub'),
				name,
				challenge: q.get('code_challenge'),
				redirectUri
			});
			const params = { code, state: q.get('state') };
			if (provider === 'apple') {
				const [firstName, ...rest] = name.split(' ');
				params.user = JSON.stringify({
					name: { firstName, lastName: rest.join(' ') },
					email: q.get('email')
				});
			}
			answer(res, provider, redirectUri, params);
			return;
		}
		// ---- GitHub and Facebook: OAuth 2.0 with no id_token -------------------------------------
		if ((provider === 'github' || provider === 'facebook') && action === 'token') {
			// GitHub: a POST, answered 200 even on failure ({error}); Facebook: a GET with the query.
			const form = req.method === 'POST' ? await readBody(req) : url.searchParams;
			const entry = codes.get(form.get('code'));
			codes.delete(form.get('code'));
			let error = '';
			if (!entry || entry.provider !== provider) error = 'bad_verification_code';
			else if (form.get('redirect_uri') !== entry.redirectUri) error = 'redirect_uri_mismatch';
			else if (form.get('client_id') !== entry.clientId || !form.get('client_secret'))
				error = 'incorrect_client_credentials';
			else if (entry.challenge) {
				const computed = createHash('sha256')
					.update(form.get('code_verifier') ?? '')
					.digest('base64url');
				if (computed !== entry.challenge) error = 'invalid_grant';
			}
			res.writeHead(error && provider === 'facebook' ? 400 : 200, {
				'Content-Type': 'application/json'
			});
			if (error) {
				res.end(
					JSON.stringify(provider === 'facebook' ? { error: { message: error } } : { error })
				);
				return;
			}
			const access = randomBytes(16).toString('hex');
			tokens.set(access, entry);
			res.end(JSON.stringify({ access_token: access, token_type: 'bearer' }));
			return;
		}
		if (provider === 'github' && (action === 'userinfo' || action === 'emails')) {
			const auth = req.headers.authorization ?? '';
			const entry = tokens.get(auth.replace(/^Bearer /, ''));
			if (!entry || !req.headers['user-agent']) {
				res.writeHead(401);
				res.end('{}');
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify(
					action === 'userinfo'
						? { id: numericId(entry.sub), login: entry.sub, name: entry.name, email: null }
						: [{ email: entry.email, primary: true, verified: true, visibility: 'private' }]
				)
			);
			return;
		}
		if (provider === 'facebook' && action === 'userinfo') {
			const entry = tokens.get(url.searchParams.get('access_token') ?? '');
			if (!entry || !url.searchParams.get('appsecret_proof')) {
				res.writeHead(400);
				res.end('{}');
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({ id: String(numericId(entry.sub)), name: entry.name, email: entry.email })
			);
			return;
		}
		if (action === 'token' && req.method === 'POST') {
			const form = await readBody(req);
			const entry = codes.get(form.get('code'));
			codes.delete(form.get('code'));
			const fail = (why) => {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'invalid_grant', error_description: why }));
			};
			if (!entry || entry.provider !== provider) return fail('unknown code');
			if (form.get('redirect_uri') !== entry.redirectUri) return fail('redirect_uri mismatch');
			if (form.get('client_id') !== entry.clientId) return fail('client_id mismatch');
			if (!form.get('client_secret')) return fail('no client secret');
			if (entry.challenge) {
				const computed = createHash('sha256')
					.update(form.get('code_verifier') ?? '')
					.digest('base64url');
				if (computed !== entry.challenge) return fail('PKCE verifier does not match');
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({ token_type: 'Bearer', access_token: 'stub', id_token: idToken(entry) })
			);
			return;
		}
		res.writeHead(404);
		res.end();
	} catch (err) {
		res.writeHead(500);
		res.end(String(err));
	}
}).listen(PORT, () => console.log(`sso stub on ${BASE}`));
