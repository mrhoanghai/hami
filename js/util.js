/** Chuẩn hóa để tìm kiếm: hoa thường, bỏ dấu, `đ` -> `d` riêng. */
export function normalize(s) {
    return s
        .toLowerCase()
        .replace(/đ/g, 'd')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false)
            continue;
        if (k === 'class')
            el.className = v;
        else if (k === 'text')
            el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function')
            el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset')
            Object.assign(el.dataset, v);
        else if (v === true)
            el.setAttribute(k, '');
        else
            el.setAttribute(k, String(v));
    }
    for (const c of children)
        if (c)
            el.append(c);
    return el;
}
/** Hiển thị `==...==` thành <mark>, mọi thứ khác là text node (không dùng innerHTML). */
export function highlight(text) {
    const frag = document.createDocumentFragment();
    const parts = text.split('==');
    parts.forEach((p, i) => {
        if (!p)
            return;
        if (i % 2 === 1 && i < parts.length - 1)
            frag.append(h('mark', { text: p }));
        else
            frag.append(document.createTextNode(i % 2 === 1 ? '==' + p : p));
    });
    return frag;
}
/** So sánh đáp án: chuẩn hóa khoảng trắng, hoa thường, bỏ dấu câu cuối. */
export function normAnswer(s) {
    return s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/[.!?\s]+$/g, '').trim();
}
export function debounce(fn, ms) {
    let t;
    return (...a) => {
        window.clearTimeout(t);
        t = window.setTimeout(() => fn(...a), ms);
    };
}
let toastTimer;
export function toast(msg) {
    const el = document.getElementById('toast');
    if (!el)
        return;
    el.textContent = msg;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 3500);
}
