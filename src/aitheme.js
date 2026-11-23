'use strict';
/* AI 主题：用户自带 Key，按歌曲生成 mood/色板/主题名。
   - 支持 OpenAI 兼容接口（OpenAI/DeepSeek/Kimi/GLM/Qwen…）与 Google Gemini
   - 结果按歌曲缓存 30 天；无 Key / 请求失败时由前端回退到离线规则 */
const fs = require('fs');
const path = require('path');

const MOODS = ['dream', 'night', 'rain', 'warm', 'neon', 'cover', 'lineart'];
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function hex(v) {
  v = String(v || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}
function cleanText(v, max) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

class AiTheme {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.configFile = path.join(dataDir, 'ai_config.json');
    this.cacheFile = path.join(dataDir, 'ai_themes.json');
    this.segCacheFile = path.join(dataDir, 'ai_segments.json');
    this.config = {
      enabled: false,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: ''
    };
    this.cache = {};
    this.segCache = {};
    this.load();
  }

  load() {
    try {
      const c = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      if (c && typeof c === 'object') Object.assign(this.config, c);
    } catch (e) {}
    try {
      const c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (c && typeof c === 'object') this.cache = c;
    } catch (e) {}
    try {
      const c = JSON.parse(fs.readFileSync(this.segCacheFile, 'utf8'));
      if (c && typeof c === 'object') this.segCache = c;
    } catch (e) {}
  }

  saveConfig() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {}
  }

  saveCache() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache), 'utf8');
    } catch (e) {}
  }

  saveSegCache() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.segCacheFile, JSON.stringify(this.segCache), 'utf8');
    } catch (e) {}
  }

  publicConfig() {
    const k = this.config.apiKey || '';
    return {
      enabled: !!this.config.enabled,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      hasKey: !!k,
      keyHint: k ? k.slice(-4) : ''
    };
  }

  updateConfig(body) {
    const b = body || {};
    const before = [this.config.provider, this.config.baseUrl, this.config.model, this.config.apiKey].join('\n');
    if (typeof b.enabled === 'boolean') this.config.enabled = b.enabled;
    if (b.provider === 'openai' || b.provider === 'gemini') this.config.provider = b.provider;
    if (typeof b.baseUrl === 'string' && b.baseUrl.trim()) this.config.baseUrl = b.baseUrl.trim().replace(/\/+$/, '');
    if (typeof b.model === 'string' && b.model.trim()) this.config.model = b.model.trim();
    if (typeof b.apiKey === 'string' && b.apiKey.trim()) this.config.apiKey = b.apiKey.trim();
    if (b.clearKey === true) this.config.apiKey = '';
    const after = [this.config.provider, this.config.baseUrl, this.config.model, this.config.apiKey].join('\n');
    if (before !== after) {
      this.cache = {};
      this.segCache = {};
      this.saveCache();
      this.saveSegCache();
    }
    this.saveConfig();
    return this.publicConfig();
  }

  keyId(input) {
    const s = 'v2|' + String((input && (input.key || input.title || '')) || '') + '|' + String((input && input.artist) || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'ai_' + (h >>> 0).toString(36);
  }

  buildPrompt(input) {
    const title = cleanText(input && input.title, 120);
    const artist = cleanText(input && input.artist, 80);
    const lyrics = cleanText(input && input.lyrics, 1800);
    return [
      '你是音乐播放器的视觉主题设计师。根据歌曲信息设计一套「全屏动态歌词」的亮/暗双主题。',
      '只输出一个 JSON 对象，不要 Markdown、不要解释。',
      'JSON 结构：',
      '{"mood":"dream|night|rain|warm|neon|cover|lineart","name":"中文主题名，不超过10字","description":"一句中文氛围描述，15-30字","light":{"name":"亮色主题名","description":"氛围描述","backgroundColor":"#rrggbb","primaryColor":"#rrggbb","accentColor":"#rrggbb","secondaryColor":"#rrggbb","fontStyle":"sans|serif","animationIntensity":"subtle|normal|intense","wordColors":[{"word":"歌词关键词","color":"#rrggbb"}]},"dark":{"name":"暗色主题名","description":"氛围描述","backgroundColor":"#rrggbb","primaryColor":"#rrggbb","accentColor":"#rrggbb","secondaryColor":"#rrggbb","fontStyle":"sans|serif","animationIntensity":"subtle|normal|intense","wordColors":[{"word":"歌词关键词","color":"#rrggbb"}]}}',
      '规则：',
      '- mood 必须从枚举中选：night=夜晚/孤独/星月，rain=雨/泪/离别/忧郁，warm=夏天/光/花/恋爱/温暖，neon=城市/电子/高能/舞曲，lineart=黑暗/死亡/终末/强烈，cover=适合让封面本身当背景，dream=梦幻/空灵/其他。',
      '- light 是浅色纸感主题：backgroundColor 接近米白/浅灰（亮度 80%-95%），primaryColor 接近墨黑，accentColor 是情绪色，secondaryColor 是辅助色。',
      '- dark 是深色主题：backgroundColor 很暗（亮度 5%-25%），primaryColor 接近白，accentColor 足够亮，secondaryColor 是辅助色。',
      '- 两套主题情绪一致，但配色分别适配日间/夜间；颜色必须是 #rrggbb。',
      '- wordColors 从歌词里挑 3-8 个关键词，给每个词一个颜色（用于逐词着色）。',
      '- animationIntensity 决定动效强度；慢歌用 subtle，普通 normal，强烈/高能用 intense。',
      '- 纯音乐没有歌词时，根据标题和歌手判断。',
      '歌曲信息：',
      '标题：' + title,
      '歌手：' + artist,
      '歌词片段：',
      lyrics || '（无歌词）'
    ].join('\n');
  }

  async callOpenAI(prompt, opts) {
    const o = opts || {};
    const base = String(this.config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 20000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.config.apiKey },
        body: JSON.stringify({
          model: this.config.model,
          temperature: typeof o.temperature === 'number' ? o.temperature : 0.7,
          max_tokens: o.maxTokens,
          reasoning_effort: o.reasoningEffort,
          messages: [
            { role: 'system', content: 'You only reply with valid JSON. No markdown, no prose.' },
            { role: 'user', content: prompt }
          ]
        }),
        signal: ctrl.signal
      });
      const txt = await r.text();
      if (!r.ok) throw new Error('AI HTTP ' + r.status + ' ' + txt.slice(0, 140));
      const j = JSON.parse(txt);
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      const out = msg && (msg.content || msg.reasoning_content);
      if (!out) throw new Error('AI 返回为空');
      return String(out);
    } finally {
      clearTimeout(timer);
    }
  }

  async callGemini(prompt, opts) {
    const o = opts || {};
    const base = String(this.config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = encodeURIComponent(this.config.model || 'gemini-2.0-flash');
    const url = base + '/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(this.config.apiKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 20000);
    try {
      const gc = {
        temperature: typeof o.temperature === 'number' ? o.temperature : 0.7,
        responseMimeType: 'application/json'
      };
      if (o.maxTokens) gc.maxOutputTokens = o.maxTokens;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: gc
        }),
        signal: ctrl.signal
      });
      const txt = await r.text();
      if (!r.ok) throw new Error('AI HTTP ' + r.status + ' ' + txt.slice(0, 140));
      const j = JSON.parse(txt);
      const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      const out = (parts || []).map(p => p.text || '').join('');
      if (!out) throw new Error('AI 返回为空');
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  sanitizeTone(t, fallback, fallbackName, fallbackDesc) {
    t = t && typeof t === 'object' ? t : {};
    const isLight = fallback === 'light';
    const bg = hex(t.backgroundColor) || (isLight ? '#efe9dc' : '#0d1117');
    const primary = hex(t.primaryColor) || (isLight ? '#171512' : '#f2f5f7');
    const accent = hex(t.accentColor) || '#fb7299';
    const secondary = hex(t.secondaryColor) || (isLight ? '#6b6258' : '#8b93a1');
    const fontStyle = t.fontStyle === 'serif' ? 'serif' : 'sans';
    const anim = ['subtle', 'normal', 'intense'].includes(t.animationIntensity) ? t.animationIntensity : 'normal';
    const wordColors = [];
    if (Array.isArray(t.wordColors)) {
      for (const w of t.wordColors) {
        if (!w || typeof w !== 'object') continue;
        const word = cleanText(w.word, 12);
        const color = hex(w.color);
        if (word && color && !wordColors.some(x => x.word === word)) wordColors.push({ word: word, color: color });
        if (wordColors.length >= 10) break;
      }
    }
    return {
      name: cleanText(t.name, 12) || fallbackName,
      description: cleanText(t.description, 40) || fallbackDesc,
      backgroundColor: bg,
      primaryColor: primary,
      accentColor: accent,
      secondaryColor: secondary,
      fontStyle: fontStyle,
      animationIntensity: anim,
      wordColors: wordColors
    };
  }

  parseTheme(text) {
    const raw = String(text || '');
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 没有返回 JSON');
    const j = JSON.parse(raw.slice(a, b + 1));
    const mood = MOODS.includes(j.mood) ? j.mood : 'dream';
    const name = cleanText(j.name, 10) || '未命名';
    const description = cleanText(j.description, 40);
    let light = j.light;
    let dark = j.dark;
    if (!light || !dark) {
      const p = j.palette || {};
      const accent = hex(p.accent) || '#fb7299';
      dark = {
        backgroundColor: hex(p.bg) || '#0d1117',
        primaryColor: hex(p.text) || '#ffffff',
        accentColor: accent,
        secondaryColor: hex(p.light) || accent,
        name: name,
        description: description
      };
      light = {
        backgroundColor: '#efe9dc',
        primaryColor: '#171512',
        accentColor: accent,
        secondaryColor: '#6b6258',
        name: name,
        description: description
      };
    }
    const thLight = this.sanitizeTone(light, 'light', name, description);
    const thDark = this.sanitizeTone(dark, 'dark', name, description);
    return {
      mood: mood,
      name: name,
      description: description,
      intensity: clamp(Number(j.intensity) || 0.8, 0.5, 1),
      light: thLight,
      dark: thDark,
      palette: {
        accent: thDark.accentColor,
        light: thDark.secondaryColor,
        bg: thDark.backgroundColor,
        text: thDark.primaryColor
      }
    };
  }

  async generate(input) {
    if (!this.config.enabled) {
      const e = new Error('AI 主题未启用');
      e.code = 'AI_OFF';
      throw e;
    }
    if (!this.config.apiKey) {
      const e = new Error('还没有填写 AI API Key');
      e.code = 'AI_NO_KEY';
      throw e;
    }
    const id = this.keyId(input || {});
    const hit = this.cache[id];
    if (hit && hit.theme && Date.now() - (hit.at || 0) < CACHE_TTL) {
      return { key: id, theme: hit.theme, cached: true };
    }
    const prompt = this.buildPrompt(input || {});
    let text;
    try {
      text = this.config.provider === 'gemini' ? await this.callGemini(prompt) : await this.callOpenAI(prompt);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('AI 请求超时');
        err.code = 'AI_TIMEOUT';
        throw err;
      }
      throw e;
    }
    const theme = this.parseTheme(text);
    this.cache[id] = { theme: theme, at: Date.now() };
    const keys = Object.keys(this.cache);
    if (keys.length > CACHE_MAX) {
      keys.sort((x, y) => (this.cache[x].at || 0) - (this.cache[y].at || 0));
      for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete this.cache[k];
    }
    this.saveCache();
    return { key: id, theme: theme, cached: false };
  }

  segKey(lines) {
    const s = 'seg1|' + this.config.provider + '|' + this.config.model + '|' + lines.join('\u0001');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'seg_' + (h >>> 0).toString(36);
  }

  buildSegmentationPrompt(lines) {
    const numbered = lines.map((t, i) => (i + 1) + '. ' + t).join('\n');
    return [
      '你是歌词排版引擎的分词器。把每行歌词切成“一个词/词组”单元，供逐词动画使用。',
      '只输出 JSON，不要 Markdown、不要解释。格式：{"lines":[["词","词"],["词"]]}',
      '规则：',
      '1. 无损：每行所有片段按顺序拼接必须原样还原该行，包括空格、标点、符号；不要翻译、改写、纠正拼写。',
      '2. 行数与顺序必须和输入一致，每行一个数组。',
      '3. 中文/日文/韩文按语义词和固定搭配切，不要逐字切；把助词、送假名、词尾粘在前一个词上（如 不知道 / 孤独的 / 見えない / ように / キラキラ）。',
      '4. 英文按空格分词，缩写和所有格不拆（it’s / don’t / We’re）。',
      '5. 标点粘在前一个片段；括号/引号内的内容保持完整；空格粘在前一个片段。',
      '6. 输入行首的“数字. ”是编号，不要写进结果。',
      '示例：',
      '输入：1. 把回忆拼好给你',
      '输出：{"lines":[["把","回忆","拼好","给你"]]}',
      '输入：2. It’s unbelievable, isn’t it?',
      '输出：{"lines":[["It’s ","unbelievable, ","isn’t ","it?"]]}',
      '输入：3. 見えないようにさ 隠しても',
      '输出：{"lines":[["見えない","ように","さ ","隠しても"]]}',
      '输入歌词（共 ' + lines.length + ' 行）：',
      numbered
    ].join('\n');
  }

  /* 只信 AI 给出的“切分位置”，文本本身始终从原行切片，避免模型改字/丢空格 */
  realignSegments(parts, text) {
    if (!Array.isArray(parts)) return null;
    const clean = parts.map(p => String(p == null ? '' : p)).filter(p => p.length > 0);
    if (!clean.length) return null;
    if (clean.join('') === text) return clean;
    const strip = s => String(s).replace(/\s+/g, '').normalize('NFKC');
    if (clean.map(strip).join('') !== strip(text)) return null;
    const out = [];
    let pos = 0;
    for (const part of clean) {
      let need = strip(part).length;
      const start = pos;
      while (pos < text.length && need > 0) {
        if (!/\s/.test(text[pos])) need--;
        pos++;
      }
      while (pos < text.length && /\s/.test(text[pos])) pos++;
      out.push(text.slice(start, pos));
    }
    if (pos < text.length) out[out.length - 1] += text.slice(pos);
    return out.join('') === text ? out : null;
  }

  parseSegmentation(text, originals) {
    const raw = String(text || '');
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 分词没有返回 JSON');
    let j;
    try { j = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error('AI 分词 JSON 解析失败'); }
    const arr = j && j.lines;
    if (!Array.isArray(arr) || arr.length !== originals.length) throw new Error('AI 分词行数不一致');
    return originals.map((line, i) => {
      let parts = arr[i];
      if (typeof parts === 'string') parts = parts.split('/');
      return this.realignSegments(parts, line);
    });
  }

  async segment(input) {
    if (!this.config.enabled) {
      const e = new Error('AI 未启用');
      e.code = 'AI_OFF';
      throw e;
    }
    if (!this.config.apiKey) {
      const e = new Error('还没有填写 AI API Key');
      e.code = 'AI_NO_KEY';
      throw e;
    }
    let lines = (input && Array.isArray(input.lines) ? input.lines : [])
      .map(t => String(t == null ? '' : t));
    if (!lines.some(t => t.trim().length > 0)) throw new Error('没有可分词的歌词');
    if (lines.length > 160) lines = lines.slice(0, 160);
    const key = this.segKey(lines);
    const hit = this.segCache[key];
    if (hit && Array.isArray(hit.lines) && Date.now() - (hit.at || 0) < CACHE_TTL) {
      return { key: key, lines: hit.lines, cached: true };
    }
    const prompt = this.buildSegmentationPrompt(lines);
    const opts = { temperature: 0.1, maxTokens: 4096, timeoutMs: 25000, reasoningEffort: 'none' };
    let text;
    try {
      text = this.config.provider === 'gemini'
        ? await this.callGemini(prompt, opts)
        : await this.callOpenAI(prompt, opts);
    } catch (e) {
      // 少数 OpenAI 兼容服务不认 reasoning_effort，去掉它再试一次
      if (e && /HTTP (400|422)/.test(e.message || '') && this.config.provider !== 'gemini') {
        try {
          text = await this.callOpenAI(prompt, { temperature: 0.1, maxTokens: 4096, timeoutMs: 25000 });
        } catch (e2) {
          if (e2 && e2.name === 'AbortError') {
            const err = new Error('AI 分词超时');
            err.code = 'AI_TIMEOUT';
            throw err;
          }
          throw e2;
        }
      } else {
        if (e && e.name === 'AbortError') {
          const err = new Error('AI 分词超时');
          err.code = 'AI_TIMEOUT';
          throw err;
        }
        throw e;
      }
    }
    const parsed = this.parseSegmentation(text, lines);
    this.segCache[key] = { lines: parsed, at: Date.now() };
    const keys = Object.keys(this.segCache);
    if (keys.length > 400) {
      keys.sort((x, y) => (this.segCache[x].at || 0) - (this.segCache[y].at || 0));
      for (const k of keys.slice(0, keys.length - 400)) delete this.segCache[k];
    }
    this.saveSegCache();
    return { key: key, lines: parsed, cached: false };
  }

  async test() {
    if (!this.config.apiKey) {
      const e = new Error('还没有填写 AI API Key');
      e.code = 'AI_NO_KEY';
      throw e;
    }
    const prompt = '只输出 JSON：{"ok":true,"msg":"pong"}';
    const t0 = Date.now();
    const text = this.config.provider === 'gemini' ? await this.callGemini(prompt) : await this.callOpenAI(prompt);
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    let ok = false;
    try { ok = !!(a >= 0 && b > a && JSON.parse(text.slice(a, b + 1)).ok); } catch (e) {}
    if (!ok) throw new Error('AI 返回格式不正确');
    return { ok: true, latencyMs: Date.now() - t0, provider: this.config.provider, model: this.config.model };
  }
}

module.exports = AiTheme;
