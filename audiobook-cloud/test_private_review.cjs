const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('audiobook-private-review.html','utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/);
assert(inline,'Private review script missing');
new vm.Script(inline[1],{filename:'audiobook-private-review-inline.js'});
for(const id of ['authBox','adminToken','login','chapter','load','audio','status','playArea']){
 assert(html.includes('id="'+id+'"'),'Missing essential private review control: '+id);
}
assert(html.includes('name="robots" content="noindex,nofollow,noarchive"'),'Private review must not be indexed');
assert(html.includes('previewUnpublishedEdition'),'Must use read-only private preview endpoint');
assert(!html.includes('service_role')&&!html.includes('SUPABASE_SERVICE_KEY'),'Privileged backend secrets must not enter browser');
const factory=fs.readFileSync('audiobook-factory.html','utf8');
assert(factory.includes('./audiobook-private-review.html'),'The Factory needs a link to the review page');
assert(factory.includes("j.stage==='ready_not_published'"),'Review must only show for withheld completed jobs');
for(const id of ['reviewApproval','reviewConfirmed','releaseEdition','releaseStatus'])
 assert(html.includes('id="'+id+'"'),'Missing author approval element: '+id);
assert(html.includes("request('publishReviewedEdition'"),'Private review must publish through authenticated API only');
assert(html.includes("confirmVoiceKey:'jessica_de'")&&html.includes("confirmTitle:'DIE ORDNUNG'"),'Private review must bind exact edition');
assert(html.includes("el('reviewConfirmed').checked"),'Release must require author acknowledgement');

console.log('PRIVATE_AUDIO_PREVIEW_UI_TEST=PASS');
