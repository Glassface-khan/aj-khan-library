/* Minimal regression tests for the factory's narrator editions and accordions. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('audiobook-factory.html','utf8');
const jsSource=html.split('<script>')[1]?.split('</script>')[0];
assert(jsSource,'Factory inline JavaScript not found');
new vm.Script(jsSource,{filename:'audiobook-factory-inline.js'});
for(const id of ['expandLibraryGroups','collapseLibraryGroups','libraryStatus','jobsFold','notStartedFold']){
 assert(html.includes('id="'+id+'"'),'Missing control '+id);
}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.strictEqual(ids.length,new Set(ids).size,'Duplicate document IDs');
const start=jsSource.indexOf("const esc="),end=jsSource.indexOf("function catalogNotStarted_(){",start);
assert(start>=0&&end>start,'Cannot isolate library renderer');
const libraryCode=jsSource.slice(start,end);
const mocks={
 '#audioOverview':{innerHTML:''},
 '#librarySearch':{value:''},
 '#libraryLanguage':{value:'ALL'},
 '#libraryStatus':{value:'ALL'},
 '#librarySummary':{textContent:''}
};
const local={
 data:{},
 getItem(key){return this.data[key]??null},
 setItem(key,value){this.data[key]=value}
};
const fixtures=[
 {id:'en1',site_book_id:'book1',title:'The Low Wall',narrator_name:'Maggie',voice_key:'maggie',language_code:'EN',status:'ready',chapter_count:40,total_duration_seconds:4000},
 {id:'en2',site_book_id:'book1',title:'The Low Wall',narrator_name:'Jessica EN',voice_key:'jessica_en',language_code:'EN',status:'ready',chapter_count:40,total_duration_seconds:4300},
 {id:'vol1',site_book_id:'book2',title:'The Drop',narrator_name:'Tommy',voice_key:'tommy',language_code:'EN',status:'ready',series_key:'the_vessel',series_title:'THE VESSEL',series_number:1,series_total:3}
];
const context={
 console,localStorage:local,document:{querySelectorAll:()=>[]},
 currentJobs:[],
 libraryBooks:fixtures,
 norm:value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),
 $:name=>mocks[name],
 jobRank_:()=>0
};
vm.createContext(context);
vm.runInContext(libraryCode,context,{filename:'audiobook-factory-library.js'});
vm.runInContext('renderAudioOverview_();updateLibrarySummary_()',context);
const output=mocks['#audioOverview'].innerHTML;
assert.strictEqual(output.split('The Low Wall').length-1,1,'The same book appears more than once');
assert(output.includes('2 Sprecherfassungen'),'No two-voice grouping');
assert(output.includes('Maggie')&&output.includes('Jessica EN'),'Missing narrator choices');
assert(output.includes('data-listen-book="en1"')&&output.includes('data-listen-book="en2"'),'Edition listening links lost');
assert(output.includes('data-download-book="en1"')&&output.includes('data-download-book="en2"'),'Edition downloads lost');
assert(output.includes('data-library-group="singles"')&&output.includes('data-library-group="series:the_vessel"'),'Missing fold group');
assert(output.includes('Bücher')&&mocks['#librarySummary'].textContent.includes('2 Bücher'),'Bad unique book count');
assert(!output.includes('data-library-group="singles" open'),'Singles must be collapsed initially');
mocks['#librarySearch'].value='maggie';
vm.runInContext('renderAudioOverview_()',context);
const filtered=mocks['#audioOverview'].innerHTML;
assert(filtered.includes('Maggie')&&!filtered.includes('Jessica EN'),'Search must filter narrator editions');
assert(filtered.includes('data-library-group="singles" open'),'Searching must expand matched groups');
mocks['#librarySearch'].value='';
mocks['#libraryStatus'].value='OPEN';
vm.runInContext('renderAudioOverview_()',context);
assert(mocks['#audioOverview'].innerHTML.includes('Keine Hörbücher'),'OPEN filter should hide completed editions with no open jobs');
console.log('AUDIOBOOK_FACTORY_UI_TEST=PASS');
