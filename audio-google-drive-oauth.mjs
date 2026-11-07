// Google Identity Services token client. Tokens live only in this module's memory.
// The OAuth client ID must be provisioned for the deployed HTTPS origin.
// Never store tokens in URLs, localStorage, cookies, or backend logs.
let token = '';
let expiresAt = 0;
let client;
let pending;
let ready;
export function clearDriveToken() { token = ''; expiresAt = 0; }
export function hasDriveToken() {
  return Boolean(token && Date.now() < expiresAt - 60000);
}
// Preload GIS before the user taps Connect. No OAuth popup is opened here.
export function prepareDriveOAuth() {
  if (ready) return ready;
  ready = (async () => {
    const clientId = document.querySelector('meta[name="ajk-google-drive-client-id"]')?.content?.trim();
    if (!clientId || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId))
      throw Error('GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED');
    if (!window.google?.accounts?.oauth2?.initTokenClient) {
      await new Promise((resolve,reject) => {
        const script=document.createElement('script');
        script.src='https://accounts.google.com/gsi/client';
        script.async=true;script.onload=resolve;script.onerror=()=>reject(Error('GOOGLE_OAUTH_SCRIPT_UNAVAILABLE'));
        document.head.appendChild(script);
      });
    }
    client ||= window.google.accounts.oauth2.initTokenClient({
      client_id:clientId,scope:'https://www.googleapis.com/auth/drive.readonly',
      callback:result => {
        if (!pending) return;
        const {resolve,reject}=pending;
        pending=null;
        if (result.error || !result.access_token) return reject(Error('GOOGLE_DRIVE_OAUTH_DENIED'));
        token=result.access_token;
        expiresAt=Date.now()+Math.max(0,Number(result.expires_in)||300)*1000;
        resolve(token);
      },
      error_callback:() => {
        if (!pending) return;
        const {reject}=pending;pending=null;
        reject(Error('GOOGLE_DRIVE_OAUTH_CANCELLED'));
      }
    });
  })().catch(err=>{ready=null;throw err;});
  return ready;
}
// Must be called directly in a click handler, after prepareDriveOAuth resolves.
export function connectDriveFromClick() {
  if (!client) throw Error('GOOGLE_DRIVE_OAUTH_NOT_READY');
  if (pending) return pending.promise;
  let resolve,reject;
  const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
  pending={promise,resolve,reject};
  try { client.requestAccessToken({prompt:'consent'}); }
  catch(err) { pending=null;reject(err); }
  return promise;
}
export async function getDriveToken({refresh=false}={}) {
  if (!refresh && hasDriveToken()) return token;
  throw Error('GOOGLE_DRIVE_RECONNECT_REQUIRED');
}
