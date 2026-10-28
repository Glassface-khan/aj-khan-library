// One-off source transfer closed. No more signed URLs.
Deno.serve(()=>new Response('{"ok":false,"closed":true}',{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
