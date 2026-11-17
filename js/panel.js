import { h } from './util.js';
import { speakZh, stopAudio } from './audio.js';
const isHan = (c) => /\p{Script=Han}/u.test(c);
let strokeIndexP = null;
export function getStrokeIndex() {
    if (!strokeIndexP) {
        strokeIndexP = fetch('strokes/index.json').then((r) => {
            if (!r.ok)
                throw new Error('HTTP ' + r.status);
            return r.json();
        });
        strokeIndexP.catch(() => {
            strokeIndexP = null;
        });
    }
    return strokeIndexP;
}
let componentsP = null;
function getComponentsMap() {
    if (!componentsP) {
        componentsP = fetch('data/zh/components.json').then((r) => {
            if (!r.ok)
                throw new Error('HTTP ' + r.status);
            return r.json();
        });
        componentsP.catch(() => {
            componentsP = null;
        });
    }
    return componentsP;
}
const charCache = new Map();
function loadCharData(path) {
    let p = charCache.get(path);
    if (!p) {
        p = fetch(path).then((r) => {
            if (!r.ok)
                throw new Error('HTTP ' + r.status);
            return r.json();
        });
        p.catch(() => charCache.delete(path));
        charCache.set(path, p);
    }
    return p;
}
let hwModule = null;
const loadHanziWriter = () => (window.HanziWriter ? Promise.resolve(window.HanziWriter) : Promise.reject(new Error('HanziWriter chưa được nạp')));
const SPEEDS = { slow: 0.6, normal: 1, fast: 1.8 };
/** Bảng chi tiết chữ: sidebar desktop hoặc dialog modal trên mobile. Mỗi lượt chọn chữ tự động vẽ từng nét rồi dừng. */
export class CharPanel {
    constructor(aside, hooks) {
        this.hooks = hooks;
        this.mq = window.matchMedia('(max-width: 899px)');
        this.root = null;
        this.session = 0;
        this.writer = null;
        this.entry = null;
        this.idx = 0;
        this.trigger = null;
        this.speed = 'normal';
        this.outline = true;
        this.ui = {};
        this.open = false;
        this.aside = aside;
        this.dialog = h('dialog', { class: 'sheet', 'aria-label': 'Chi tiết chữ' });
        document.body.append(this.dialog);
        this.dialog.addEventListener('cancel', (ev) => {
            ev.preventDefault();
            this.close();
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && this.open && !this.mq.matches)
                this.close();
        });
        this.mq.addEventListener('change', () => {
            if (this.open)
                this.close(false);
        });
    }
    /**
     * Mở bảng chi tiết chữ và vẽ nét.
     * - speak = 'char': chỉ phát âm đúng chữ được chọn (ví dụ bấm chữ 杯 -> chỉ đọc 杯, bấm 子 -> chỉ đọc 子).
     * - speak = 'word': phát âm cả từ (ví dụ 杯子).
     * - speak = 'none': không phát âm.
     */
    select(entry, idx, trigger, speak = 'char') {
        this.entry = entry;
        this.idx = idx;
        if (trigger)
            this.trigger = trigger;
        const chars = Array.from(entry.simplified);
        const ch = chars[idx] ?? entry.simplified;
        let label = '';
        if (speak === 'char') {
            label = this.speakChar(ch);
        }
        else if (speak === 'word') {
            label = this.speakWord();
        }
        this.mount();
        this.render(label);
    }
    speakChar(c, audioPath = null) {
        const r = speakZh(c, audioPath);
        if (r === 'audio')
            return `Đang đọc chữ ${c} (audio)`;
        if (r === 'tts')
            return `Đang đọc chữ ${c} (giọng thiết bị)`;
        if (r === 'no-voice')
            return 'Thiết bị chưa có giọng tiếng Trung';
        return 'Trình duyệt không hỗ trợ phát âm';
    }
    speakWord() {
        const e = this.entry;
        const r = speakZh(e.simplified, e.wordAudioPath);
        if (r === 'audio')
            return `Đang đọc cả từ ${e.simplified} (audio nội bộ)`;
        if (r === 'tts')
            return `Đang đọc cả từ ${e.simplified} (giọng thiết bị)`;
        if (r === 'no-voice')
            return 'Thiết bị chưa có giọng tiếng Trung';
        return 'Trình duyệt không hỗ trợ phát âm';
    }
    mount() {
        const modal = this.mq.matches;
        if (!this.root)
            this.root = h('div', { class: 'cp' });
        this.open = true;
        if (modal) {
            this.aside.hidden = true;
            this.dialog.replaceChildren(this.root);
            if (!this.dialog.open)
                this.dialog.showModal();
        }
        else {
            if (this.dialog.open)
                this.dialog.close();
            this.aside.replaceChildren(this.root);
            this.aside.hidden = false;
        }
        document.body.classList.toggle('cp-open', !modal);
    }
    close(restoreFocus = true) {
        this.session++;
        this.teardownWriter();
        stopAudio();
        this.open = false;
        if (this.dialog.open)
            this.dialog.close();
        this.aside.hidden = true;
        this.aside.replaceChildren();
        this.dialog.replaceChildren();
        this.root = null;
        document.body.classList.remove('cp-open');
        if (restoreFocus)
            this.hooks.onClose(this.trigger);
    }
    refreshTheme() {
        if (this.open)
            this.mountWriter();
    }
    teardownWriter() {
        try {
            this.writer?.pauseAnimation();
        }
        catch {
            /* bỏ qua */
        }
        this.writer = null;
    }
    render(audioLabel) {
        const e = this.entry;
        const chars = Array.from(e.simplified);
        const ch = chars[this.idx];
        const grid = this.gridSvg();
        const target = h('div', { class: 'cp-writer' });
        const replayBtn = h('button', {
            class: 'cp-replay-btn',
            type: 'button',
            'aria-label': `Vẽ lại chữ ${ch}`,
            title: 'Vẽ lại',
            onclick: () => this.replay(),
        }, this.replayIconSvg());
        const writerBox = h('div', { class: 'cp-box', role: 'img', 'aria-label': `Ô vẽ nét chữ ${ch}` }, grid, target, replayBtn);
        const decompBox = h('div', { class: 'cp-decomp', 'aria-label': `Các bộ cấu tạo của chữ ${ch}` }, h('div', { class: 'cp-decomp-title', text: 'Bộ cấu tạo' }), h('div', { class: 'cp-note', text: 'Đang tải…' }));
        const status = h('div', { class: 'cp-status', role: 'status', 'aria-live': 'polite' });
        const audio = h('div', { class: 'cp-audio', role: 'status', 'aria-live': 'polite', text: audioLabel });
        let charAudio = null;
        const pinyinLine = h('div', { class: 'cp-pinyin-bar' }, h('span', { class: 'cp-pinyin-lbl', text: 'Bính âm:' }), h('b', { class: 'cp-pinyin-val', text: chars.length === 1 ? e.pinyin : '…' }), h('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': `Nghe phát âm chữ ${ch}`,
            title: `Nghe phát âm chữ ${ch}`,
            onclick: () => {
                audio.textContent = this.speakChar(ch, charAudio);
            },
        }, '🔊'), h('span', { class: 'cp-stroke-badge', text: '' }));
        const charBox = h('div', { class: 'cp-char-detail' });
        const exSlot = h('div', { class: 'cp-ex-slot' });
        const meaning = e.meaningsVi.length ? e.meaningsVi.join('; ') : null;
        const info = h('div', { class: 'cp-info' }, charBox, h('div', { class: 'cp-word-row' }, ...chars.map((c, i) => isHan(c)
            ? h('button', {
                class: 'char-btn',
                type: 'button',
                lang: 'zh-Hans',
                'aria-pressed': String(i === this.idx),
                'aria-label': `Phát âm chữ ${c}`,
                title: `Phát âm chữ ${c}`,
                onclick: () => this.select(e, i, null, 'char'),
            }, c)
            : h('span', { class: 'char-plain', text: c })), h('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': `Nghe cả từ ${e.simplified}`,
            title: `Nghe cả từ ${e.simplified}`,
            onclick: () => {
                audio.textContent = this.speakWord();
            },
        }, '🔊')), h('div', { class: 'cp-py' }, e.pinyin, e.traditional ? h('span', { class: 'cp-trad', lang: 'zh-Hant', text: ` · phồn thể: ${e.traditional}` }) : null), e.hanViet ? h('div', { class: 'cp-hv', text: e.hanViet }) : null, h('div', { class: 'cp-mean' }, meaning ?? ''), !meaning && e.meaningsEn.length ? h('div', { class: 'cp-en', text: 'Nghĩa Anh (CC-CEDICT): ' + e.meaningsEn.join('; ') }) : null, exSlot);
        const speedSel = h('select', { class: 'select', 'aria-label': 'Tốc độ vẽ nét' }, h('option', { value: 'slow', text: 'Tốc độ: Chậm' }), h('option', { value: 'normal', text: 'Tốc độ: Vừa' }), h('option', { value: 'fast', text: 'Tốc độ: Nhanh' }));
        speedSel.value = this.speed;
        speedSel.addEventListener('change', () => {
            this.speed = speedSel.value;
            this.mountWriter();
        });
        const outlineBtn = h('button', {
            class: 'btn',
            type: 'button',
            'aria-pressed': String(this.outline),
            onclick: () => {
                this.outline = !this.outline;
                outlineBtn.setAttribute('aria-pressed', String(this.outline));
                if (this.outline)
                    this.writer?.showOutline({ duration: 0 });
                else
                    this.writer?.hideOutline({ duration: 0 });
            },
        }, 'Hiện chữ mờ');
        const controls = h('div', { class: 'cp-controls' }, outlineBtn, speedSel);
        this.ui = { status, audio, target, pinyinLine, decompBox };
        const header = h('div', { class: 'cp-head' }, h('h2', { class: 'cp-title', tabindex: '-1', text: `Chi tiết chữ: ${ch}` }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng bảng chữ', onclick: () => this.close() }, '✕'));
        this.root.replaceChildren(header, h('div', { class: 'cp-display' }, writerBox, decompBox), pinyinLine, status, info, audio, controls);
        if (this.mq.matches)
            this.dialog.querySelector('.cp-title')?.focus();
        this.mountWriter();
        const curSession = this.session;
        // Hiển thị các bộ cấu tạo (kèm âm Hán Việt của từng bộ)
        getComponentsMap()
            .then((cmap) => {
            if (curSession !== this.session)
                return;
            this.renderDecomp(decompBox, ch, cmap[ch]);
        })
            .catch(() => {
            if (curSession !== this.session)
                return;
            decompBox.replaceChildren(h('div', { class: 'cp-decomp-title', text: 'Bộ cấu tạo' }), h('div', { class: 'cp-note', text: 'Không tải được dữ liệu bộ cấu tạo.' }));
        });
        // Hiển thị chi tiết chữ đang chọn + câu ví dụ
        this.hooks
            .loadDetail(e)
            .then((d) => {
            if (curSession !== this.session)
                return;
            const cObj = d.characters.find((x) => x.index === this.idx);
            if (cObj?.contextualPinyin) {
                const valEl = pinyinLine.querySelector('.cp-pinyin-val');
                if (valEl)
                    valEl.textContent = cObj.contextualPinyin;
            }
            if (cObj?.contextualAudioPath) {
                charAudio = cObj.contextualAudioPath;
            }
            if (cObj && chars.length > 1) {
                charBox.replaceChildren(h('div', { class: 'cp-char-card' }, h('div', { class: 'cp-char-line' }, h('b', { lang: 'zh-Hans', text: `Chữ ${ch}` }), cObj.contextualPinyin ? h('span', { class: 'py', text: cObj.contextualPinyin }) : null), cObj.hanViet ? h('div', { class: 'cp-hv', text: cObj.hanViet }) : null, cObj.meaningVi ? h('div', { class: 'cp-char-mean', text: cObj.meaningVi }) : null));
            }
            const ex = d.examples[0];
            if (ex) {
                exSlot.replaceChildren(h('div', { class: 'ex', style: 'margin-top:8px' }, h('button', {
                    class: 'icon-btn',
                    type: 'button',
                    'aria-label': 'Nghe câu ví dụ',
                    title: 'Nghe câu ví dụ',
                    onclick: () => speakZh(ex.hanzi, ex.audioPath),
                }, '🔊'), h('div', {}, h('p', { lang: 'zh-Hans', text: ex.hanzi }), h('p', { class: 'vi', text: ex.pinyin }), h('p', { class: 'vi', text: ex.vi }))));
            }
        })
            .catch(() => undefined);
    }
    renderDecomp(box, ch, info) {
        box.replaceChildren(h('div', { class: 'cp-decomp-title', text: 'Cấu tạo chữ' }));
        if (!info || (!info.radical && !info.parts.length)) {
            box.append(h('div', { class: 'cp-note', text: `Chữ nguyên thể: ${ch}` }));
            return;
        }
        if (info.radical) {
            const r = info.radical;
            box.append(h('div', { class: 'cp-rad-block' }, h('div', { class: 'cp-decomp-sub', text: 'Bộ thủ chính' }), h('div', { class: 'cp-comp-item rad' }, h('span', { class: 'cp-comp-char', lang: 'zh-Hans', text: r.c }), h('div', { class: 'cp-comp-meta' }, h('span', { class: 'cp-comp-hv', text: r.hv || '—' }), r.name ? h('small', { class: 'cp-comp-name', text: r.name }) : null))));
        }
        const parts = info.parts.length ? info.parts : info.radical ? [info.radical] : [];
        if (parts.length) {
            box.append(h('div', { class: 'cp-parts-block' }, h('div', { class: 'cp-decomp-sub', text: 'Thành phần cấu tạo' }), h('div', { class: 'cp-comp-list' }, ...parts.map((p) => h('div', { class: 'cp-comp-item' }, h('span', { class: 'cp-comp-char', lang: 'zh-Hans', text: p.c }), h('div', { class: 'cp-comp-meta' }, h('span', { class: 'cp-comp-hv', text: p.hv || '—' }), p.name ? h('small', { class: 'cp-comp-name', text: p.name }) : null))))));
        }
    }
    replayIconSvg() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const p1 = document.createElementNS(ns, 'path');
        p1.setAttribute('d', 'M21 12a9 9 0 1 1-2.64-6.36');
        const p2 = document.createElementNS(ns, 'polyline');
        p2.setAttribute('points', '21 3 21 9 15 9');
        svg.append(p1, p2);
        return svg;
    }
    gridSvg() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'cp-grid');
        svg.setAttribute('aria-hidden', 'true');
        const add = (x1, y1, x2, y2, dash = false) => {
            const l = document.createElementNS(ns, 'line');
            l.setAttribute('x1', String(x1));
            l.setAttribute('y1', String(y1));
            l.setAttribute('x2', String(x2));
            l.setAttribute('y2', String(y2));
            if (dash)
                l.setAttribute('stroke-dasharray', '3 3');
            svg.append(l);
        };
        add(50, 0, 50, 100, false);
        add(0, 50, 100, 50, false);
        add(0, 0, 100, 100, true);
        add(100, 0, 0, 100, true);
        return svg;
    }
    colors() {
        const dark = document.documentElement.dataset.theme === 'dark';
        const cs = getComputedStyle(document.documentElement);
        return {
            stroke: dark ? '#f05448' : '#d13426',
            radical: dark ? '#6ca0ff' : '#234075',
            outline: cs.getPropertyValue('--outline').trim() || '#d5d9e2',
        };
    }
    replay() {
        if (this.writer) {
            this.writer.animateCharacter();
        }
        else {
            this.mountWriter();
        }
    }
    mountWriter() {
        if (!this.entry || !this.ui.target)
            return;
        const my = ++this.session;
        this.teardownWriter();
        this.ui.target.replaceChildren();
        const ch = Array.from(this.entry.simplified)[this.idx];
        void this.start(my, ch, this.ui.target, this.ui.status);
    }
    async start(my, char, target, status) {
        status.textContent = 'Đang tải dữ liệu nét…';
        let rec;
        try {
            const idx = await getStrokeIndex();
            if (my !== this.session)
                return;
            rec = idx[char];
        }
        catch {
            if (my !== this.session)
                return;
            status.replaceChildren('Không tải được dữ liệu nét. ', h('button', { class: 'btn', type: 'button', onclick: () => this.mountWriter() }, 'Thử lại'));
            return;
        }
        if (!rec) {
            target.replaceChildren(h('div', { class: 'cp-fallback', lang: 'zh-Hans', text: char }));
            status.textContent = 'Chưa có dữ liệu nét cho chữ này (hiển thị chữ tĩnh).';
            return;
        }
        try {
            const mod = await loadHanziWriter();
            if (my !== this.session)
                return;
            const HanziWriter = mod.default ?? mod;
            const { stroke, radical, outline } = this.colors();
            const writer = HanziWriter.create(target, char, {
                width: 220,
                height: 220,
                padding: 14,
                showCharacter: false,
                showOutline: this.outline,
                strokeAnimationSpeed: SPEEDS[this.speed],
                delayBetweenStrokes: 220,
                strokeFadeDuration: 0,
                strokeColor: stroke,
                radicalColor: radical,
                outlineColor: outline,
                charDataLoader: (_c, ok, bad) => {
                    loadCharData(rec.path).then(ok).catch(bad);
                },
                onLoadCharDataSuccess: (d) => {
                    if (my !== this.session)
                        return;
                    status.textContent = '';
                    const badge = this.ui.pinyinLine?.querySelector('.cp-stroke-badge');
                    if (badge)
                        badge.textContent = `${d.strokes.length} nét`;
                },
                onLoadCharDataError: () => {
                    if (my !== this.session)
                        return;
                    status.replaceChildren('Không tải được dữ liệu nét. ', h('button', { class: 'btn', type: 'button', onclick: () => this.mountWriter() }, 'Thử lại'));
                },
            });
            this.writer = writer;
            const badge = this.ui.pinyinLine?.querySelector('.cp-stroke-badge');
            if (badge)
                badge.textContent = `${rec.strokeCount} nét`;
            // Tự động vẽ từng nét từ đầu đến cuối rồi dừng
            writer.animateCharacter();
        }
        catch {
            if (my !== this.session)
                return;
            status.replaceChildren('Không tải được thư viện vẽ nét. ', h('button', { class: 'btn', type: 'button', onclick: () => this.mountWriter() }, 'Thử lại'));
        }
    }
}
