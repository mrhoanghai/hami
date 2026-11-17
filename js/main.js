import { debounce, h, normalize, toast } from './util.js';
import { audioPrefs, listZhVoices, speakZh, stopAudio } from './audio.js';
import { clearAll, loadProgress, loadSettings, parseImport, saveProgress, saveSettings, storageOk } from './storage.js';
import { CharPanel } from './panel.js';
import { initDropdowns } from './dropdown.js';
initDropdowns();
const BANDS = ['1', '2', '3', '4', '5', '6', '7-9'];
const PAGE_SIZES = [10, 20, 50];
const isHan = (c) => /\p{Script=Han}/u.test(c);
let entries = [];
let manifest;
let progress = loadProgress();
let settings = loadSettings();
audioPrefs.voiceURI = settings.voiceURI;
audioPrefs.rate = settings.rate ?? 0.85;
const hay = new Map();
const byId = new Map();
const detailCache = new Map();
const f = { band: 'all', cumulative: false, mark: 'all', q: '', page: 1, pageSize: (settings.pageSize ?? 20) };
let filtered = [];
let view = 'list';
const expanded = new Set();
const refreshers = new Map();
let panel;
/* ---------- dữ liệu ---------- */
function getJson(path) {
    // jQuery: $.getJSON trả về jqXHR; bọc lại thành Promise chuẩn để dùng với async/await
    return new Promise((resolve, reject) => {
        $.getJSON(path).done(resolve).fail((xhr) => reject(new Error(`HTTP ${xhr.status}`)));
    });
}
function loadDetail(e, retry = false) {
    if (retry)
        detailCache.delete(e.id);
    let p = detailCache.get(e.id);
    if (!p) {
        p = getJson(e.detailPath.replace(/^\//, ''));
        p.catch(() => detailCache.delete(e.id));
        detailCache.set(e.id, p);
    }
    return p;
}
/* ---------- tiến độ ---------- */
let warnedSave = false;
function persist() {
    if (!saveProgress(progress) && !warnedSave) {
        warnedSave = true;
        toast('Không lưu được vào thiết bị (bị chặn hoặc hết dung lượng). Bạn vẫn học được trong phiên này.');
    }
}
function patchProgress(id, patch, remove = []) {
    const cur = { ...(progress[id] ?? { updatedAt: 0 }) };
    Object.assign(cur, patch);
    for (const k of remove)
        delete cur[k];
    cur.updatedAt = Date.now();
    progress[id] = cur;
    persist();
}
const isStarred = (id) => !!progress[id]?.starred;
const learnedState = (id) => progress[id]?.learned;
function toggleStar(id) {
    patchProgress(id, { starred: !isStarred(id) });
    afterStatusChange(id);
}
function setLearned(id, value) {
    if (learnedState(id) === value)
        patchProgress(id, {}, ['learned']);
    else
        patchProgress(id, { learned: value });
    afterStatusChange(id);
}
function afterStatusChange(id) {
    updateStats();
    if (view === 'flash') {
        renderFlash();
        return;
    }
    if (f.mark !== 'all') {
        renderList();
        return;
    }
    refreshers.get(id)?.();
}
/* ---------- lọc / tìm ---------- */
function searchTokens(q) {
    // mỗi token có biến thể: v -> u, u: -> u (gõ pinyin ü bằng v hoặc u:)
    return normalize(q.replace(/u:/gi, 'u'))
        .split(' ')
        .filter(Boolean)
        .map((t) => [t, t.replace(/v/g, 'u')]);
}
function applyFilters() {
    const tokens = searchTokens(f.q);
    const bi = BANDS.indexOf(f.band);
    filtered = entries.filter((e) => {
        if (f.band !== 'all') {
            const ei = BANDS.indexOf(e.hskBand);
            if (f.cumulative ? ei > bi : ei !== bi)
                return false;
        }
        if (f.mark !== 'all') {
            const l = learnedState(e.id);
            if (f.mark === 'starred' && !isStarred(e.id))
                return false;
            if (f.mark === 'learned' && l !== true)
                return false;
            if (f.mark === 'review' && l !== false)
                return false;
            if (f.mark === 'new' && l !== undefined)
                return false;
        }
        if (tokens.length) {
            const t = hay.get(e.id);
            for (const variants of tokens)
                if (!variants.some((v) => t.includes(v)))
                    return false;
        }
        return true;
    });
}
/* ---------- khung ---------- */
const app = $('#app')[0];
let listView, flashView, backupView, asideEl;
let cardsEl, infoEl, pagerEl, chipsEl, cumRowEl;
let markSelect, sizeSelect, searchInput;
let statEl, listBtn, starBtn, flashBtn, backupBtn, themeBtn;
function setTheme(t) {
    document.documentElement.dataset.theme = t;
    settings.theme = t;
    saveSettings(settings);
    themeBtn.textContent = t === 'dark' ? '☀️ Sáng' : '🌙 Tối';
    panel?.refreshTheme();
}
function updateStats() {
    if (!statEl)
        return;
    const bi = BANDS.indexOf(f.band);
    const scopeEntries = f.band === 'all'
        ? entries
        : entries.filter((e) => {
            const ei = BANDS.indexOf(e.hskBand);
            return f.cumulative ? ei <= bi : ei === bi;
        });
    const total = scopeEntries.length;
    const learned = scopeEntries.filter((e) => learnedState(e.id) === true).length;
    statEl.textContent = `${total} mục · Đã nhớ ${learned}`;
}
function updateNavState() {
    if (!listBtn || !starBtn || !flashBtn || !backupBtn)
        return;
    const isStarredList = view === 'list' && f.mark === 'starred';
    const isAllList = view === 'list' && f.mark !== 'starred';
    listBtn.setAttribute('aria-pressed', String(isAllList));
    listBtn.classList.toggle('active', isAllList);
    starBtn.setAttribute('aria-pressed', String(isStarredList));
    starBtn.classList.toggle('active', isStarredList);
    flashBtn.setAttribute('aria-pressed', String(view === 'flash'));
    flashBtn.classList.toggle('active', view === 'flash');
    backupBtn.setAttribute('aria-pressed', String(view === 'backup'));
    backupBtn.classList.toggle('active', view === 'backup');
}
function setView(v) {
    if (view === 'flash' && v !== 'flash')
        stopAudio();
    if (v !== 'list' && panel.open)
        panel.close(false);
    view = v;
    listView.hidden = v !== 'list';
    flashView.hidden = v !== 'flash';
    backupView.hidden = v !== 'backup';
    updateNavState();
    if (v === 'list')
        renderList();
    if (v === 'flash')
        startFlash();
    if (v === 'backup')
        renderBackup();
    if (window.scrollY > 0)
        window.scrollTo({ top: 0, behavior: 'instant' });
}
let voiceDialog = null;
function openVoicePopup() {
    if (voiceDialog) {
        voiceDialog.showModal();
        return;
    }
    voiceDialog = h('dialog', { class: 'sheet voice-dialog', 'aria-label': 'Cài đặt giọng đọc tiếng Trung' });
    document.body.append(voiceDialog);
    const voiceSel = h('select', { class: 'select voice-select', 'aria-label': 'Giọng tiếng Trung' });
    const rate = h('input', {
        type: 'range',
        min: '0.5',
        max: '1.2',
        step: '0.05',
        value: String(audioPrefs.rate),
        'aria-label': 'Tốc độ đọc',
    });
    const rateVal = h('b', { class: 'rate-val', text: `${audioPrefs.rate.toFixed(2)}x` });
    const info = h('p', { class: 'voice-info-stat' });
    const save = () => {
        settings.voiceURI = audioPrefs.voiceURI;
        settings.rate = audioPrefs.rate;
        saveSettings(settings);
    };
    const fill = () => {
        const list = listZhVoices();
        voiceSel.replaceChildren(...list.map((v) => h('option', { value: v.voiceURI, text: `${v.name} (${v.lang})${v.localService ? '' : ' · online'}` })));
        if (!list.length) {
            info.textContent =
                'Thiết bị chưa có giọng tiếng Trung phổ thông. macOS/iOS: Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Trung (Ting-Ting/Lili). Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói. Chữ và nét vẫn hoạt động.';
        }
        else {
            info.textContent =
                'Chỉ liệt kê giọng Mandarin chuẩn (loại trừ tiếng Quảng Đông). Bấm "Nghe thử" để kiểm tra âm thanh.';
            if (!list.some((v) => v.voiceURI === audioPrefs.voiceURI))
                audioPrefs.voiceURI = list[0].voiceURI;
            voiceSel.value = audioPrefs.voiceURI;
        }
    };
    voiceSel.addEventListener('change', () => {
        audioPrefs.voiceURI = voiceSel.value;
        save();
        speakZh('你好，很高兴认识你。');
    });
    rate.addEventListener('input', () => {
        audioPrefs.rate = Number(rate.value);
        rateVal.textContent = `${audioPrefs.rate.toFixed(2)}x`;
    });
    rate.addEventListener('change', () => {
        audioPrefs.rate = Number(rate.value);
        rateVal.textContent = `${audioPrefs.rate.toFixed(2)}x`;
        save();
    });
    if ('speechSynthesis' in window)
        window.speechSynthesis.onvoiceschanged = fill;
    fill();
    const closeDialog = () => voiceDialog?.close();
    voiceDialog.addEventListener('cancel', (ev) => {
        ev.preventDefault();
        closeDialog();
    });
    voiceDialog.addEventListener('click', (ev) => {
        const rect = voiceDialog.getBoundingClientRect();
        if (ev.clientX < rect.left ||
            ev.clientX > rect.right ||
            ev.clientY < rect.top ||
            ev.clientY > rect.bottom) {
            closeDialog();
        }
    });
    const content = h('div', { class: 'voice-popup-inner' }, h('div', { class: 'voice-popup-head' }, h('h2', { class: 'voice-popup-title', text: '🔊 Giọng đọc tiếng Trung' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng popup', onclick: closeDialog }, '✕')), h('div', { class: 'voice-field' }, h('label', { class: 'voice-lbl', text: 'Chọn giọng nói thiết bị:' }), voiceSel), h('div', { class: 'voice-field' }, h('label', { class: 'voice-lbl' }, 'Tốc độ đọc: ', rateVal), rate), info, h('div', { class: 'btn-row', style: 'margin-top:14px; justify-content:flex-end; gap:8px;' }, h('button', { class: 'btn primary', type: 'button', onclick: () => speakZh('你好，很高兴认识你。') }, '▶ Nghe thử'), h('button', { class: 'btn', type: 'button', onclick: closeDialog }, 'Đóng')));
    voiceDialog.replaceChildren(content);
    voiceDialog.showModal();
}
function buildShell() {
    const brand = h('button', {
        class: 'brand',
        type: 'button',
        onclick: () => {
            f.mark = 'all';
            f.page = 1;
            markSelect.value = 'all';
            setView('list');
        },
    }, h('img', { class: 'brand-logo', src: 'img/hami.svg', alt: 'Hami logo' }), h('span', { class: 'brand-text', text: 'Hami' }));
    statEl = h('span', { class: 'stat' });
    const brandWrap = h('div', { class: 'header-brand-wrap' }, brand, statEl);
    listBtn = h('button', {
        class: 'btn list-btn',
        type: 'button',
        'aria-pressed': 'true',
        onclick: () => {
            f.mark = 'all';
            f.page = 1;
            markSelect.value = 'all';
            setView('list');
        },
    }, '📚 Từ vựng');
    starBtn = h('button', {
        class: 'btn nav-starred-btn',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => {
            f.mark = 'starred';
            f.page = 1;
            markSelect.value = 'starred';
            setView('list');
        },
    }, '⭐ Đã đánh dấu');
    flashBtn = h('button', { class: 'btn flash-btn', type: 'button', 'aria-pressed': 'false', onclick: () => setView('flash') }, '🃏 Flashcard');
    backupBtn = h('button', { class: 'btn backup-btn', type: 'button', 'aria-pressed': 'false', onclick: () => setView('backup') }, '💾 Sao lưu');
    const voiceBtn = h('button', { class: 'btn voice-btn', type: 'button', onclick: openVoicePopup }, '🔊 Giọng đọc');
    themeBtn = h('button', {
        class: 'btn theme-btn',
        type: 'button',
        onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    });
    const headerActions = h('div', { class: 'header-actions' }, listBtn, starBtn, flashBtn, backupBtn, voiceBtn, themeBtn);
    const header = h('header', { class: 'header' }, h('div', { class: 'header-in' }, brandWrap, headerActions));
    searchInput = h('input', {
        class: 'search',
        type: 'search',
        placeholder: 'Tìm chữ Hán, pinyin (có/không dấu) hoặc nghĩa…',
        'aria-label': 'Tìm kiếm',
        autocomplete: 'off',
        lang: 'zh-Hans',
    });
    let composing = false;
    const run = debounce(() => {
        f.q = searchInput.value;
        f.page = 1;
        renderList();
    }, 150);
    searchInput.addEventListener('compositionstart', () => {
        composing = true;
    });
    searchInput.addEventListener('compositionend', () => {
        composing = false;
        run();
    });
    searchInput.addEventListener('input', () => {
        if (!composing)
            run();
    });
    markSelect = h('select', { class: 'select', 'aria-label': 'Trạng thái học' }, ...[
        ['all', 'Mọi trạng thái'],
        ['starred', '⭐ Đã đánh dấu'],
        ['learned', '✅ Đã nhớ'],
        ['review', '🔁 Cần ôn'],
        ['new', '🆕 Chưa học'],
    ].map(([v, t]) => h('option', { value: v, text: t })));
    markSelect.addEventListener('change', () => {
        f.mark = markSelect.value;
        f.page = 1;
        updateNavState();
        renderList();
    });
    sizeSelect = h('select', { class: 'select', 'aria-label': 'Số mục mỗi trang' }, ...PAGE_SIZES.map((n) => h('option', { value: String(n), text: `${n} mục/trang` })));
    sizeSelect.value = String(f.pageSize);
    sizeSelect.addEventListener('change', () => {
        f.pageSize = Number(sizeSelect.value);
        settings.pageSize = f.pageSize;
        saveSettings(settings);
        f.page = 1;
        renderList();
    });
    chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Cấp HSK' });
    cumRowEl = h('div', { class: 'cum-row', role: 'group', 'aria-label': 'Chế độ lọc cấp HSK' });
    infoEl = h('p', { class: 'result-info', role: 'status', 'aria-live': 'polite' });
    cardsEl = h('div', { class: 'cards' });
    pagerEl = h('nav', { class: 'pager', 'aria-label': 'Phân trang' });
    asideEl = h('aside', { class: 'cp-aside', 'aria-label': 'Chi tiết chữ', hidden: true });
    listView = h('section', { class: 'layout' }, h('div', { class: 'list-col' }, h('div', { class: 'toolbar' }, searchInput, markSelect, sizeSelect), chipsEl, cumRowEl, infoEl, cardsEl, pagerEl), asideEl);
    flashView = h('section', { hidden: true });
    backupView = h('section', { hidden: true });
    app.replaceChildren(header, h('main', { class: 'main' }, listView, flashView, backupView));
    panel = new CharPanel(asideEl, {
        loadDetail: (e) => loadDetail(e),
        onClose: (trigger) => {
            if (!trigger)
                return;
            const el = trigger.isConnected
                ? trigger
                : document.querySelector(`[data-eid="${trigger.dataset.eid}"][data-ci="${trigger.dataset.ci}"]`);
            el?.focus();
        },
    });
    setTheme(document.documentElement.dataset.theme || 'light');
    updateStats();
}
/* ---------- danh sách ---------- */
function renderChips() {
    const mk = (value, label) => h('button', {
        class: 'btn',
        type: 'button',
        'aria-pressed': String(f.band === value),
        onclick: () => {
            f.band = value;
            f.page = 1;
            renderList();
        },
    }, label);
    chipsEl.replaceChildren(mk('all', 'Mọi cấp'), ...BANDS.map((b) => mk(b, `HSK ${b}`)));
    if (f.band === 'all') {
        cumRowEl.hidden = true;
        cumRowEl.replaceChildren();
    }
    else {
        cumRowEl.hidden = false;
        const onlyCount = manifest.perBand[f.band];
        const cumCount = manifest.cumulative[f.band];
        cumRowEl.replaceChildren(h('button', {
            class: 'btn',
            type: 'button',
            'aria-pressed': String(!f.cumulative),
            onclick: () => {
                f.cumulative = false;
                f.page = 1;
                renderList();
            },
        }, `Chỉ từ mới HSK ${f.band} (${onlyCount})`), h('button', {
            class: 'btn',
            type: 'button',
            'aria-pressed': String(f.cumulative),
            onclick: () => {
                f.cumulative = true;
                f.page = 1;
                renderList();
            },
        }, `Tất cả từ đến HSK ${f.band} (${cumCount})`));
    }
}
function renderList() {
    applyFilters();
    renderChips();
    updateStats();
    const pages = Math.max(1, Math.ceil(filtered.length / f.pageSize));
    if (f.page > pages)
        f.page = pages;
    const start = (f.page - 1) * f.pageSize;
    const slice = filtered.slice(start, start + f.pageSize);
    const totalScope = f.band === 'all' ? entries.length : (f.cumulative ? manifest.cumulative[f.band] : manifest.perBand[f.band]);
    infoEl.textContent = filtered.length
        ? `${filtered.length} kết quả (hiển thị ${start + 1}–${start + slice.length}) trên tổng ${totalScope} mục`
        : `0 kết quả trên tổng ${totalScope} mục`;
    refreshers.clear();
    cardsEl.replaceChildren(...(slice.length
        ? slice.map(buildCard)
        : [h('div', { class: 'empty' }, 'Không tìm thấy từ phù hợp. Hãy thử từ khóa khác hoặc bỏ bớt bộ lọc.')]));
    pagerEl.replaceChildren();
    if (pages > 1) {
        const go = (p) => {
            f.page = p;
            renderList();
            cardsEl.scrollIntoView({ block: 'start' });
        };
        pagerEl.append(h('button', { class: 'btn', type: 'button', disabled: f.page <= 1, onclick: () => go(1), 'aria-label': 'Trang đầu' }, '«'), h('button', { class: 'btn', type: 'button', disabled: f.page <= 1, onclick: () => go(f.page - 1) }, '‹ Trước'), h('span', { text: `Trang ${f.page}/${pages}` }), h('button', { class: 'btn', type: 'button', disabled: f.page >= pages, onclick: () => go(f.page + 1) }, 'Sau ›'), h('button', { class: 'btn', type: 'button', disabled: f.page >= pages, onclick: () => go(pages), 'aria-label': 'Trang cuối' }, '»'));
    }
}
function statusBadge(id) {
    const l = learnedState(id);
    if (l === true)
        return h('span', { class: 'badge ok', text: 'Đã nhớ' });
    if (l === false)
        return h('span', { class: 'badge warn', text: 'Cần ôn' });
    return null;
}
function meaningText(e) {
    if (e.meaningsVi.length)
        return e.meaningsVi.join('; ');
    return e.meaningsEn.length ? `Chưa có nghĩa tiếng Việt · EN: ${e.meaningsEn.join('; ')}` : 'Chưa có nghĩa tiếng Việt';
}
function buildCard(e) {
    const bodyId = `body-${e.id}`;
    const badgeSlot = h('span');
    const starEl = h('button', { class: 'star-btn', type: 'button', onclick: () => toggleStar(e.id) });
    const chars = Array.from(e.simplified);
    const hw = h('div', { class: 'hw' }, ...chars.map((c, i) => isHan(c)
        ? h('button', {
            class: 'char-btn',
            type: 'button',
            lang: 'zh-Hans',
            dataset: { eid: e.id, ci: String(i) },
            'aria-label': `Xem nét chữ ${c} trong từ ${e.simplified}`,
            onclick: (ev) => panel.select(e, i, ev.currentTarget, 'char'),
        }, c)
        : h('span', { class: 'char-plain', text: c })), h('button', {
        class: 'hw-speaker',
        type: 'button',
        'aria-label': `Nghe cả từ ${e.simplified}`,
        title: 'Nghe cả từ',
        onclick: () => speakZh(e.simplified, e.wordAudioPath),
    }, '🔊'));
    const wLine = h('div', { class: 'w-line' }, h('span', { class: 'py', text: e.pinyin }), h('span', { class: 'badge lv', text: `HSK ${e.hskBand}` }), e.partOfSpeech ? h('span', { class: 'badge', text: e.partOfSpeech }) : null, badgeSlot);
    const hvLine = h('div', { class: 'hv-line' }, e.hanViet ? h('div', { class: 'hv', text: e.hanViet }) : h('div'), starEl);
    const toggle = h('button', { class: 'summary-wrap', type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId }, h('div', { class: 'summary', text: meaningText(e) }), h('div', { class: 'card-more-hint', text: 'Chi tiết & ví dụ ▾' }));
    const body = h('div', { class: 'card-body', id: bodyId, hidden: true });
    const root = h('article', { class: 'card' }, hw, wLine, hvLine, toggle, body);
    let statusRow = null;
    const renderBodyStatus = () => {
        if (!statusRow)
            return;
        const l = learnedState(e.id);
        statusRow.replaceChildren(h('button', { class: 'btn ok' + (l === true ? ' active' : ''), type: 'button', 'aria-pressed': String(l === true), onclick: () => setLearned(e.id, true) }, '✅ Đã nhớ'), h('button', {
            class: 'btn warn' + (l === false ? ' active' : ''),
            type: 'button',
            'aria-pressed': String(l === false),
            onclick: () => setLearned(e.id, false),
        }, '🔁 Cần ôn'));
    };
    const refresh = () => {
        const on = isStarred(e.id);
        starEl.classList.toggle('on', on);
        starEl.textContent = on ? '★' : '☆';
        starEl.setAttribute('aria-pressed', String(on));
        starEl.setAttribute('aria-label', on ? `Bỏ đánh dấu ${e.simplified}` : `Đánh dấu ${e.simplified}`);
        const b = statusBadge(e.id);
        badgeSlot.replaceChildren(...(b ? [b] : []));
        if (!body.hidden)
            renderBodyStatus();
    };
    const loadBody = (retry = false) => {
        body.replaceChildren(h('div', { class: 'state', text: 'Đang tải chi tiết…' }));
        loadDetail(e, retry)
            .then((d) => {
            statusRow = h('div', { class: 'status-row' });
            body.replaceChildren(renderDetail(d), statusRow);
            renderBodyStatus();
        })
            .catch(() => {
            body.replaceChildren(h('div', { class: 'state err', role: 'alert' }, 'Không tải được chi tiết. ', h('button', { class: 'btn', type: 'button', onclick: () => loadBody(true) }, 'Thử lại')));
        });
    };
    const setOpen = (open) => {
        toggle.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        const hint = toggle.querySelector('.card-more-hint');
        if (hint)
            hint.textContent = open ? 'Thu gọn ▴' : 'Chi tiết & ví dụ ▾';
        if (open) {
            expanded.add(e.id);
            loadBody();
        }
        else
            expanded.delete(e.id);
    };
    toggle.addEventListener('click', () => setOpen(body.hidden));
    refreshers.set(e.id, refresh);
    refresh();
    if (expanded.has(e.id))
        setOpen(true);
    return root;
}
function sec(title, ...kids) {
    return h('div', { class: 'sec' }, h('h3', { text: title }), ...kids);
}
function renderDetail(d) {
    const root = h('div');
    if (d.hanViet) {
        root.append(sec('Âm Hán Việt', h('div', { class: 'hv-detail', text: d.hanViet })));
    }
    root.append(sec('Nghĩa tiếng Việt', d.meaningsVi.length
        ? h('div', { text: d.meaningsVi.join('; ') })
        : h('div', { class: 'empty-note', text: 'Chưa có nghĩa tiếng Việt.' })));
    if (d.meaningsEn.length)
        root.append(sec('Nghĩa tiếng Anh (CC-CEDICT, CC BY-SA 4.0)', h('ul', { class: 'en-list' }, ...d.meaningsEn.map((m) => h('li', { text: m })))));
    else
        root.append(sec('Nghĩa tiếng Anh', h('div', { class: 'empty-note', text: 'Chưa ghép được mục từ điển CC-CEDICT.' })));
    const ex = d.examples;
    root.append(sec('Ví dụ', ex.length
        ? h('div', {}, ...ex.map((x) => h('div', { class: 'ex' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nghe cả câu', onclick: () => speakZh(x.hanzi, x.audioPath) }, '🔊'), h('div', {}, h('p', { lang: 'zh-Hans', text: x.hanzi }), h('p', { class: 'vi', text: x.pinyin }), h('p', { class: 'vi', text: x.vi })))))
        : h('div', { class: 'empty-note', text: 'Chưa có câu ví dụ đã duyệt.' })));
    root.append(h('p', {
        class: 'empty-note',
        text: `Cấp HSK ${d.hskBand} (đề cương 11/2025) · nguồn mục #${d.source.sourceId}${d.source.pdfPage ? `, trang PDF ${d.source.pdfPage}` : ''}`,
    }));
    return root;
}
/* ---------- flashcard ---------- */
const fc = { source: 'filtered', shuffle: false, deck: [], i: 0, flipped: false };
function buildDeck() {
    applyFilters();
    const src = fc.source === 'starred' ? entries.filter((e) => isStarred(e.id)) : [...filtered];
    if (fc.shuffle)
        for (let i = src.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [src[i], src[j]] = [src[j], src[i]];
        }
    fc.deck = src;
    fc.i = 0;
    fc.flipped = false;
}
function startFlash() {
    buildDeck();
    renderFlash();
}
function renderFlash() {
    const n = fc.deck.length;
    const learned = fc.deck.filter((e) => learnedState(e.id) === true).length;
    const srcSel = h('select', { class: 'select', 'aria-label': 'Nguồn bộ thẻ' }, h('option', { value: 'filtered', text: 'Kết quả lọc hiện tại' }), h('option', { value: 'starred', text: 'Từ đã đánh dấu' }));
    srcSel.value = fc.source;
    srcSel.addEventListener('change', () => {
        fc.source = srcSel.value;
        startFlash();
    });
    const shuf = h('button', {
        class: 'btn',
        type: 'button',
        'aria-pressed': String(fc.shuffle),
        onclick: () => {
            fc.shuffle = !fc.shuffle;
            startFlash();
        },
    }, '🔀 Đảo thứ tự');
    const top = h('div', { class: 'fc-top' }, srcSel, shuf, h('span', { class: 'grow' }), h('span', { class: 'stat', style: 'display:inline', text: `Đã nhớ ${learned} / ${n}` }));
    const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': n, 'aria-valuenow': learned, 'aria-label': 'Tiến độ đã nhớ' }, h('i', { style: `width:${n ? (100 * learned) / n : 0}%` }));
    if (!n) {
        flashView.replaceChildren(h('div', { class: 'fc' }, top, h('div', { class: 'empty' }, fc.source === 'starred' ? 'Chưa có từ nào được đánh dấu.' : 'Bộ lọc hiện tại không có từ nào.')));
        return;
    }
    const e = fc.deck[fc.i];
    const card = h('div', { class: 'fc-card', tabindex: '0', role: 'group', 'aria-label': fc.flipped ? 'Mặt sau thẻ' : 'Mặt trước thẻ' });
    if (!fc.flipped) {
        card.append(h('div', { class: 'fc-han', lang: 'zh-Hans', text: e.simplified }), h('button', { class: 'btn', type: 'button', onclick: () => speakZh(e.simplified, e.wordAudioPath) }, '🔊 Nghe'), h('div', { class: 'hint', text: 'Space để lật thẻ' }));
    }
    else {
        const exSlot = h('div', { class: 'fc-ex' });
        card.append(h('div', { class: 'fc-han small', lang: 'zh-Hans', text: e.simplified }), h('div', { class: 'py', text: e.pinyin }), ...(e.hanViet ? [h('div', { class: 'hv', text: e.hanViet })] : []), h('div', { class: 'fc-mean', text: e.meaningsVi.length ? e.meaningsVi.join('; ') : 'Chưa có nghĩa tiếng Việt' }), ...(e.meaningsVi.length || !e.meaningsEn.length ? [] : [h('div', { class: 'fc-ex', text: 'EN: ' + e.meaningsEn.join('; ') })]), exSlot);
        loadDetail(e)
            .then((d) => {
            const ex = d.examples[0];
            if (ex && fc.deck[fc.i] === e && fc.flipped) {
                exSlot.replaceChildren(h('div', { lang: 'zh-Hans', text: ex.hanzi }), h('div', { text: ex.pinyin }), h('div', { text: ex.vi }));
            }
        })
            .catch(() => undefined);
    }
    card.addEventListener('click', (ev) => {
        if (ev.target.closest('button'))
            return;
        fc.flipped = !fc.flipped;
        renderFlash();
    });
    const l = learnedState(e.id);
    const nav = h('div', { class: 'fc-nav' }, h('button', { class: 'btn', type: 'button', onclick: () => flashMove(-1), disabled: fc.i === 0 }, '‹ Trước'), h('button', {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
            fc.flipped = !fc.flipped;
            renderFlash();
        },
    }, 'Lật thẻ'), h('button', { class: 'btn', type: 'button', onclick: () => flashMove(1), disabled: fc.i >= n - 1 }, 'Sau ›'));
    const marks = h('div', { class: 'fc-nav' }, h('button', {
        class: 'btn warn' + (l === false ? ' active' : ''),
        type: 'button',
        'aria-pressed': String(l === false),
        onclick: () => setLearned(e.id, false),
    }, '🔁 Cần ôn'), h('button', { class: 'btn ok' + (l === true ? ' active' : ''), type: 'button', 'aria-pressed': String(l === true), onclick: () => setLearned(e.id, true) }, '✅ Đã nhớ'), h('button', {
        class: 'btn' + (isStarred(e.id) ? ' active' : ''),
        type: 'button',
        'aria-pressed': String(isStarred(e.id)),
        onclick: () => toggleStar(e.id),
    }, isStarred(e.id) ? '★ Đã đánh dấu' : '☆ Đánh dấu'));
    flashView.replaceChildren(h('div', { class: 'fc' }, top, bar, h('p', { class: 'result-info', role: 'status', text: `Thẻ ${fc.i + 1}/${n}` }), card, nav, marks));
}
function flashMove(d) {
    const k = fc.i + d;
    if (k < 0 || k >= fc.deck.length)
        return;
    fc.i = k;
    fc.flipped = false;
    stopAudio();
    renderFlash();
}
document.addEventListener('keydown', (ev) => {
    if (view !== 'flash')
        return;
    const t = ev.target;
    if (t.closest('input, textarea, select, [contenteditable]') || ev.isComposing)
        return;
    if (ev.key === ' ') {
        ev.preventDefault();
        fc.flipped = !fc.flipped;
        renderFlash();
    }
    else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        flashMove(1);
    }
    else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        flashMove(-1);
    }
});
/* ---------- sao lưu ---------- */
function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderBackup() {
    const vals = Object.entries(progress)
        .filter(([id]) => byId.has(id))
        .map(([, p]) => p);
    const learned = vals.filter((p) => p.learned === true).length, review = vals.filter((p) => p.learned === false).length, starred = vals.filter((p) => p.starred).length;
    const result = h('div', { class: 'verdict', role: 'status' });
    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'import-file', tabindex: '-1' });
    file.addEventListener('change', async () => {
        const fl = file.files?.[0];
        file.value = '';
        if (!fl)
            return;
        try {
            const r = parseImport(await fl.text(), fl.size, progress, settings, new Set(entries.map((e) => e.id)));
            progress = r.progress;
            settings = r.settings;
            persist();
            saveSettings(settings);
            if (settings.theme)
                setTheme(settings.theme);
            if (settings.pageSize) {
                f.pageSize = settings.pageSize;
                sizeSelect.value = String(f.pageSize);
            }
            updateStats();
            renderBackup();
            renderList();
            const m = document.getElementById('backup-msg');
            if (m) {
                m.className = 'verdict yes';
                m.textContent = `Đã nhập: cập nhật ${r.applied} mục; bỏ qua ${r.skippedUnknown} mục không thuộc bộ từ hiện tại; ${r.skippedOlder} mục cũ hơn dữ liệu trên thiết bị.`;
            }
        }
        catch (err) {
            result.className = 'verdict no';
            result.textContent = `Không nhập được: ${err.message} Tiến độ hiện tại được giữ nguyên.`;
        }
    });
    const cov = manifest.coverage, tot = manifest.totalEntries;
    const pct = (n) => `${n}/${tot} (${((100 * n) / tot).toFixed(1)}%)`;
    const msgEl = h('div', { id: 'backup-msg', class: 'verdict', role: 'status' });
    const exportBtn = h('button', {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
            const data = {
                schemaVersion: 1,
                language: 'zh-Hans',
                datasetVersion: manifest.datasetVersion,
                exportedAt: new Date().toISOString(),
                progress,
                settings,
            };
            download(`tien-do-tieng-trung-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
        },
    }, '⬇️ Xuất tiến độ');
    const clearBtn = h('button', {
        class: 'btn danger',
        type: 'button',
        onclick: () => {
            if (!confirm('Xóa toàn bộ tiến độ tiếng Trung (đánh dấu, đã nhớ/cần ôn) trên thiết bị này? Không thể hoàn tác. Hãy xuất file sao lưu trước nếu cần. (Tiến độ tiếng Anh không bị ảnh hưởng.)'))
                return;
            progress = {};
            if (!clearAll())
                toast('Không xóa được dữ liệu đã lưu (có thể bị chặn); tiến độ trong phiên đã được xóa.');
            updateStats();
            renderBackup();
            toast('Đã xóa tiến độ trên thiết bị này.');
        },
    }, '🗑️ Xóa tiến độ trên thiết bị này');
    const rows = [
        ['Phiên bản dữ liệu', manifest.datasetVersion],
        ['Đề cương', 'HSK (đề cương thi công bố 11/2025)'],
        ['Tổng số mục', String(tot)],
        ['Chữ Hán duy nhất', String(manifest.uniqueHanCharacters)],
        ...BANDS.map((b) => [`HSK ${b}: mới / tích lũy`, `${manifest.perBand[b]} / ${manifest.cumulative[b]}`]),
        ['Có dữ liệu nét', `${manifest.strokeCoverage.available}/${manifest.strokeCoverage.requested} chữ`],
        ['Ghép CC-CEDICT (khớp chính xác)', pct(cov.cedictExact)],
        ['Ghép CC-CEDICT (khác thanh điệu)', pct(cov.cedictToneVariant)],
        ['Nghĩa Việt — bản nháp (chưa duyệt)', pct(cov.viDraft)],
        ['Nghĩa Việt — đã duyệt', pct(cov.viReviewed)],
        ['Thiếu nghĩa Việt', pct(cov.viMissing)],
        ['Ví dụ đã duyệt', pct(cov.examplesReviewed)],
        ['Audio nội bộ', pct(cov.audio)],
    ];
    backupView.replaceChildren(h('div', { class: 'fc', style: 'max-width:760px' }, storageOk
        ? null
        : h('div', { class: 'warn-box', role: 'alert' }, 'Trình duyệt đang chặn lưu dữ liệu: tiến độ chỉ tồn tại trong phiên này. Hãy xuất file để giữ lại.'), h('div', { class: 'panel' }, h('h2', { text: 'Sao lưu & khôi phục tiến độ tiếng Trung' }), h('p', {}, `Trên thiết bị này: ${starred} từ đánh dấu, ${learned} từ đã nhớ, ${review} từ cần ôn.`), h('p', { class: 'stat', style: 'display:block' }, 'Tiến độ chỉ lưu trong trình duyệt (localStorage, khóa vocab_zh_progress_v1) của thiết bị này, riêng biệt với app tiếng Anh. Xóa dữ liệu trình duyệt, đổi tên miền hoặc đổi thiết bị sẽ không tự mang theo tiến độ — hãy xuất file rồi nhập lại. Không có tài khoản hay đồng bộ.'), h('div', { class: 'btn-row' }, exportBtn, h('label', {
        class: 'btn',
        for: 'import-file',
        role: 'button',
        tabindex: '0',
        onkeydown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                file.click();
            }
        },
    }, '⬆️ Nhập tiến độ'), file, clearBtn), result, msgEl), h('div', { class: 'panel' }, h('h2', { text: 'Thông tin bộ dữ liệu' }), h('table', {}, h('tbody', {}, ...rows.map(([a, b]) => h('tr', {}, h('th', { text: a }), h('td', { text: b }))))), h('p', { class: 'stat', style: 'display:block;margin-top:10px' }, 'Nghĩa Việt hiện có chỉ là bản nháp HSK 1 do AI soạn, chưa có người duyệt. Phát âm dùng giọng thiết bị (nếu có giọng Mandarin); nét chữ chạy từ file nội bộ. Quyền tái xuất bản dữ liệu đề cương HSK chưa được xác minh.')), h('div', { class: 'panel' }, h('h2', { text: 'Nguồn & giấy phép' }), h('ul', { class: 'en-list' }, h('li', {}, 'Danh sách HSK: dataset uranbekanarbaev/hsk-3.0-vocabulary-dataset (quyền tái xuất bản chưa xác minh).'), h('li', {}, 'Từ điển Trung–Anh: CC-CEDICT, CC BY-SA 4.0, https://www.mdbg.net/chinese/dictionary?page=cc-cedict'), h('li', {}, 'Thư viện vẽ nét: Hanzi Writer (MIT).'), h('li', {}, 'Dữ liệu nét: hanzi-writer-data, Arphic Public License — ', h('a', { href: 'licenses/ARPHICPL.TXT', target: '_blank', rel: 'noopener' }, 'ARPHICPL.TXT'), '.')))));
}
/* ---------- khởi động ---------- */
async function main() {
    try {
        [entries, manifest] = await Promise.all([getJson('data/zh/index.json'), getJson('data/zh/manifest.json')]);
    }
    catch {
        app.replaceChildren(h('div', { class: 'empty', role: 'alert' }, 'Không tải được dữ liệu. Hãy mở bằng Live Server (không mở trực tiếp file index.html) và tải lại trang. ', h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Tải lại')));
        return;
    }
    for (const e of entries) {
        byId.set(e.id, e);
        hay.set(e.id, normalize([e.simplified, e.traditional ?? '', e.pinyinPlain, e.pinyin, e.hanViet, e.meaningsVi.join(' '), e.meaningsEn.join(' ')].join(' ')));
    }
    buildShell();
    renderList();
}
$(main); // jQuery: chạy khi DOM đã sẵn sàng
