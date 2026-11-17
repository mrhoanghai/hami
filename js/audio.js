import { toast } from './util.js';
export const audioPrefs = { rate: 0.85 };
let current = null;
const lang = (v) => v.lang.replace('_', '-').toLowerCase();
/** Chỉ Mandarin đại lục/Đài Loan chuẩn; loại Quảng Đông (zh-HK, yue). */
export function listZhVoices() {
    if (!('speechSynthesis' in window))
        return [];
    const ok = (v) => {
        const l = lang(v), n = v.name.toLowerCase();
        if (/hk|yue|cantonese|粤|廣東|广东|sin-ji|sinji/.test(l + ' ' + n))
            return false;
        return l === 'zh-cn' || l === 'cmn-cn' || l === 'zh-hans-cn' || l === 'zh-tw' || l === 'cmn-tw' || l === 'zh';
    };
    const score = (v) => {
        const n = v.name.toLowerCase();
        let s = 0;
        if (lang(v) === 'zh-cn' || lang(v) === 'cmn-cn')
            s += 50;
        if (/premium|enhanced|natural|neural|online/.test(n))
            s += 100;
        if (/tingting|ting-ting|xiaoxiao|xiaoyi|yunxi|yunyang|google|mei-jia|lili|li-mu|yu-shu/.test(n))
            s += 30;
        if (!v.localService)
            s += 5;
        return s;
    };
    return window.speechSynthesis.getVoices().filter(ok).sort((a, b) => score(b) - score(a));
}
export function pickZhVoice() {
    const l = listZhVoices();
    return l.find((v) => v.voiceURI === audioPrefs.voiceURI) ?? l[0];
}
export function stopAudio() {
    if (current) {
        current.pause();
        current = null;
    }
    if ('speechSynthesis' in window)
        window.speechSynthesis.cancel();
}
/** Phát cả từ/câu. Ưu tiên file nội bộ (nếu có), nếu không dùng TTS thiết bị. Gọi đồng bộ trong thao tác người dùng. */
export function speakZh(text, audioPath = null) {
    stopAudio();
    if (audioPath) {
        const a = new Audio(audioPath);
        current = a;
        a.play().catch(() => toast('Không phát được audio. Hãy bấm nút Nghe lần nữa.'));
        return 'audio';
    }
    if (!('speechSynthesis' in window)) {
        toast('Trình duyệt không hỗ trợ phát âm. Chữ và nét vẫn dùng được.');
        return 'unsupported';
    }
    const voice = pickZhVoice();
    const all = window.speechSynthesis.getVoices();
    if (all.length > 0 && !voice) {
        toast('Thiết bị chưa có giọng tiếng Trung. Chữ và nét vẫn dùng được.');
        return 'no-voice';
    }
    const u = new SpeechSynthesisUtterance(text); // đọc chữ Hán, không đọc chuỗi pinyin
    u.lang = 'zh-CN';
    if (voice)
        u.voice = voice;
    u.rate = audioPrefs.rate;
    u.onerror = (ev) => { if (ev.error !== 'canceled' && ev.error !== 'interrupted')
        toast('Không phát được âm thanh trên thiết bị này.'); };
    window.speechSynthesis.speak(u);
    return 'tts';
}
