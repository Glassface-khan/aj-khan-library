/* AJK Audiobook Factory — author-only local review journal, additive to existing UI.
 * Does not call Supabase, change audio, publish reviews, or auto-send to ChatGPT.
 * Browser storage is device-local, not encrypted; export notes for secure transfer.
 */
(() => {
  'use strict';
  const KEY='ajk_factory_private_reviews_v1';
  const byId=id=>document.getElementById(id);
  const status=msg=>{const el=byId('voiceReviewStatus');if(el)el.textContent=msg};
  const clean=s=>String(s??'').trim();
  let notes=[];
  try {
    const data=JSON.parse(localStorage.getItem(KEY)||'[]');
    if(Array.isArray(data))notes=data.filter(r=>r&&typeof r==='object').slice(-500);
  } catch (_) {}
  function editions(){
    const items=[];
    try{
      if(typeof libraryBooks!=='undefined'&&Array.isArray(libraryBooks)){
        for(const b of libraryBooks) if(b?.title)items.push({
          key:'book:'+String(b.id||b.title+'_'+b.narrator_name),id:String(b.id||''),
          title:String(b.title),voice:String(b.narrator_name||'Unknown voice'),
          lang:String(b.language_code||'')});
      }
      if(typeof currentJobs!=='undefined'&&Array.isArray(currentJobs)){
        for(const j of currentJobs)if(j?.id)items.push({
          key:'job:'+String(j.id),id:String(j.id),
          title:String(j.detected_title||j.requested_title||j.source_file_name||'Untitled'),
          voice:String(j.voice_name||j.voice_key||'Unknown voice'),
          lang:String(j.language_code||'')});
      }
    }catch(_){}
    return items;
  }
  function sync(){
    const select=byId('voiceReviewEdition');if(!select)return;
    const previous=select.value;
    select.replaceChildren(new Option('Manuell eingeben / noch kein Job','manual'));
    const seen=new Set();
    for(const item of editions()){
      if(seen.has(item.key))continue;
      seen.add(item.key);
      select.add(new Option(item.title+' — '+item.voice+' ('+item.lang+')',item.key));
    }
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    render();
  }
  function render(){
    const root=byId('voiceReviewEntries');if(!root)return;
    root.replaceChildren();
    notes.slice().reverse().slice(0,40).forEach(n=>{
      const article=document.createElement('article');article.className='job';
      const title=document.createElement('strong');
      title.textContent=n.title+' · '+n.voice+' · Kapitel '+n.chapter+' · '+n.timecode;
      const body=document.createElement('p');body.textContent=n.issue+': '+n.note;
      const small=document.createElement('small');small.className='muted';small.textContent=n.createdAt;
      const deleteButton=document.createElement('button');deleteButton.type='button';deleteButton.textContent='Notiz entfernen';
      deleteButton.addEventListener('click',()=>{
        if(!confirm('Nur diese lokal gespeicherte Notiz entfernen?'))return;
        notes=notes.filter(x=>x.id!==n.id);save();render();
      });
      article.append(title,body,small,document.createElement('div'),deleteButton);root.append(article);
    });
    if(!notes.length){const p=document.createElement('p');p.className='muted';p.textContent='Noch keine Rückmeldungen gespeichert.';root.append(p)}
  }
  function save(){
    try{localStorage.setItem(KEY,JSON.stringify(notes));return true}
    catch(e){status('Lokaler Speicher nicht verfügbar. Exportiere deine Notizen vor dem Schließen.');return false}
  }
  function exportText(){
    return 'AJK AUDIOBOOK FACTORY — PRIVATE HÖRPRÜFUNG\n'+
      'Bitte überprüfe die Stellen und schlage Änderungen vor. Keine Manuskript- oder Audioänderung ohne Freigabe.\n\n'+
      notes.map(n=>[n.title+' | '+n.voice+' | '+n.lang+' | Kapitel '+n.chapter+
        ' | '+n.timecode+' | '+n.issue,n.note].join('\n')).join('\n\n');
  }
  function download(){
    const blob=new Blob([JSON.stringify({version:1,reviews:notes},null,2)],
      {type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='AJK_AUDIOBOOK_HOERPRUEFUNG.json';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  byId('voiceReviewForm')?.addEventListener('submit',event=>{
    event.preventDefault();
    const selection=byId('voiceReviewEdition').value;
    const record=editions().find(x=>x.key===selection);
    const title=record?.title||clean(byId('voiceReviewTitle').value);
    const voice=record?.voice||clean(byId('voiceReviewVoice').value);
    const chapter=Number(byId('voiceReviewChapter').value);
    const timecode=clean(byId('voiceReviewTime').value)||'—';
    const note=clean(byId('voiceReviewNote').value).slice(0,7000);
    if(!title||!voice||!Number.isInteger(chapter)||chapter<1||chapter>999||!note){
      status('Titel, Stimme, Kapitel und Korrekturtext bitte ausfüllen.');return;
    }
    if(!/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(timecode)&&timecode!=='—'){
      status('Zeitmarke bitte z. B. 02:14 oder 1:02:14 eingeben.');return;
    }
    notes.push({id:(crypto.randomUUID?.()||String(Date.now())+String(Math.random())),
      editionKey:selection,title,voice,lang:record?.lang||'',
      chapter,timecode,issue:byId('voiceReviewIssue').value,note,
      createdAt:new Date().toISOString()});
    if(notes.length>500)notes=notes.slice(-500);
    save();byId('voiceReviewNote').value='';render();status('Notiz auf diesem Gerät gespeichert. Für ChatGPT bitte „Korrekturen kopieren“ nutzen.');
  });
  byId('voiceReviewExport')?.addEventListener('click',download);
  byId('voiceReviewCopy')?.addEventListener('click',async()=>{
    if(!notes.length){status('Noch keine Notizen vorhanden.');return}
    const content=exportText();
    try{await navigator.clipboard.writeText(content);status('Kopiert. Den Text hier im Chat einfügen.')}
    catch(_){window.prompt('Korrekturen für ChatGPT kopieren:',content)}
  });
  byId('voiceReviewEdition')?.addEventListener('change',()=>{
    const manual=byId('voiceReviewEdition').value==='manual';
    for(const id of ['voiceReviewManualTitle','voiceReviewManualVoice']){
      const el=byId(id);if(el)el.classList.toggle('hidden',!manual);
    }
  });
  const select=byId('voiceReviewEdition');
  if(select){select.value='manual';select.dispatchEvent(new Event('change'))}
  sync();setInterval(sync,12000);
})();