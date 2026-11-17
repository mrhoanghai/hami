/**
 * Dropdown tuỳ biến cho mọi <select class="select">:
 * danh sách luôn xổ xuống ngay bên dưới ô chọn (không đè lên nút như popup mặc định của macOS).
 * <select> gốc vẫn là nguồn dữ liệu: đọc/ghi .value và sự kiện 'change' hoạt động như cũ.
 */
let menu = null;
let owner = null;
function closeMenu(refocus = false) {
    if (!menu)
        return;
    const o = owner;
    menu.remove();
    menu = null;
    owner = null;
    o?.setAttribute('aria-expanded', 'false');
    if (refocus)
        o?.focus();
}
function openMenu(sel) {
    if (menu && owner === sel) {
        closeMenu();
        return;
    }
    closeMenu();
    const rect = sel.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'dd-menu';
    m.setAttribute('role', 'listbox');
    m.style.minWidth = `${rect.width}px`;
    m.style.left = `${rect.left}px`;
    m.style.top = `${rect.bottom + 4}px`;
    const room = window.innerHeight - rect.bottom - 16;
    m.style.maxHeight = `${Math.max(140, Math.min(320, room))}px`;
    const opts = Array.from(sel.options);
    let active = Math.max(0, sel.selectedIndex);
    const items = opts.map((o, i) => {
        const it = document.createElement('div');
        it.className = 'dd-item';
        it.setAttribute('role', 'option');
        it.textContent = o.textContent;
        if (o.disabled)
            it.classList.add('disabled');
        if (i === sel.selectedIndex)
            it.classList.add('selected');
        it.setAttribute('aria-selected', String(i === sel.selectedIndex));
        it.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (o.disabled)
                return;
            const changed = sel.value !== o.value;
            sel.value = o.value;
            closeMenu(true);
            if (changed)
                sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        it.addEventListener('mousemove', () => setActive(i));
        m.append(it);
        return it;
    });
    function setActive(i) {
        active = i;
        items.forEach((el, k) => el.classList.toggle('active', k === i));
    }
    setActive(active);
    m.addEventListener('mousedown', (ev) => ev.preventDefault());
    m.addEventListener('click', (ev) => ev.stopPropagation());
    m._nav = (k) => {
        if (k === 'ArrowDown')
            setActive(Math.min(items.length - 1, active + 1));
        else if (k === 'ArrowUp')
            setActive(Math.max(0, active - 1));
        else if (k === 'Home')
            setActive(0);
        else if (k === 'End')
            setActive(items.length - 1);
        else if (k === 'Enter' || k === ' ')
            items[active]?.click();
        else
            return false;
        items[active]?.scrollIntoView({ block: 'nearest' });
        return true;
    };
    (sel.closest('dialog[open]') ?? document.body).append(m);
    menu = m;
    owner = sel;
    sel.setAttribute('aria-expanded', 'true');
    m.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}
export function initDropdowns() {
    const isSel = (t) => t instanceof HTMLSelectElement && t.classList.contains('select') ? t : null;
    document.addEventListener('mousedown', (ev) => {
        const sel = isSel(ev.target);
        if (sel) {
            ev.preventDefault(); // chặn popup native
            sel.focus();
            openMenu(sel);
            return;
        }
        if (menu && !(ev.target instanceof Node && menu.contains(ev.target)))
            closeMenu();
    }, true);
    document.addEventListener('keydown', (ev) => {
        if (menu) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeMenu(true);
                return;
            }
            if (ev.key === 'Tab') {
                closeMenu();
                return;
            }
            const nav = menu._nav;
            if (nav && nav(ev.key)) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            return;
        }
        const sel = isSel(ev.target);
        if (sel && (ev.key === 'Enter' || ev.key === ' ' || (ev.altKey && ev.key === 'ArrowDown'))) {
            ev.preventDefault();
            openMenu(sel);
        }
    }, true);
    window.addEventListener('resize', () => closeMenu());
    window.addEventListener('scroll', (ev) => {
        if (menu && !(ev.target instanceof Node && menu.contains(ev.target)))
            closeMenu();
    }, true);
}
