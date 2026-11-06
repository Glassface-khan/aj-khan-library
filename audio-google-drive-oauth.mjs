// Google Identity Services token client. Tokens live only in this module's memory.
// The OAuth client ID must be provisioned for the deployed HTTPS origin.
// Never store tokens in URLs, localStorage, cookies, or backend logs.
let token = '';
let expiresAt = 0;
let client;
let pending;
export function clearDriveToken() { token = ''; expiresAt = 0; }
export async function getDriveToken({refresh = false} = {}) {
  if (!refresh && token && Date.now() < expiresAt - 60000) return token;
  const clientId = document.querySelector('meta[name="ajk-google-drive-client-id"]')?.content?.trim();
  if (!clientId || !/^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$/.test(clientId)) {
    throw Error('GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED');
  }
  if (!window.google?.accounts?.oauth2?.initTokenClient) {
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;script.onload=resolve;script.onerror=()=>reject(Error('GOOGLE_OAUTH_SCRIPT_UNAVAILABLE'));
      document.head.appendChild(script);
    });
  }
  if (pending) return pending;
  pending = new Promise((resolve,reject)=>{
    try {
      client ||= window.google.accounts.oauth2.initTokenClient({
        client_id:clientId,scope:'https://www.googleapis.com/auth/drive.readonly',
        callback:result=>{
          if (result.error || !result.access_token) { reject(Error('GOOGLE_DRIVE_OAUTH_DENIED'));return; }
          token=result.access_token;
          expiresAt=Date.now()+Math.max(0,Number(result.expires_in)||300)*1000;
          resolve(token);
        },
        error_callback:()=>reject(Error('GOOGLE_DRIVE_OAUTH_CANCELLED'))
      });
      client.requestAccessToken({prompt:refresh || !token ? 'consent' : ''});
    } catch(e) {reject(e);}
  }).finally(()=>{pending=null;});
  return pending;
}
