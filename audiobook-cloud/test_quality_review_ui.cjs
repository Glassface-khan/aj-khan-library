/* Minimal static checks for the additive audiobook review UI. */
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('audiobook-factory.html','utf8');
const js=fs.readFileSync('audiobook-quality-review.js','utf8');
new vm.Script(js,{filename:'audiobook-quality-review.js'});
for(const id of ['newJob','libraryCard','jobsCard','notStartedCard','voiceReviewCard','voiceReviewForm','voiceReviewEdition','voiceReviewCopy','voiceReviewExport']){
 if(!html.includes('id="'+id+'"'))throw Error('Missing '+id);
}
if(!html.includes("const API='https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/audiobook-factory'"))throw Error('Legacy backend changed unexpectedly');
if(!html.includes('<script src="./audiobook-quality-review.js" defer></script>'))throw Error('Review JS missing');
if(/fetch\(|XMLHttpRequest|sendBeacon|localStorage\.removeItem\('ajk_factory_session'\)/.test(js))throw Error('Unexpected remote or session operation');
console.log('PASS: existing factory UI preserved; new review JS parses; review stays browser-local');
