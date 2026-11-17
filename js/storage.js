export const PROGRESS_KEY = 'vocab_zh_progress_v1';
export const SETTINGS_KEY = 'vocab_zh_settings_v1';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export let storageOk = true;
function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw)
            return fallback;
        const v = JSON.parse(raw);
        return v && typeof v === 'object' ? v : fallback;
    }
    catch {
        storageOk = false;
        return fallback;
    }
}
/** Trả về false nếu không lưu được (bị chặn / hết dung lượng); dữ liệu vẫn nằm trong bộ nhớ phiên. */
function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        storageOk = true;
        return true;
    }
    catch {
        storageOk = false;
        return false;
    }
}
export const loadProgress = () => readJson(PROGRESS_KEY, {});
export const loadSettings = () => readJson(SETTINGS_KEY, {});
export const saveProgress = (p) => writeJson(PROGRESS_KEY, p);
export const saveSettings = (s) => writeJson(SETTINGS_KEY, s);
export function clearAll() {
    try {
        localStorage.removeItem(PROGRESS_KEY);
        localStorage.removeItem(SETTINGS_KEY);
        return true;
    }
    catch {
        return false;
    }
}
/** Kiểm tra và merge; ném Error với thông báo tiếng Việt nếu file hỏng. Không thay đổi dữ liệu hiện có. */
export function parseImport(text, size, current, currentSettings, knownIds) {
    if (size > MAX_IMPORT_BYTES)
        throw new Error('File lớn hơn 5 MB.');
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new Error('File không phải JSON hợp lệ.');
    }
    if (!data || typeof data !== 'object' || data.schemaVersion !== 1)
        throw new Error('Sai định dạng hoặc phiên bản schema không được hỗ trợ.');
    if (data.language !== 'zh-Hans')
        throw new Error('File này không phải tiến độ tiếng Trung (thiếu language = zh-Hans).');
    if (!data.progress || typeof data.progress !== 'object' || Array.isArray(data.progress))
        throw new Error('Thiếu phần tiến độ (progress).');
    const merged = { ...current };
    let applied = 0, skippedUnknown = 0, skippedOlder = 0;
    for (const [id, raw] of Object.entries(data.progress)) {
        if (!raw || typeof raw !== 'object' || typeof raw.updatedAt !== 'number')
            throw new Error(`Mục tiến độ không hợp lệ: ${id}`);
        if (raw.starred !== undefined && typeof raw.starred !== 'boolean')
            throw new Error(`Giá trị starred không hợp lệ: ${id}`);
        if (raw.learned !== undefined && typeof raw.learned !== 'boolean')
            throw new Error(`Giá trị learned không hợp lệ: ${id}`);
        if (!knownIds.has(id)) {
            skippedUnknown++;
            continue;
        }
        const cur = merged[id];
        if (cur && cur.updatedAt >= raw.updatedAt) {
            skippedOlder++;
            continue;
        }
        const item = { updatedAt: raw.updatedAt };
        if (raw.starred !== undefined)
            item.starred = raw.starred;
        if (raw.learned !== undefined)
            item.learned = raw.learned;
        merged[id] = item;
        applied++;
    }
    const settings = { ...currentSettings };
    const s = data.settings;
    if (s && typeof s === 'object') {
        if (s.theme === 'light' || s.theme === 'dark')
            settings.theme = s.theme;
        if (s.pageSize === 10 || s.pageSize === 20 || s.pageSize === 50)
            settings.pageSize = s.pageSize;
    }
    return { progress: merged, settings, applied, skippedUnknown, skippedOlder };
}
