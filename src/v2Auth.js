const CLIENT_ID = import.meta.env.VITE_DERIV_APP_ID || '1089';
const REDIRECT_URI = 'https://mytrades.beexelgraphics.com/';
const OAUTH_SERVER = 'https://auth.deriv.com';
const API_BASE = 'https://api.derivws.com';

// Local proxy on the cPanel server for token exchange
const PROXY_URL = '/token-exchange.php';

export function generateCodeVerifier() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const loginWithDeriv = async () => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = window.crypto.randomUUID();

  sessionStorage.setItem('code_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', state);

  const authUrl = new URL(`${OAUTH_SERVER}/oauth2/auth`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  window.location.href = authUrl.toString();
};

export const handleOAuthCallback = async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const authorizationCode = urlParams.get('code');
  const returnedState = urlParams.get('state');

  // STEP 1: If we have a code in the URL, submit it to contact.php via HTML form (bypasses AJAX entirely)
  if (authorizationCode) {
    const savedState = sessionStorage.getItem('oauth_state');
    if (returnedState !== savedState) throw new Error('State mismatch: possible CSRF attack');
    const savedVerifier = sessionStorage.getItem('code_verifier');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/contact.php';

    const params = {
      client_id: CLIENT_ID,
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: savedVerifier
    };

    for (const key in params) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = params[key];
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    
    // Return a promise that never resolves so the UI stays in "loading" state until navigation completes
    return new Promise(() => {});
  }

  // STEP 2: If we are returning from contact.php, check for the raw token in sessionStorage
  const rawTokenStr = sessionStorage.getItem('oauth_token_raw');
  if (rawTokenStr) {
    sessionStorage.removeItem('oauth_token_raw');
    sessionStorage.removeItem('code_verifier');
    sessionStorage.removeItem('oauth_state');

    const tokenData = JSON.parse(rawTokenStr);
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('Access token not found in PHP response');

    // Fetch legacy tokens using the access token (for WS compatibility)
    const legacyResponse = await fetch(`${OAUTH_SERVER}/oauth2/legacy/tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (legacyResponse.ok) {
      const legacyTokens = await legacyResponse.json();
      let tokens = { real: '', demo: '' };
      let i = 1;
      while (legacyTokens[`acct${i}`] && legacyTokens[`token${i}`]) {
        const acct = legacyTokens[`acct${i}`];
        const token = legacyTokens[`token${i}`];
        if (acct.startsWith('VRTC')) tokens.demo = token;
        if (acct.startsWith('CR')) tokens.real = token;
        i++;
      }
      return { accessToken, ...tokens, useLegacy: true };
    }

    // Fallback to accounts endpoint
    const accountsResponse = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Deriv-App-ID': CLIENT_ID,
        'Content-Type': 'application/json'
      }
    });

    if (!accountsResponse.ok) {
      throw new Error('Failed to fetch trading accounts.');
    }

    const accountsResult = await accountsResponse.json();
    const accounts = accountsResult.data;

    let demoId = '';
    let realId = '';

    accounts.forEach(acc => {
      if (acc.account_type === 'demo') demoId = acc.account_id;
      if (acc.account_type === 'real') realId = acc.account_id;
    });

    return { accessToken, demoId, realId, useLegacy: false };
  }

  return null;
};

export const getWebSocketOtpUrl = async (accountId, accessToken) => {
  const otpResponse = await fetch(
    `${API_BASE}/trading/v1/options/accounts/${accountId}/otp`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Deriv-App-ID': CLIENT_ID
      }
    }
  );

  if (!otpResponse.ok) throw new Error(`Failed to get OTP for account ${accountId}`);
  const otpData = await otpResponse.json();
  return otpData.data.url;
};
