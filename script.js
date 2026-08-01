class App {
            constructor() {
                this.dom = {
                    input: document.getElementById('urlInput'),
                    btn: document.getElementById('searchBtn'),
                    pasteBtn: document.getElementById('pasteBtn'),
                    clearBtn: document.getElementById('clearBtn'),
                    loader: document.getElementById('loader'),
                    resultArea: document.getElementById('result-area'),
                    resThumb: document.getElementById('resThumb'),
                    resTitle: document.getElementById('resTitle'),
                    resDuration: document.getElementById('resDuration'),
                    resSource: document.getElementById('resSource'),
                    videoList: document.getElementById('tab-video'),
                    audioList: document.getElementById('tab-audio'),
                    tabBtns: document.querySelectorAll('.tab-btn'),
                    historyList: document.getElementById('historyList'),
                    clearHistoryBtn: document.getElementById('clearHistory'),
                    settingsModal: document.getElementById('settingsModal'),
                    settingsBtn: document.getElementById('settingsBtn'),
                    themeToggleModal: document.getElementById('themeToggleModal'),
                    themeToggleBtn: document.getElementById('themeToggleBtn'),
                    historyToggle: document.getElementById('historyToggle'),
                    menuToggle: document.getElementById('menuToggle'),
                    closeDrawer: document.getElementById('closeDrawer'),
                    mobileDrawer: document.getElementById('mobileDrawer'),
                    drawerOverlay: document.getElementById('drawerOverlay'),
                    drawerLinks: document.querySelectorAll('.drawer-link'),
                    backToTop: document.getElementById('backToTop'),
                    faqQuestions: document.querySelectorAll('.faq-question'),
                    navLinks: document.querySelectorAll('.nav-link[data-nav]')
                };

                this.state = {
                    isLoading: false,
                    currentData: null,
                    theme: localStorage.getItem('theme') || 'dark-theme',
                    saveHistory: localStorage.getItem('saveHistory') !== 'false',
                    history: JSON.parse(localStorage.getItem('dl_history') || '[]')
                };

                this.init();
            }

            init() {
                this.applyTheme();
                this.renderHistory();
                this.bindEvents();
                this.initScrollSpy();
                this.initPlayer();
            }

            bindEvents() {
                this.dom.btn.addEventListener('click', () => this.fetchData());
                this.dom.input.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.fetchData(); });

                // Mobile drawer dropdown
                document.querySelectorAll('.drawer-dropdown-toggle').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.target.closest('.drawer-dropdown').classList.toggle('active');
                    });
                });

                this.dom.pasteBtn.addEventListener('click', async () => {
                    try {
                        const text = await navigator.clipboard.readText();
                        this.dom.input.value = text;
                        this.showToast('Link pasted', 'success');
                    } catch (err) {
                        this.showToast('Clipboard permission denied', 'error');
                    }
                });

                this.dom.clearBtn.addEventListener('click', () => { this.dom.input.value = ''; this.dom.input.focus(); });

                // Settings modal
                this.dom.settingsBtn.addEventListener('click', () => this.dom.settingsModal.classList.add('active'));
                this.dom.settingsModal.addEventListener('click', (e) => { if (e.target === this.dom.settingsModal) this.dom.settingsModal.classList.remove('active'); });
                this.dom.themeToggleModal.addEventListener('change', (e) => {
                    this.state.theme = e.target.checked ? 'dark-theme' : 'light-theme';
                    this.applyTheme();
                });
                this.dom.historyToggle.addEventListener('change', (e) => {
                    this.state.saveHistory = e.target.checked;
                    localStorage.setItem('saveHistory', this.state.saveHistory);
                });

                // Header theme toggle
                this.dom.themeToggleBtn.addEventListener('click', () => {
                    this.state.theme = this.state.theme === 'dark-theme' ? 'light-theme' : 'dark-theme';
                    this.applyTheme();
                });

                // History
                this.dom.clearHistoryBtn.addEventListener('click', () => {
                    this.state.history = [];
                    this.saveHistory();
                    this.renderHistory();
                });

                // Mobile drawer
                this.dom.menuToggle.addEventListener('click', () => this.openDrawer());
                this.dom.closeDrawer.addEventListener('click', () => this.closeDrawer());
                this.dom.drawerOverlay.addEventListener('click', () => this.closeDrawer());
                this.dom.drawerLinks.forEach(link => link.addEventListener('click', () => this.closeDrawer()));

                // FAQ accordion
                this.dom.faqQuestions.forEach(q => {
                    q.addEventListener('click', () => {
                        const item = q.closest('.faq-item');
                        const wasOpen = item.classList.contains('open');
                        document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
                        if (!wasOpen) item.classList.add('open');
                    });
                });

                // Back to top
                window.addEventListener('scroll', () => {
                    this.dom.backToTop.classList.toggle('show', window.scrollY > 500);
                });
                this.dom.backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

            }

            initScrollSpy() {
                const sections = Array.from(this.dom.navLinks).map(l => document.getElementById(l.dataset.nav)).filter(Boolean);
                if (!('IntersectionObserver' in window) || sections.length === 0) return;
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            this.dom.navLinks.forEach(l => l.classList.toggle('active', l.dataset.nav === entry.target.id));
                        }
                    });
                }, { rootMargin: '-45% 0px -50% 0px' });
                sections.forEach(s => observer.observe(s));
            }

            openDrawer() { this.dom.mobileDrawer.classList.add('active'); this.dom.drawerOverlay.classList.add('active'); document.body.style.overflow = 'hidden'; }
            closeDrawer() { this.dom.mobileDrawer.classList.remove('active'); this.dom.drawerOverlay.classList.remove('active'); document.body.style.overflow = ''; }

            applyTheme() {
                document.body.className = this.state.theme;
                this.dom.themeToggleModal.checked = this.state.theme === 'dark-theme';
                localStorage.setItem('theme', this.state.theme);
            }

            async fetchData() {
                const url = this.dom.input.value.trim();
                if (!url) { this.showToast('Please enter a valid URL', 'error'); return; }
                if (!url.startsWith('http')) { this.showToast('URL must start with http:// or https://', 'error'); return; }
                
                // YouTube validation
                if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                    this.showToast('Please enter a valid YouTube link', 'error');
                    return;
                }

                this.setLoading(true);
                this.dom.resultArea.style.display = 'none';

                try {
                    const apiUrl = `https://r-gengpt-api.vercel.app/api/video/download?url=${encodeURIComponent(url)}`;
                    const response = await fetch(apiUrl);
                    const json = await response.json();
                    const data = json.data || json;

                    if (!data) throw new Error('No data received from server');
                    if (data.statusCode && data.statusCode !== 200) throw new Error(data.message || 'API Error');
                    if (!data.medias && !data.formats) throw new Error('No video formats found');

                    this.state.currentData = data;
                    this.renderResult(data);
                    this.addToHistory(data);
                    this.showToast('Video processed successfully', 'success');
                } catch (error) {
                    console.error(error);
                    this.showToast(error.message || 'Failed to fetch video. Please try again.', 'error');
                } finally {
                    this.setLoading(false);
                }
            }

            setLoading(bool) {
                this.state.isLoading = bool;
                this.dom.btn.disabled = bool;
                if (bool) {
                    this.dom.btn.innerHTML = '<div class="spinner"></div>';
                    this.dom.loader.classList.add('active');
                } else {
                    this.dom.btn.innerHTML = '<span>Download</span>';
                    this.dom.loader.classList.remove('active');
                }
            }

            renderResult(data) {
                this.dom.resTitle.textContent = data.title || 'Unknown Video';

                // Thumbnail & Fallbacks
                const inputUrl = this.dom.input.value.trim();
                const ytMatch = inputUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([\w-]{11})/i);

                let thumbUrl = data.thumbnail || data.thumb || data.picture || data.cover || data.image || '';

                if (ytMatch && ytMatch[1]) {
                    if (!thumbUrl || thumbUrl.includes('placeholder') || thumbUrl.includes('3dots')) {
                        thumbUrl = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
                    }
                }

                this.dom.resThumb.onerror = () => {
                    if (ytMatch && ytMatch[1]) {
                        this.dom.resThumb.src = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
                    } else {
                        this.dom.resThumb.src = 'https://picsum.photos/seed/media/600/340';
                    }
                };

                this.dom.resThumb.src = thumbUrl || (ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : 'https://picsum.photos/seed/media/600/340');
                this.dom.resDuration.textContent = this.formatTime(data.duration);
                if (this.dom.resSource) this.dom.resSource.textContent = data.source || 'Source';

                this.dom.videoList.innerHTML = '';
                this.dom.audioList.innerHTML = '';

                const formats = data.medias || data.formats || [];

                formats.forEach((item, index) => {
                    const isVideo = item.type === 'video' || item.mimeType?.includes('video') || item.ext === 'mp4';
                    const quality = item.quality || (item.height ? `${item.height}p` : 'HQ');
                    const size = item.size ? ` (${item.size})` : '';
                    const safeUrl = (item.url || '').replace(/'/g, "\\'");
                    const ext = (item.ext || (isVideo ? 'mp4' : 'mp3')).toLowerCase();
                    const safeTitle = (data.title || 'download').replace(/'/g, "\\'").replace(/"/g, '&quot;');

                    // Store first video URL for inline preview
                    if (isVideo && index === 0 && item.url) {
                        this.state.previewUrl = item.url;
                    }

                    const html = `
                <div class="format-item">
                    <div class="format-info">
                        <h4>${quality}${size}</h4>
                        <span>${ext.toUpperCase()}</span>
                    </div>
                    <div class="format-actions">
                        <button class="dl-btn" onclick="app.triggerDownload('${safeUrl}', '${ext}', '${safeTitle}', '${quality}')">
                            Download
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;

                    if (isVideo) this.dom.videoList.insertAdjacentHTML('beforeend', html);
                    else this.dom.audioList.insertAdjacentHTML('beforeend', html);
                });

                this.dom.resultArea.style.display = 'block';
                this.switchTab('video');
                this.dom.resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

                // Reset preview player when new result loads
                const player = document.getElementById('inlinePlayer');
                const thumb = document.getElementById('resThumb');
                if (player) { player.pause(); player.src = ''; player.classList.remove('active'); }
                if (thumb) thumb.style.display = 'block';
                const overlay = document.getElementById('playOverlay');
                if (overlay) overlay.style.opacity = '';
            }

            openPreview() {
                if (!this.state.previewUrl) return;
                const wrap = document.getElementById('customPlayerWrap');
                const thumb = document.getElementById('thumbWrap').querySelector('img');
                const overlay = document.getElementById('playOverlay');
                wrap.classList.add('active');
                thumb.style.display = 'none';
                overlay.style.display = 'none';
                document.getElementById('resDuration').style.display = 'none';
                const vid = document.getElementById('inlinePlayer');
                if (!vid.src || vid.src !== this.state.previewUrl) {
                    vid.src = this.state.previewUrl;
                }
                vid.play().catch(() => {});
                this._updatePlayIcon(true);
            }

            closePreview() {
                const wrap = document.getElementById('customPlayerWrap');
                const thumb = document.getElementById('thumbWrap').querySelector('img');
                const overlay = document.getElementById('playOverlay');
                const vid = document.getElementById('inlinePlayer');
                vid.pause();
                wrap.classList.remove('active');
                thumb.style.display = 'block';
                overlay.style.display = '';
                document.getElementById('resDuration').style.display = '';
            }

            _updatePlayIcon(playing) {
                const icon = document.getElementById('cpPlayIcon');
                if (!icon) return;
                icon.innerHTML = playing
                    ? '<path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/>'
                    : '<path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>';
            }

            _fmtTime(s) {
                if (isNaN(s)) return '0:00';
                const m = Math.floor(s / 60);
                const sec = Math.floor(s % 60).toString().padStart(2, '0');
                return `${m}:${sec}`;
            }

            initPlayer() {
                const vid = document.getElementById('inlinePlayer');
                const seekWrap = document.getElementById('cpSeek');
                const fill = document.getElementById('cpSeekFill');
                const thumb = document.getElementById('cpSeekThumb');
                const timeEl = document.getElementById('cpTime');
                const playBtn = document.getElementById('cpPlayBtn');
                const muteBtn = document.getElementById('cpMuteBtn');
                const volSlider = document.getElementById('cpVolSlider');
                const fullBtn = document.getElementById('cpFullBtn');
                const closeBtn = document.getElementById('cpCloseBtn');
                if (!vid) return;

                // Time update
                vid.addEventListener('timeupdate', () => {
                    if (!vid.duration) return;
                    const pct = (vid.currentTime / vid.duration) * 100;
                    fill.style.width = pct + '%';
                    thumb.style.left = pct + '%';
                    timeEl.textContent = this._fmtTime(vid.currentTime) + ' / ' + this._fmtTime(vid.duration);
                });

                // Play/pause button
                playBtn.addEventListener('click', () => {
                    if (vid.paused) { vid.play(); }
                    else { vid.pause(); }
                });

                // Click on video to play/pause
                vid.addEventListener('click', () => {
                    if (vid.paused) vid.play(); else vid.pause();
                });

                vid.addEventListener('play', () => {
                    this._updatePlayIcon(true);
                    document.getElementById('customPlayerWrap')?.classList.remove('paused');
                });
                vid.addEventListener('pause', () => {
                    this._updatePlayIcon(false);
                    document.getElementById('customPlayerWrap')?.classList.add('paused');
                });
                vid.addEventListener('ended', () => {
                    this._updatePlayIcon(false);
                    document.getElementById('customPlayerWrap')?.classList.add('paused');
                });


                // Seek
                let seeking = false;
                const seek = (e) => {
                    const rect = seekWrap.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    if (vid.duration) vid.currentTime = pct * vid.duration;
                };
                seekWrap.addEventListener('mousedown', (e) => { seeking = true; seek(e); });
                document.addEventListener('mousemove', (e) => { if (seeking) seek(e); });
                document.addEventListener('mouseup', () => { seeking = false; });

                // Touch seek
                seekWrap.addEventListener('touchstart', (e) => { seek(e.touches[0]); }, { passive: true });
                seekWrap.addEventListener('touchmove', (e) => { seek(e.touches[0]); }, { passive: true });

                // Volume
                volSlider.addEventListener('input', () => { vid.volume = volSlider.value; vid.muted = volSlider.value == 0; });
                muteBtn.addEventListener('click', () => {
                    vid.muted = !vid.muted;
                    volSlider.value = vid.muted ? 0 : (vid.volume || 0.8);
                    if (!vid.muted && vid.volume === 0) { vid.volume = 0.8; volSlider.value = 0.8; }
                });

                // Fullscreen
                fullBtn.addEventListener('click', () => {
                    const wrap = document.getElementById('customPlayerWrap');
                    if (document.fullscreenElement) document.exitFullscreen();
                    else wrap.requestFullscreen?.() || vid.webkitEnterFullscreen?.();
                });

                // Close
                closeBtn.addEventListener('click', () => this.closePreview());
            }

            // legacy stub — was used before, kept so nothing breaks
            togglePreview() { this.openPreview(); }

            async triggerDownload(url, ext, rawTitle, quality) {
                const cleanTitle = (rawTitle || 'video').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
                const fileName = `${cleanTitle}.${ext || 'mp4'}`;

                // ─── Download proxy (Vercel /api/proxy) ──────────────────────
                // Same-origin API: fetches any URL server-side and returns binary
                // with Content-Disposition: attachment — instant file download.
                const SNAP_DL_PROXY = '/api/proxy';

                // Save a blob as fileName
                const saveBlobAs = (blob) => {
                    if (!blob || blob.size === 0) throw new Error('Empty file received');
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = fileName;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 12000);
                };

                // Fetch URL → blob
                const fetchBlob = async (fetchUrl, opts = {}) => {
                    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000), ...opts });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    if (!blob || blob.size === 0) throw new Error('Empty response');
                    return blob;
                };

                const isYouTubeCDN = url.includes('googlevideo.com') || url.includes('youtube.com/videoplayback');

                // ═══ YOUTUBE PATH ═════════════════════════════════════════════
                if (isYouTubeCDN) {
                    this.showToast('⏳ Downloading YouTube video…', 'success');
                    const ytUrl = this.dom.input.value.trim();
                    const isAudio = ['mp3', 'm4a', 'ogg', 'opus'].includes(ext);
                    const vQuality = (quality || '720').replace('p', '').replace('HQ', '720');

                    // 1️⃣ Our /api/youtube endpoint (ytdl-core server-side) — primary method
                    try {
                        const apiUrl = `/api/youtube?url=${encodeURIComponent(ytUrl)}&quality=${vQuality}&mode=${isAudio ? 'audio' : 'video'}`;
                        const blob = await fetchBlob(apiUrl);
                        saveBlobAs(blob);
                        this.showToast('✅ Download started!', 'success');
                        return;
                    } catch (ytErr) {
                        console.warn('[/api/youtube] failed:', ytErr.message);
                    }

                    // 2️⃣ Cobalt API fallback
                    try {
                        const cobaltRes = await fetch('https://api.cobalt.tools/', {
                            method: 'POST',
                            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                url: ytUrl,
                                downloadMode: isAudio ? 'audio' : 'auto',
                                videoQuality: vQuality,
                                filenameStyle: 'pretty'
                            }),
                            signal: AbortSignal.timeout(20000)
                        });
                        if (!cobaltRes.ok) throw new Error(`Cobalt HTTP ${cobaltRes.status}`);
                        const cobalt = await cobaltRes.json();
                        if (cobalt.status === 'error') throw new Error(cobalt.error?.code || 'Cobalt error');
                        if (!cobalt.url) throw new Error('No URL from Cobalt');
                        const blob = await fetchBlob(cobalt.url);
                        saveBlobAs(blob);
                        this.showToast('✅ Download started!', 'success');
                        return;
                    } catch (cobaltErr) {
                        console.warn('[Cobalt] failed:', cobaltErr.message);
                    }

                    this.showToast('❌ YouTube download failed. Try a different quality.', 'error');
                    return;
                }

                // ═══ ALL OTHER PLATFORMS (Facebook, Instagram, etc.) ══════════
                this.showToast('⏳ Downloading…', 'success');

                // 1️⃣ Vercel proxy (server-side, adds Content-Disposition: attachment)
                try {
                    const blob = await fetchBlob(`${SNAP_DL_PROXY}?url=${encodeURIComponent(url)}&name=${encodeURIComponent(fileName)}`);
                    saveBlobAs(blob);
                    this.showToast('✅ Download started!', 'success');
                    return;
                } catch (e1) { console.warn('[proxy] failed:', e1.message); }

                // 2️⃣ Direct fetch (works if CDN allows CORS)
                try {
                    const blob = await fetchBlob(url);
                    saveBlobAs(blob);
                    this.showToast('✅ Download started!', 'success');
                    return;
                } catch (e2) { console.warn('[direct] failed:', e2.message); }

                // 3️⃣ corsproxy.io
                try {
                    const blob = await fetchBlob(`https://corsproxy.io/?url=${encodeURIComponent(url)}`);
                    saveBlobAs(blob);
                    this.showToast('✅ Download started!', 'success');
                    return;
                } catch (e3) { console.warn('[corsproxy.io] failed:', e3.message); }

                // 4️⃣ allorigins
                try {
                    const blob = await fetchBlob(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
                    saveBlobAs(blob);
                    this.showToast('✅ Download started!', 'success');
                    return;
                } catch (e4) { console.warn('[allorigins] failed:', e4.message); }

                // 5️⃣ thingproxy
                try {
                    const blob = await fetchBlob(`https://thingproxy.freeboard.io/fetch/${url}`);
                    saveBlobAs(blob);
                    this.showToast('✅ Download started!', 'success');
                    return;
                } catch (e5) { console.warn('[thingproxy] failed:', e5.message); }

                // 6️⃣ XMLHttpRequest (sometimes bypasses where fetch fails)
                try {
                    const blob = await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', url, true);
                        xhr.responseType = 'blob';
                        xhr.timeout = 30000;
                        xhr.onload = () => (xhr.status === 200 && xhr.response?.size > 0) ? resolve(xhr.response) : reject(new Error(`XHR ${xhr.status}`));
                        xhr.onerror = () => reject(new Error('XHR error'));
                        xhr.ontimeout = () => reject(new Error('XHR timeout'));
                        xhr.send();
                    });
                    saveBlobAs(blob);
                    this.showToast('✅ Download started!', 'success');
                    return;
                } catch (e6) { console.warn('[XHR] failed:', e6.message); }

                this.showToast('❌ Download failed. Please try again.', 'error');
            }

            switchTab(type) {
                this.dom.tabBtns.forEach(btn => btn.classList.remove('active'));
                if (type === 'video') {
                    this.dom.tabBtns[0].classList.add('active');
                    this.dom.videoList.style.display = 'flex';
                    this.dom.audioList.style.display = 'none';
                } else {
                    this.dom.tabBtns[1].classList.add('active');
                    this.dom.videoList.style.display = 'none';
                    this.dom.audioList.style.display = 'flex';
                }
            }

            addToHistory(data) {
                if (!this.state.saveHistory) return;
                this.state.history = this.state.history.filter(item => item.thumbnail !== data.thumbnail);
                const newItem = { title: data.title, thumbnail: data.thumbnail, url: this.dom.input.value, time: new Date().getTime() };
                this.state.history.unshift(newItem);
                if (this.state.history.length > 8) this.state.history.pop();
                this.saveHistory();
                this.renderHistory();
            }

            saveHistory() { localStorage.setItem('dl_history', JSON.stringify(this.state.history)); }

            deleteHistoryItem(index) {
                this.state.history.splice(index, 1);
                this.saveHistory();
                this.renderHistory();
            }

            renderHistory() {
                if (this.state.history.length === 0) {
                    this.dom.historyList.innerHTML = '<div class="empty-history-msg">No recent downloads</div>';
                    return;
                }
                this.dom.historyList.innerHTML = this.state.history.map((item, index) => `
            <div class="history-item">
                <img src="${item.thumbnail}" class="h-thumb" onerror="this.src='https://picsum.photos/seed/error/50/50'" onclick="app.loadFromHistory('${item.url}')">
                <div class="h-info" onclick="app.loadFromHistory('${item.url}')">
                    <div class="h-title">${item.title}</div>
                    <div class="h-time">${this.timeSince(item.time)}</div>
                </div>
                <button class="h-delete" title="Remove" onclick="event.stopPropagation(); app.deleteHistoryItem(${index})">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `).join('');
            }

            loadFromHistory(url) {
                this.dom.input.value = url;
                this.fetchData();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }

            formatTime(seconds) {
                if (!seconds) return '00:00';
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            }

            timeSince(date) {
                const seconds = Math.floor((new Date() - date) / 1000);
                let interval = seconds / 31536000;
                if (interval > 1) return Math.floor(interval) + ' years ago';
                interval = seconds / 2592000;
                if (interval > 1) return Math.floor(interval) + ' months ago';
                interval = seconds / 86400;
                if (interval > 1) return Math.floor(interval) + ' days ago';
                interval = seconds / 3600;
                if (interval > 1) return Math.floor(interval) + ' hours ago';
                interval = seconds / 60;
                if (interval > 1) return Math.floor(interval) + ' minutes ago';
                return 'Just now';
            }

            showToast(msg, type = 'success') {
                const container = document.getElementById('toast-container');
                if (container.children.length >= 2) {
                    container.removeChild(container.firstChild);
                }
                const toast = document.createElement('div');
                toast.className = `toast ${type}`;
                let icon = type === 'success'
                    ? '<svg width="20" height="20" fill="#10b981" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg>'
                    : '<svg width="20" height="20" fill="#ef4444" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>';
                toast.innerHTML = `${icon}<span>${msg}</span>`;
                container.appendChild(toast);
                setTimeout(() => {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(20px)';
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            }
        }

        const app = new App();