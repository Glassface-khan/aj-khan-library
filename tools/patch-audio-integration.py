import json
from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")

open_tag = '<script type="__bundler/template">'
start = html.index(open_tag)
end = html.index('</script>', start)
tpl = json.loads(html[start + len(open_tag):end])

if "AUDIO_API_URL" in tpl:
    print("Audiobook integration already present; nothing to do.")
    raise SystemExit(0)

def once(old, new, label):
    global tpl
    count = tpl.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    tpl = tpl.replace(old, new, 1)

# Endpoint + state
once(
    "  SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec';",
    "  SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec';\n  AUDIO_API_URL = 'https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/audio-api';",
    "audio api constant",
)

once(
    "    visitorName: '', visitorCanDownload: false, visitorCanCopy: false, visitorVisibleBooks: null, visitorShowPoems: true, visitorAccessCode: '', visitorEpubAccess: {}, altGalleryImages: [], altGalleryIndex: 0, altGalleryTitle: '', readerOpen: false, readerBookTitle: '', readerLoading: false, readerError: '', readerFontSize: 100, readerToc: [], readerTocOpen: false, readerProgress: 0, readerSpeaking: false, ratings: [], drafts: {},",
    "    visitorName: '', visitorCanDownload: false, visitorCanCopy: false, visitorVisibleBooks: null, visitorShowPoems: true, visitorAccessCode: '', visitorEpubAccess: {}, altGalleryImages: [], altGalleryIndex: 0, altGalleryTitle: '', readerOpen: false, readerBookTitle: '', readerLoading: false, readerError: '', readerFontSize: 100, readerToc: [], readerTocOpen: false, readerProgress: 0, readerSpeaking: false, ratings: [], drafts: {},\n    audioCatalog: [], audioLoading: false, audioError: '', audioPlayerOpen: false, audioPlayerTitle: '', audioPlayerLanguage: '', audioPlayerLoading: false, audioPlayerError: '', audioBook: null, audioChapters: [], audioChapterIndex: 0, audioCurrentTime: 0, audioDuration: 0, audioPlaying: false, audioRate: 1,",
    "audio state",
)

once(
    "    adminToken: '', accessPeople: [], newAccessName: '', newAccessCanDownload: true, newAccessCanCopy: true, newAccessShowPoems: true, newAccessEpubAccess: {}, newAccessGeneratedCode: '',",
    "    adminToken: '', accessPeople: [], newAccessName: '', newAccessCanDownload: true, newAccessCanCopy: true, newAccessShowPoems: true, newAccessEpubAccess: {}, newAccessAudioAccess: {}, newAccessGeneratedCode: '',",
    "audio rights state",
)

once(
    "    if (isAdmin) { this.fetchAccessList(adminToken); this.fetchRevisionNovels(); }\n    this.fetchBooks();",
    "    if (isAdmin) { this.fetchAccessList(adminToken); this.fetchRevisionNovels(); }\n    if ((access && access.code) || isAdmin) this.fetchAudioCatalog((access && access.code) || '', isAdmin ? adminToken : '');\n    this.fetchBooks();",
    "load audio catalog at startup",
)

# Merge AudioAccess into existing access users.
a = tpl.index("  fetchAccessList = (tokenOverride) => {")
z = tpl.index("  setNewAccessName =", a)
access_block = """  fetchAccessList = (tokenOverride) => {
    const token = tokenOverride || this.state.adminToken;
    const baseParams = new URLSearchParams({ action: 'getAccessList', adminToken: token });
    const audioParams = new URLSearchParams({ action: 'getAudioAccessList', adminToken: token });
    Promise.all([
      fetch(this.SCRIPT_URL + '?' + baseParams.toString()).then(r => r.json()),
      fetch(this.SCRIPT_URL + '?' + audioParams.toString()).then(r => r.json()).catch(() => ({ ok: false, people: [] }))
    ])
      .then(([data, audioData]) => {
        if (!data.ok) {
          this.setState({ accessListError: 'Zugänge konnten nicht geladen werden: ' + (data.error || 'unbekannt') + '. Bitte einmal aus- und wieder als Admin einloggen.' });
          return;
        }
        const byCode = {};
        if (audioData && audioData.ok && Array.isArray(audioData.people)) {
          audioData.people.forEach(p => { byCode[p.code] = p.audioAccess || {}; });
        }
        const people = (data.people || []).map(p => ({ ...p, audioAccess: byCode[p.code] || {} }));
        this.setState({ accessPeople: people, accessListError: '' });
      })
      .catch(() => this.setState({ accessListError: 'Verbindung zum Server fehlgeschlagen — Zugänge konnten nicht geladen werden. Bitte erneut versuchen.' }));
  };

  saveAudioAccessForCode = (code, audioAccess) => {
    const params = new URLSearchParams({
      action: 'setAudioAccess',
      adminToken: this.state.adminToken,
      code,
      audioAccess: JSON.stringify(audioAccess || {})
    });
    return fetch(this.SCRIPT_URL, { method: 'POST', body: params })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'Audio-Rechte konnten nicht gespeichert werden.');
        return data;
      });
  };
"""
tpl = tpl[:a] + access_block + tpl[z:]

once(
"""  setNewAccessEpubDownload = (title, e) => this.setState(s => {
    const epubAccess = { ...s.newAccessEpubAccess };
    epubAccess[title] = { ...(epubAccess[title] || {}), download: e.target.checked };
    return { newAccessEpubAccess: epubAccess };
  });""",
"""  setNewAccessEpubDownload = (title, e) => this.setState(s => {
    const epubAccess = { ...s.newAccessEpubAccess };
    epubAccess[title] = { ...(epubAccess[title] || {}), download: e.target.checked };
    return { newAccessEpubAccess: epubAccess };
  });
  setNewAccessAudio = (title, e) => this.setState(s => ({
    newAccessAudioAccess: { ...s.newAccessAudioAccess, [title]: e.target.checked }
  }));""",
"new-user audio setter",
)

once(
"""        if (data.ok) {
          this.setState({ newAccessName: '', newAccessGeneratedCode: data.code || '', newAccessAllBooks: true, newAccessBookDraft: [], newAccessShowPoems: true, newAccessEpubAccess: {} });
          this.fetchAccessList();
          this.showSavedToast('Zugang angelegt ✓');
        } else {""",
"""        if (data.ok) {
          const code = data.code || '';
          this.saveAudioAccessForCode(code, this.state.newAccessAudioAccess)
            .catch(err => window.alert('Zugang wurde angelegt, aber die Audio-Rechte konnten noch nicht gespeichert werden: ' + err.message))
            .finally(() => {
              this.setState({ newAccessName: '', newAccessGeneratedCode: code, newAccessAllBooks: true, newAccessBookDraft: [], newAccessShowPoems: true, newAccessEpubAccess: {}, newAccessAudioAccess: {} });
              this.fetchAccessList();
              this.showSavedToast('Zugang angelegt ✓');
            });
        } else {""",
"new-user audio save",
)

once(
"""        showPoems: person.showPoems !== false,
        epubAccess: person.epubAccess ? JSON.parse(JSON.stringify(person.epubAccess)) : {}""",
"""        showPoems: person.showPoems !== false,
        epubAccess: person.epubAccess ? JSON.parse(JSON.stringify(person.epubAccess)) : {},
        audioAccess: person.audioAccess ? { ...person.audioAccess } : {}""",
"existing-user audio draft",
)

once(
"""  setEditAccessEpubDownload = (code, title, e) => this.setState(s => {
    const draft = s.accessBookDraft[code];
    const epubAccess = { ...draft.epubAccess };
    epubAccess[title] = { ...(epubAccess[title] || {}), download: e.target.checked };
    return { accessBookDraft: { ...s.accessBookDraft, [code]: { ...draft, epubAccess } } };
  });""",
"""  setEditAccessEpubDownload = (code, title, e) => this.setState(s => {
    const draft = s.accessBookDraft[code];
    const epubAccess = { ...draft.epubAccess };
    epubAccess[title] = { ...(epubAccess[title] || {}), download: e.target.checked };
    return { accessBookDraft: { ...s.accessBookDraft, [code]: { ...draft, epubAccess } } };
  });
  setEditAccessAudio = (code, title, e) => this.setState(s => {
    const draft = s.accessBookDraft[code];
    const audioAccess = { ...(draft.audioAccess || {}), [title]: e.target.checked };
    return { accessBookDraft: { ...s.accessBookDraft, [code]: { ...draft, audioAccess } } };
  });""",
"existing-user audio setter",
)

once(
"""      .then(data => {
        if (data.ok) { this.setState({ editingAccessCode: null }); this.fetchAccessList(); this.showSavedToast(); }
        else window.alert('Speichern fehlgeschlagen: ' + (data.error || 'unbekannt') + '. Bitte einmal aus- und wieder als Admin einloggen und danach erneut versuchen.');
      })
      .catch(err => window.alert('Verbindung fehlgeschlagen: ' + err.message));""",
"""      .then(data => {
        if (!data.ok) {
          window.alert('Speichern fehlgeschlagen: ' + (data.error || 'unbekannt') + '. Bitte einmal aus- und wieder als Admin einloggen und danach erneut versuchen.');
          return;
        }
        return this.saveAudioAccessForCode(code, draft.audioAccess || {}).then(() => {
          this.setState({ editingAccessCode: null });
          this.fetchAccessList();
          this.showSavedToast();
        });
      })
      .catch(err => window.alert('Verbindung fehlgeschlagen: ' + err.message));""",
"existing-user audio save",
)

# Player methods
once(
"""  prevAltCover = () => this.setState(s => ({ altGalleryIndex: (s.altGalleryIndex - 1 + s.altGalleryImages.length) % s.altGalleryImages.length }));
  // Inline-EPUB-Reader""",
"""  prevAltCover = () => this.setState(s => ({ altGalleryIndex: (s.altGalleryIndex - 1 + s.altGalleryImages.length) % s.altGalleryImages.length }));

  // --- Geschützte Hörbuch-Bibliothek: bestehender Access-Code + Supabase ---
  audioCredentials_ = (codeOverride, adminTokenOverride) => ({
    code: codeOverride !== undefined ? codeOverride : (this.state.visitorAccessCode || ''),
    adminToken: adminTokenOverride !== undefined ? adminTokenOverride : (this.state.adminToken || '')
  });

  audioApi_ = (payload) => fetch(this.AUDIO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());

  fetchAudioCatalog = (codeOverride, adminTokenOverride) => {
    const creds = this.audioCredentials_(codeOverride, adminTokenOverride);
    this.setState({ audioLoading: true, audioError: '' });
    return this.audioApi_({ action: 'catalog', ...creds })
      .then(data => {
        if (data.ok) this.setState({ audioCatalog: data.books || [], audioLoading: false, audioError: '' });
        else this.setState({ audioCatalog: [], audioLoading: false, audioError: data.error || '' });
        return data;
      })
      .catch(() => {
        this.setState({ audioCatalog: [], audioLoading: false, audioError: 'Audio-Bibliothek ist gerade nicht erreichbar.' });
        return { ok: false };
      });
  };

  openAudioPlayer = (title, languageCode) => {
    const creds = this.audioCredentials_();
    this.setState({
      audioPlayerOpen: true, audioPlayerTitle: title, audioPlayerLanguage: languageCode || '',
      audioPlayerLoading: true, audioPlayerError: '', audioChapters: [], audioBook: null,
      audioChapterIndex: 0, audioCurrentTime: 0, audioDuration: 0, audioPlaying: false
    });
    this.audioApi_({ action: 'book', bookTitle: title, languageCode: languageCode || '', ...creds })
      .then(data => {
        if (!data.ok) {
          this.setState({ audioPlayerLoading: false, audioPlayerError: data.error === 'audio_not_found' ? 'Noch keine Audiofassung hinterlegt.' : 'Audio konnte nicht geladen werden.' });
          return;
        }
        const chapters = data.chapters || [];
        if (!chapters.length) {
          this.setState({ audioPlayerLoading: false, audioPlayerError: 'Für dieses Hörbuch sind noch keine Kapitel hinterlegt.', audioBook: data.book || null });
          return;
        }
        const progress = data.progress || null;
        let idx = 0;
        if (progress && progress.chapter_id) {
          const found = chapters.findIndex(ch => ch.id === progress.chapter_id);
          if (found >= 0) idx = found;
        }
        const rate = progress && Number(progress.playback_rate) ? Number(progress.playback_rate) : 1;
        const pos = progress && Number(progress.position_seconds) ? Number(progress.position_seconds) : 0;
        this.setState({
          audioPlayerLoading: false, audioBook: data.book || null, audioChapters: chapters,
          audioChapterIndex: idx, audioRate: rate
        }, () => this.mountAudioChapter_(idx, pos, false));
      })
      .catch(() => this.setState({ audioPlayerLoading: false, audioPlayerError: 'Verbindung fehlgeschlagen — bitte erneut versuchen.' }));
  };

  mountAudioChapter_ = (index, startAt, autoplay) => {
    const chapters = this.state.audioChapters || [];
    const ch = chapters[index];
    if (!ch) return;
    if (this.audioEl) {
      try { this.audioEl.pause(); } catch (e) {}
      this.audioEl.src = '';
    }
    const el = new Audio(ch.url);
    this.audioEl = el;
    el.preload = 'metadata';
    el.playbackRate = this.state.audioRate || 1;
    this._lastAudioUiTick = 0;
    this._lastAudioSaveAt = 0;

    el.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(el.duration) ? el.duration : Number(ch.duration_seconds || 0);
      if (startAt && Number.isFinite(startAt) && startAt < duration) {
        try { el.currentTime = startAt; } catch (e) {}
      }
      this.setState({ audioDuration: duration || 0, audioCurrentTime: el.currentTime || 0 });
      if (autoplay) el.play().catch(() => {});
    });

    el.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - (this._lastAudioUiTick || 0) > 400) {
        this._lastAudioUiTick = now;
        this.setState({
          audioCurrentTime: el.currentTime || 0,
          audioDuration: Number.isFinite(el.duration) ? el.duration : this.state.audioDuration
        });
      }
      if (now - (this._lastAudioSaveAt || 0) > 15000) {
        this._lastAudioSaveAt = now;
        this.saveAudioProgress_(false, false);
      }
    });

    el.addEventListener('play', () => this.setState({ audioPlaying: true }));
    el.addEventListener('pause', () => this.setState({ audioPlaying: false }));
    el.addEventListener('ended', () => {
      this.saveAudioProgress_(true, index >= chapters.length - 1);
      if (index < chapters.length - 1) this.mountAudioChapter_(index + 1, 0, true);
      else this.setState({ audioPlaying: false });
    });

    this.setState({
      audioChapterIndex: index,
      audioCurrentTime: 0,
      audioDuration: Number(ch.duration_seconds || 0),
      audioPlaying: false
    });
  };

  toggleAudioPlayback = () => {
    if (!this.audioEl) {
      this.mountAudioChapter_(this.state.audioChapterIndex || 0, this.state.audioCurrentTime || 0, true);
      return;
    }
    if (this.audioEl.paused) this.audioEl.play().catch(() => this.setState({ audioPlayerError: 'Wiedergabe konnte nicht gestartet werden.' }));
    else this.audioEl.pause();
  };

  audioPrev = () => {
    const idx = this.state.audioChapterIndex || 0;
    if (this.audioEl && this.audioEl.currentTime > 8) {
      this.audioEl.currentTime = 0;
      return;
    }
    if (idx > 0) {
      this.saveAudioProgress_(true, false);
      this.mountAudioChapter_(idx - 1, 0, false);
    }
  };

  audioNext = () => {
    const idx = this.state.audioChapterIndex || 0;
    if (idx < this.state.audioChapters.length - 1) {
      this.saveAudioProgress_(true, false);
      this.mountAudioChapter_(idx + 1, 0, false);
    }
  };

  seekAudio = (e) => {
    const value = Math.max(0, Number(e.target.value || 0));
    if (this.audioEl) this.audioEl.currentTime = value;
    this.setState({ audioCurrentTime: value });
  };

  cycleAudioRate = () => {
    const rates = [1, 1.1, 1.25, 1.5, 1.75, 2];
    const current = this.state.audioRate || 1;
    const idx = rates.findIndex(r => Math.abs(r - current) < 0.01);
    const next = rates[(idx + 1 + rates.length) % rates.length];
    if (this.audioEl) this.audioEl.playbackRate = next;
    this.setState({ audioRate: next });
    this.saveAudioProgress_(true, false, next);
  };

  selectAudioChapter = (index) => {
    this.saveAudioProgress_(true, false);
    this.mountAudioChapter_(index, 0, false);
  };

  saveAudioProgress_ = (force, completed, rateOverride) => {
    const book = this.state.audioBook;
    const ch = (this.state.audioChapters || [])[this.state.audioChapterIndex || 0];
    if (!book || !ch) return Promise.resolve();
    const el = this.audioEl;
    const pos = el ? (el.currentTime || 0) : (this.state.audioCurrentTime || 0);
    if (!force && pos < 1) return Promise.resolve();
    const creds = this.audioCredentials_();
    return this.audioApi_({
      action: 'save_progress',
      bookTitle: book.title,
      languageCode: book.language_code || this.state.audioPlayerLanguage || '',
      chapterId: ch.id,
      positionSeconds: pos,
      playbackRate: rateOverride || this.state.audioRate || 1,
      completed: !!completed,
      ...creds
    }).catch(() => {});
  };

  closeAudioPlayer = () => {
    this.saveAudioProgress_(true, false);
    if (this.audioEl) {
      try { this.audioEl.pause(); } catch (e) {}
      this.audioEl = null;
    }
    this.setState({
      audioPlayerOpen: false, audioPlayerTitle: '', audioPlayerLanguage: '', audioPlayerLoading: false,
      audioPlayerError: '', audioBook: null, audioChapters: [], audioChapterIndex: 0,
      audioCurrentTime: 0, audioDuration: 0, audioPlaying: false
    }, () => this.fetchAudioCatalog());
  };

  formatAudioTime_ = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds || 0)));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return (h ? (h + ':') : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
  };

  // Inline-EPUB-Reader""",
"audio player methods",
)

# Sessions
once(
"""          this.fetchRatings();
        } else {""",
"""          this.fetchRatings();
          this.fetchAudioCatalog(access.code, '');
        } else {""",
"visitor audio catalog",
)
once(
"""          this.setState({ isAdmin: true, adminToken: data.adminToken, showAdminLogin: false, adminPasswordInput: '' }, () => { this.fetchAccessList(); this.fetchRevisionNovels(); });""",
"""          this.setState({ isAdmin: true, adminToken: data.adminToken, showAdminLogin: false, adminPasswordInput: '' }, () => { this.fetchAccessList(); this.fetchRevisionNovels(); this.fetchAudioCatalog('', data.adminToken); });""",
"admin audio catalog",
)
once(
"""    this.setState({ isAdmin: false, adminToken: '', editingIndex: null });""",
"""    if (this.state.audioPlayerOpen) this.closeAudioPlayer();
    this.setState({ isAdmin: false, adminToken: '', editingIndex: null, audioCatalog: [] });""",
"admin logout audio cleanup",
)
once(
"""    this.setState({ isUnlocked: false, visitorName: '', visitorCanDownload: false, visitorCanCopy: false });""",
"""    if (this.state.audioPlayerOpen) this.closeAudioPlayer();
    this.setState({ isUnlocked: false, visitorName: '', visitorCanDownload: false, visitorCanCopy: false, visitorAccessCode: '', audioCatalog: [] });""",
"page lock audio cleanup",
)

# Render data
once(
"""      const effPageCount = (langInfo && langInfo.pageCount) || b.pageCount;
      const hookLong =""",
"""      const effPageCount = (langInfo && langInfo.pageCount) || b.pageCount;
      const audioCandidates = (s.audioCatalog || []).filter(a => a.title === b.title);
      const audioEntry = (activeLang && audioCandidates.find(a => a.language_code === activeLang)) || audioCandidates[0] || null;
      const hookLong =""",
"audio entry per book",
)
once(
"""        epubHref: '#',
        bgHref:""",
"""        epubHref: '#',
        audioHref: '#',
        audioColor: audioEntry ? 'var(--gold)' : muted,
        audioButtonLabel: audioEntry && audioEntry.progress && Number(audioEntry.progress.position_seconds) > 5
          ? (s.uiLang === 'en' ? 'Continue' : 'Weiterhören')
          : (s.uiLang === 'en' ? 'Listen' : 'Hören'),
        onAudio: (e) => {
          e.preventDefault();
          if (audioEntry) this.openAudioPlayer(b.title, audioEntry.language_code || '');
          else window.alert(this.tr('Für dieses Buch ist für deinen Zugang noch keine Audiofassung verfügbar.', 'No audiobook is available for your access yet.'));
        },
        bgHref:""",
"audio button data",
)

# Public buttons
once(
"""<a href="{{ item.epubHref }}" sc-camel-on-click="{{ item.onEpub }}" style="display:inline-block; border:1px solid {{ item.epubColor }}; color:{{ item.epubColor }}; font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; padding:9px 16px; text-decoration:none;">EPUB</a>""",
"""<a href="{{ item.epubHref }}" sc-camel-on-click="{{ item.onEpub }}" style="display:inline-block; border:1px solid {{ item.epubColor }}; color:{{ item.epubColor }}; font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; padding:9px 16px; text-decoration:none;">EPUB</a>
                <a href="{{ item.audioHref }}" sc-camel-on-click="{{ item.onAudio }}" style="display:inline-block; border:1px solid {{ item.audioColor }}; color:{{ item.audioColor }}; font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; padding:9px 16px; text-decoration:none;">{{ item.audioButtonLabel }}</a>""",
"single book audio button",
)
once(
"""<a href="{{ book.epubHref }}" sc-camel-on-click="{{ book.onEpub }}" style="display:inline-block; border:1px solid {{ book.epubColor }}; color:{{ book.epubColor }}; font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; padding:9px 16px; text-decoration:none;">EPUB</a>""",
"""<a href="{{ book.epubHref }}" sc-camel-on-click="{{ book.onEpub }}" style="display:inline-block; border:1px solid {{ book.epubColor }}; color:{{ book.epubColor }}; font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; padding:9px 16px; text-decoration:none;">EPUB</a>
                    <a href="{{ book.audioHref }}" sc-camel-on-click="{{ book.onAudio }}" style="display:inline-block; border:1px solid {{ book.audioColor }}; color:{{ book.audioColor }}; font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; padding:9px 16px; text-decoration:none;">{{ book.audioButtonLabel }}</a>""",
"series book audio button",
)

# Player overlay
once(
"""  <sc-if value="{{ readerOpen }}" hint-placeholder-val="{{ false }}">""",
"""  <sc-if value="{{ audioPlayerOpen }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed; inset:0; background:rgba(22,20,15,.94); z-index:55; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;">
      <div style="width:min(760px,100%); max-height:92vh; overflow:auto; background:var(--bone); border:1px solid rgba(217,186,124,.45); padding:24px; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:20px;">
          <div>
            <span style="font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold);">{{ audioPlayerLanguage }}</span>
            <h3 style="font-family:'Cormorant Garamond',serif; font-weight:400; font-size:28px; margin:4px 0 0;">{{ audioPlayerTitle }}</h3>
          </div>
          <button style="background:none; border:1px solid var(--rule); color:var(--ink-2); font-family:'Archivo',sans-serif; font-size:11px; text-transform:uppercase; padding:7px 12px; cursor:pointer;" sc-camel-on-click="{{ closeAudioPlayer }}">{{ ui.close }}</button>
        </div>
        <sc-if value="{{ audioPlayerLoading }}" hint-placeholder-val="{{ false }}">
          <div style="padding:32px 0; text-align:center; color:var(--ink-3);">{{ ui.loading }}</div>
        </sc-if>
        <sc-if value="{{ audioPlayerError }}" hint-placeholder-val="{{ false }}">
          <div style="padding:18px; border:1px solid #c99; color:#8f3028; margin-bottom:16px;">{{ audioPlayerError }}</div>
        </sc-if>
        <sc-if value="{{ audioPlayerReady }}" hint-placeholder-val="{{ false }}">
          <div style="border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); padding:20px 0; margin-bottom:18px;">
            <div style="font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); margin-bottom:6px;">{{ audioChapterPosition }}</div>
            <div style="font-family:'Cormorant Garamond',serif; font-size:22px; margin-bottom:16px;">{{ audioCurrentChapterTitle }}</div>
            <input type="range" min="0" max="{{ audioSeekMax }}" value="{{ audioSeekValue }}" sc-camel-on-change="{{ seekAudio }}" style="width:100%; accent-color:var(--gold);">
            <div style="display:flex; justify-content:space-between; font-family:'Archivo',sans-serif; font-size:10px; color:var(--ink-3); margin-top:4px;">
              <span>{{ audioCurrentTimeLabel }}</span><span>{{ audioDurationLabel }}</span>
            </div>
            <div style="display:flex; justify-content:center; align-items:center; gap:10px; margin-top:18px; flex-wrap:wrap;">
              <button style="background:none; border:1px solid var(--rule); color:var(--ink); font-size:18px; width:42px; height:42px; cursor:pointer;" sc-camel-on-click="{{ audioPrev }}">‹</button>
              <button style="background:var(--ink); border:1px solid var(--ink); color:var(--bone); font-family:'Archivo',sans-serif; font-size:11px; text-transform:uppercase; min-width:110px; height:42px; padding:0 18px; cursor:pointer;" sc-camel-on-click="{{ toggleAudioPlayback }}">{{ audioPlayLabel }}</button>
              <button style="background:none; border:1px solid var(--rule); color:var(--ink); font-size:18px; width:42px; height:42px; cursor:pointer;" sc-camel-on-click="{{ audioNext }}">›</button>
              <button style="background:none; border:1px solid var(--gold); color:var(--gold); font-family:'Archivo',sans-serif; font-size:11px; min-width:54px; height:42px; cursor:pointer;" sc-camel-on-click="{{ cycleAudioRate }}">{{ audioRateLabel }}</button>
            </div>
          </div>
          <div style="font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3); margin-bottom:8px;">Kapitel</div>
          <div style="display:grid; gap:6px;">
            <sc-for list="{{ audioChapterRows }}" as="ch" hint-placeholder-count="6">
              <button type="button" style="{{ ch.style }}" sc-camel-on-click="{{ ch.select }}">
                <span style="flex:1; text-align:left;">{{ ch.label }}</span>
                <span style="font-size:10px; color:var(--ink-3);">{{ ch.duration }}</span>
              </button>
            </sc-for>
          </div>
        </sc-if>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ readerOpen }}" hint-placeholder-val="{{ false }}">""",
"audio player overlay",
)

# Admin rights UI
once(
"""                  </sc-if>
                  <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">""",
"""                  </sc-if>
                  <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--rule);">
                    <p style="font-size:11px; color:var(--ink-3); margin:0 0 6px;">Audio-Zugriff pro Buch:</p>
                    <div style="display:grid; gap:4px; max-height:180px; overflow-y:auto; padding-left:4px;">
                      <sc-for list="{{ row.audioBookRows }}" as="arow" hint-placeholder-count="3">
                        <label style="display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-2);"><input type="checkbox" checked="{{ arow.checked }}" sc-camel-on-change="{{ arow.setListen }}"> {{ arow.title }}</label>
                      </sc-for>
                    </div>
                  </div>
                  <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">""",
"existing user audio rights UI",
)
once(
"""          </sc-if>
          <button style="background:var(--gold); border:1px solid var(--gold); color:var(--bone); font-family:'Archivo',sans-serif; font-size:12px; text-transform:uppercase; padding:9px 16px; cursor:pointer;" sc-camel-on-click="{{ addAccessPerson }}">+ Zugang erstellen</button>""",
"""          </sc-if>
          <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--rule);">
            <p style="font-size:11px; color:var(--ink-3); margin:0 0 6px;">Audio-Zugriff pro Buch:</p>
            <div style="display:grid; gap:4px; max-height:180px; overflow-y:auto; padding-left:4px;">
              <sc-for list="{{ newAccessAudioBookRows }}" as="arow" hint-placeholder-count="3">
                <label style="display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-2);"><input type="checkbox" checked="{{ arow.checked }}" sc-camel-on-change="{{ arow.setListen }}"> {{ arow.title }}</label>
              </sc-for>
            </div>
          </div>
          <button style="background:var(--gold); border:1px solid var(--gold); color:var(--bone); font-family:'Archivo',sans-serif; font-size:12px; text-transform:uppercase; padding:9px 16px; cursor:pointer;" sc-camel-on-click="{{ addAccessPerson }}">+ Zugang erstellen</button>""",
"new user audio rights UI",
)

# Admin view models
once(
"""        : { visibleBooks: p.visibleBooks, canDownload: p.canDownload, canCopy: p.canCopy };""",
"""        : { visibleBooks: p.visibleBooks, canDownload: p.canDownload, canCopy: p.canCopy, showPoems: p.showPoems, epubAccess: p.epubAccess || {}, audioAccess: p.audioAccess || {} };""",
"access fallback draft",
)
once(
"""        epubBookRows: finishedBookTitles.map(title => ({
          title: title,
          readChecked: !!(draft.epubAccess && draft.epubAccess[title] && draft.epubAccess[title].read),
          downloadChecked: !!(draft.epubAccess && draft.epubAccess[title] && draft.epubAccess[title].download),
          setRead: (e) => this.setEditAccessEpubRead(p.code, title, e),
          setDownload: (e) => this.setEditAccessEpubDownload(p.code, title, e)
        }))
      };""",
"""        epubBookRows: finishedBookTitles.map(title => ({
          title: title,
          readChecked: !!(draft.epubAccess && draft.epubAccess[title] && draft.epubAccess[title].read),
          downloadChecked: !!(draft.epubAccess && draft.epubAccess[title] && draft.epubAccess[title].download),
          setRead: (e) => this.setEditAccessEpubRead(p.code, title, e),
          setDownload: (e) => this.setEditAccessEpubDownload(p.code, title, e)
        })),
        audioBookRows: allBookTitles.map(title => ({
          title,
          checked: !!(draft.audioAccess && draft.audioAccess[title]),
          setListen: (e) => this.setEditAccessAudio(p.code, title, e)
        }))
      };""",
"existing user audio rights view model",
)

# Player view model
once(
"""    const readerTocRows = s.readerToc.map(item => ({ label: item.label, jump: () => this.goToTocHref(item.href) }));

    return {""",
"""    const readerTocRows = s.readerToc.map(item => ({ label: item.label, jump: () => this.goToTocHref(item.href) }));
    const currentAudioChapter = (s.audioChapters || [])[s.audioChapterIndex || 0] || null;
    const audioChapterRows = (s.audioChapters || []).map((ch, idx) => ({
      label: (idx + 1) + '. ' + (ch.title || ('Chapter ' + (idx + 1))),
      duration: this.formatAudioTime_(ch.duration_seconds || 0),
      style: 'display:flex; align-items:center; gap:10px; width:100%; border:1px solid ' + (idx === s.audioChapterIndex ? 'var(--gold)' : 'var(--rule)') + '; background:' + (idx === s.audioChapterIndex ? 'rgba(212,175,55,.08)' : 'transparent') + '; color:var(--ink); padding:9px 10px; cursor:pointer; font-family:Newsreader,Georgia,serif; font-size:14px;',
      select: () => this.selectAudioChapter(idx)
    }));

    return {""",
"audio player rows",
)
once(
"""      readerSpeaking: s.readerSpeaking, toggleReadingAloud: this.toggleReadingAloud,
      readerSpeakLabel: s.readerSpeaking ? 'Stop' : 'Vorlesen',
      hasSpeechSupport: typeof window !== 'undefined' && !!window.speechSynthesis,""",
"""      readerSpeaking: s.readerSpeaking, toggleReadingAloud: this.toggleReadingAloud,
      readerSpeakLabel: s.readerSpeaking ? 'Stop' : 'Vorlesen',
      hasSpeechSupport: typeof window !== 'undefined' && !!window.speechSynthesis,
      audioPlayerOpen: s.audioPlayerOpen, audioPlayerTitle: s.audioPlayerTitle, audioPlayerLanguage: s.audioPlayerLanguage,
      audioPlayerLoading: s.audioPlayerLoading, audioPlayerError: s.audioPlayerError,
      audioPlayerReady: !s.audioPlayerLoading && !s.audioPlayerError && !!currentAudioChapter,
      closeAudioPlayer: this.closeAudioPlayer, toggleAudioPlayback: this.toggleAudioPlayback,
      audioPrev: this.audioPrev, audioNext: this.audioNext, seekAudio: this.seekAudio, cycleAudioRate: this.cycleAudioRate,
      audioPlayLabel: s.audioPlaying ? 'Pause' : (s.uiLang === 'en' ? 'Play' : 'Abspielen'),
      audioRateLabel: (s.audioRate || 1) + '×',
      audioSeekMax: Math.max(1, Number(s.audioDuration || (currentAudioChapter && currentAudioChapter.duration_seconds) || 1)),
      audioSeekValue: Math.max(0, Number(s.audioCurrentTime || 0)),
      audioCurrentTimeLabel: this.formatAudioTime_(s.audioCurrentTime),
      audioDurationLabel: this.formatAudioTime_(s.audioDuration || (currentAudioChapter && currentAudioChapter.duration_seconds) || 0),
      audioCurrentChapterTitle: currentAudioChapter ? currentAudioChapter.title : '',
      audioChapterPosition: currentAudioChapter ? ((s.audioChapterIndex + 1) + ' / ' + s.audioChapters.length) : '',
      audioChapterRows,""",
"audio player return values",
)
once(
"""      newAccessEpubBookRows: finishedBookTitles.map(title => ({
        title: title,
        readChecked: !!(s.newAccessEpubAccess[title] && s.newAccessEpubAccess[title].read),
        downloadChecked: !!(s.newAccessEpubAccess[title] && s.newAccessEpubAccess[title].download),
        setRead: (e) => this.setNewAccessEpubRead(title, e),
        setDownload: (e) => this.setNewAccessEpubDownload(title, e)
      })),
      addAccessPerson: this.addAccessPerson,""",
"""      newAccessEpubBookRows: finishedBookTitles.map(title => ({
        title: title,
        readChecked: !!(s.newAccessEpubAccess[title] && s.newAccessEpubAccess[title].read),
        downloadChecked: !!(s.newAccessEpubAccess[title] && s.newAccessEpubAccess[title].download),
        setRead: (e) => this.setNewAccessEpubRead(title, e),
        setDownload: (e) => this.setNewAccessEpubDownload(title, e)
      })),
      newAccessAudioBookRows: allBookTitles.map(title => ({
        title,
        checked: !!s.newAccessAudioAccess[title],
        setListen: (e) => this.setNewAccessAudio(title, e)
      })),
      addAccessPerson: this.addAccessPerson,""",
"new user audio rights view model",
)

# Lightweight validation.
for marker in [
    "AUDIO_API_URL",
    "audioPlayerOpen",
    "fetchAudioCatalog",
    "newAccessAudioBookRows",
    "Audio-Zugriff pro Buch",
    "item.audioHref",
    "book.audioHref",
]:
    if marker not in tpl:
        raise RuntimeError("Validation marker missing: " + marker)

serialized = json.dumps(tpl, ensure_ascii=False, separators=(",", ":")).replace("</script>", "<\\/script>")
json.loads(serialized)

html = html[:start + len(open_tag)] + serialized + html[end:]
path.write_text(html, encoding="utf-8")
print("Audiobook integration patched successfully.")
