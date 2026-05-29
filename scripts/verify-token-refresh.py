#!/usr/bin/env python3
"""
End-to-end script to verify the Token Refresh pipeline.

Workflow:
1. Connect to a logged-in Teams browser via CDP, extract MSAL refresh token and related metadata
2. Use the refresh token to send an HTTP POST to Microsoft's token endpoint to get a new access token
3. Call Graph API (/me) with the new access token to verify it works
4. Report the validity period of the refresh token and access token

Usage:
  python scripts/verify-token-refresh.py

Prerequisites:
  - Edge has been launched with --remote-debugging-port=9222 via OpenKosmos or cdp_connect.py
  - Teams Web is logged in within Edge
  - playwright is installed: pip install playwright
"""

import sys
import os
import json
import time
import base64
import asyncio
import ssl
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Create an SSL context that skips certificate verification
# (needed in corporate networks with proxy/MITM certificates)
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# ── Configuration ──────────────────────────────────────────────────────────

CDP_PORT = 9222
CDP_HOST = "127.0.0.1"
CDP_CONNECT_TIMEOUT = 10  # seconds
EXPECTED_TENANT_ID = "72f988bf-86f1-41af-91ab-2d7cd011db47"
TOKEN_ENDPOINT_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"

# Resources to test refresh for
REFRESH_TARGETS = [
    {
        "name": "Graph API",
        "scope": "https://graph.microsoft.com/.default offline_access",
        "audience_check": "graph.microsoft.com",
        "verify_url": "https://graph.microsoft.com/v1.0/me",
    },
    {
        "name": "Chatsvc (Teams messaging)",
        "scope": "https://chatsvcagg.teams.microsoft.com/.default offline_access",
        "audience_check": "chatsvcagg.teams.microsoft.com",
        "verify_url": None,  # No simple verification endpoint
    },
    {
        "name": "Skype API",
        "scope": "https://api.spaces.skype.com/.default offline_access",
        "audience_check": "api.spaces.skype.com",
        "verify_url": None,
    },
]


# ── JWT helpers ────────────────────────────────────────────────────────────

def decode_jwt_payload(token_str):
    """Decode JWT payload without signature verification."""
    try:
        parts = token_str.split('.')
        if len(parts) != 3:
            return None
        payload = parts[1]
        payload += '=' * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        return json.loads(decoded)
    except Exception:
        return None


def format_expiry(exp_timestamp):
    """Format expiry timestamp to human-readable."""
    now = time.time()
    remaining_sec = max(0, int(exp_timestamp - now))
    hours = remaining_sec // 3600
    minutes = (remaining_sec % 3600) // 60
    secs = remaining_sec % 60
    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    elif minutes > 0:
        return f"{minutes}m {secs}s"
    else:
        return f"{secs}s"


# ── Step 1: Extract MSAL cache info from browser via CDP ──────────────────

EXTRACT_MSAL_JS = """
(function() {
    var result = {
        refreshTokens: [],
        accessTokens: [],
        allKeys: []
    };

    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        result.allKeys.push(key);
        try {
            var entry = JSON.parse(localStorage.getItem(key));
            if (entry && entry.credentialType === 'RefreshToken' && entry.secret && entry.clientId) {
                result.refreshTokens.push({
                    key: key,
                    secret: entry.secret,
                    clientId: entry.clientId,
                    homeAccountId: entry.homeAccountId || '',
                    environment: entry.environment || '',
                    realm: entry.realm || ''
                });
            }
            if (entry && entry.credentialType === 'AccessToken' && entry.secret) {
                var payload = null;
                try {
                    var parts = entry.secret.split('.');
                    if (parts.length === 3) {
                        var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                        while (b64.length % 4) b64 += '=';
                        payload = JSON.parse(atob(b64));
                    }
                } catch(e) {}
                result.accessTokens.push({
                    key: key,
                    target: entry.target || '',
                    realm: entry.realm || '',
                    audience: payload ? payload.aud : '',
                    exp: payload ? payload.exp : 0,
                    upn: payload ? (payload.upn || payload.preferred_username || '') : ''
                });
            }
        } catch(e) {
            // not JSON, skip
        }
    }

    return result;
})()
"""


async def extract_msal_info():
    """Connect to browser via CDP and extract MSAL cache info."""
    from playwright.async_api import async_playwright

    print("═" * 60)
    print("Step 1: Extracting MSAL cache from browser via CDP")
    print("═" * 60)

    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(
            f"http://{CDP_HOST}:{CDP_PORT}",
            timeout=CDP_CONNECT_TIMEOUT * 1000,
        )
    except Exception as e:
        print(f"  ❌ Cannot connect to CDP on port {CDP_PORT}: {e}")
        print(f"  💡 Make sure Edge is running with --remote-debugging-port={CDP_PORT}")
        await pw.stop()
        return None

    # Find Teams page
    teams_page = None
    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url.lower()
            if 'teams.cloud.microsoft' in url or 'teams.microsoft.com' in url:
                teams_page = page
                break
        if teams_page:
            break

    if not teams_page:
        print("  ❌ No Teams tab found in browser")
        await pw.stop()
        return None

    print(f"  ✅ Found Teams page: {teams_page.url}")

    # Extract MSAL cache
    msal_data = await teams_page.evaluate(EXTRACT_MSAL_JS)
    await pw.stop()

    print(f"  📦 localStorage keys: {len(msal_data.get('allKeys', []))}")
    print(f"  🔑 Refresh tokens found: {len(msal_data.get('refreshTokens', []))}")
    print(f"  🎫 Access tokens found: {len(msal_data.get('accessTokens', []))}")

    # Find the best refresh token (prefer matching tenant)
    refresh_tokens = msal_data.get('refreshTokens', [])
    if not refresh_tokens:
        print("  ❌ No refresh tokens in MSAL cache!")
        return None

    best_rt = None
    for rt in refresh_tokens:
        if EXPECTED_TENANT_ID.lower() in (rt.get('homeAccountId', '') or '').lower():
            best_rt = rt
            break
    if not best_rt:
        best_rt = refresh_tokens[0]

    # Get tenant from access tokens
    access_tokens = msal_data.get('accessTokens', [])
    tenant_id = None
    for at in access_tokens:
        realm = at.get('realm', '')
        if realm.lower() == EXPECTED_TENANT_ID.lower():
            tenant_id = realm
            break
    if not tenant_id and access_tokens:
        tenant_id = access_tokens[0].get('realm', '')
    if not tenant_id:
        tenant_id = EXPECTED_TENANT_ID

    print(f"\n  📋 Selected refresh token:")
    print(f"     Client ID: {best_rt['clientId']}")
    print(f"     Home Account: {best_rt['homeAccountId'][:30]}...")
    print(f"     Environment: {best_rt['environment']}")
    print(f"     Tenant: {tenant_id}")
    print(f"     RT preview: {best_rt['secret'][:20]}...{best_rt['secret'][-10:]}")

    # Show existing access tokens info
    print(f"\n  📋 Existing access tokens:")
    now = time.time()
    for at in access_tokens:
        exp = at.get('exp', 0)
        remaining = format_expiry(exp) if exp > now else "EXPIRED"
        aud = at.get('audience', 'unknown')
        upn = at.get('upn', 'unknown')
        status = "✅" if exp > now else "❌"
        print(f"     {status} {aud} | user={upn} | expires in {remaining}")

    return {
        'refreshToken': best_rt['secret'],
        'clientId': best_rt['clientId'],
        'tenantId': tenant_id,
        'homeAccountId': best_rt['homeAccountId'],
        'environment': best_rt['environment'],
        'refreshTokenKey': best_rt['key'],
    }


# ── Step 2: HTTP Refresh ──────────────────────────────────────────────────

def http_refresh_token(refresh_info, scope, resource_name):
    """Use refresh token to get a new access token via HTTP POST."""
    url = TOKEN_ENDPOINT_TEMPLATE.format(tenant_id=refresh_info['tenantId'])

    body = urlencode({
        'grant_type': 'refresh_token',
        'client_id': refresh_info['clientId'],
        'refresh_token': refresh_info['refreshToken'],
        'scope': scope,
    }).encode('utf-8')

    req = Request(url, data=body, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://teams.microsoft.com',
    })

    try:
        with urlopen(req, timeout=15, context=_ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return {
                'access_token': data.get('access_token'),
                'refresh_token': data.get('refresh_token'),
                'expires_in': data.get('expires_in'),
                'token_type': data.get('token_type'),
            }
    except HTTPError as e:
        error_body = e.read().decode('utf-8', errors='replace')
        try:
            error_data = json.loads(error_body)
            error_code = error_data.get('error', '')
            error_desc = error_data.get('error_description', '')
        except Exception:
            error_code = str(e.code)
            error_desc = error_body[:200]
        return {
            'error': error_code,
            'error_description': error_desc,
            'status': e.code,
        }
    except Exception as e:
        return {'error': 'network_error', 'error_description': str(e)}


# ── Step 3: Verify token by calling Graph API ─────────────────────────────

def verify_token_with_graph(access_token):
    """Call Graph API /me to verify the token works."""
    req = Request(GRAPH_ME_URL, headers={
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    })

    try:
        with urlopen(req, timeout=10, context=_ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return {
                'success': True,
                'displayName': data.get('displayName', ''),
                'mail': data.get('mail', ''),
                'userPrincipalName': data.get('userPrincipalName', ''),
                'id': data.get('id', ''),
            }
    except HTTPError as e:
        return {
            'success': False,
            'status': e.code,
            'error': e.read().decode('utf-8', errors='replace')[:200],
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ── Main ──────────────────────────────────────────────────────────────────

async def main():
    print("🔍 Token Refresh End-to-End Verification")
    print("=" * 60)
    print()

    # Step 1: Extract MSAL info from browser
    refresh_info = await extract_msal_info()
    if not refresh_info:
        print("\n❌ Unable to extract refresh token. Please ensure Edge browser is launched and logged into Teams.")
        sys.exit(1)

    print()
    print("═" * 60)
    print("Step 2: HTTP Token Refresh (simulating refresh after browser close)")
    print("═" * 60)

    all_success = True
    refreshed_tokens = {}

    for target in REFRESH_TARGETS:
        print(f"\n  🔄 Refreshing: {target['name']}")
        print(f"     Scope: {target['scope']}")

        result = http_refresh_token(refresh_info, target['scope'], target['name'])

        if 'error' in result:
            print(f"     ❌ FAILED: {result['error']}")
            print(f"        {result.get('error_description', '')[:120]}")
            if result.get('error') == 'invalid_grant':
                print(f"     ⚠️  Refresh token has expired! Need to re-login to the browser.")
            all_success = False
            continue

        access_token = result['access_token']
        new_refresh_token = result.get('refresh_token')
        expires_in = result.get('expires_in', 0)

        # Decode the new access token
        payload = decode_jwt_payload(access_token)
        exp = payload.get('exp', 0) if payload else 0
        aud = payload.get('aud', 'unknown') if payload else 'unknown'
        upn = (payload.get('upn') or payload.get('preferred_username', 'unknown')) if payload else 'unknown'
        tid = payload.get('tid', 'unknown') if payload else 'unknown'

        print(f"     ✅ SUCCESS!")
        print(f"        Audience: {aud}")
        print(f"        User: {upn}")
        print(f"        Tenant: {tid}")
        print(f"        Expires in: {format_expiry(exp)} ({expires_in}s)")
        print(f"        Token preview: {access_token[:30]}...{access_token[-10:]}")

        if new_refresh_token:
            rt_changed = new_refresh_token != refresh_info['refreshToken']
            print(f"        Refresh token rotated: {'YES ✅' if rt_changed else 'NO (same token)'}")
            if rt_changed:
                # Update for subsequent refreshes
                refresh_info['refreshToken'] = new_refresh_token

        refreshed_tokens[target['name']] = {
            'access_token': access_token,
            'expires': exp,
            'audience': aud,
        }

    print()
    print("═" * 60)
    print("Step 3: Verify usability of refreshed tokens")
    print("═" * 60)

    graph_result = refreshed_tokens.get('Graph API')
    if graph_result:
        print(f"\n  📡 Calling Graph API /me with refreshed token...")
        verify = verify_token_with_graph(graph_result['access_token'])

        if verify.get('success'):
            print(f"     ✅ Graph API call successful!")
            print(f"        Display Name: {verify['displayName']}")
            print(f"        UPN: {verify['userPrincipalName']}")
            print(f"        Mail: {verify['mail']}")
            print(f"        User ID: {verify['id']}")
        else:
            print(f"     ❌ Graph API call failed!")
            print(f"        Status: {verify.get('status', 'unknown')}")
            print(f"        Error: {verify.get('error', '')[:200]}")
            all_success = False
    else:
        print(f"\n  ⚠️  Skipping Graph API verification (refresh failed)")
        all_success = False

    print()
    print("═" * 60)
    print("Step 4: Token validity summary")
    print("═" * 60)

    now = time.time()

    print(f"\n  📋 Refresh Token info:")
    print(f"     ⚠️  Microsoft OAuth2 refresh tokens are opaque (cannot be decoded)")
    print(f"     Default validity: ~24 hours (single-tenant apps) or ~90 days (multi-tenant apps)")
    print(f"     Expiry detection: server returns invalid_grant error code")
    print(f"     Rotation: each refresh returns a new refresh token (Token Rotation)")

    print(f"\n  📋 Access Token validity:")
    for name, info in refreshed_tokens.items():
        exp = info.get('expires', 0)
        remaining = format_expiry(exp) if exp > now else "EXPIRED"
        status = "✅" if exp > now + 300 else ("⚠️" if exp > now else "❌")
        print(f"     {status} {name}: {remaining}")

    print()
    print("═" * 60)
    if all_success:
        print("🎉 Verification passed! HTTP Refresh pipeline is fully functional.")
        print("   As long as the refresh token has not expired, new tokens can be obtained continuously after the browser closes.")
    else:
        print("⚠️  Some verifications did not pass. Please review the error messages above.")
    print("═" * 60)


if __name__ == '__main__':
    asyncio.run(main())
