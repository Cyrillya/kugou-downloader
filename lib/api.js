import axios from 'axios';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

export const API_BASE = 'http://localhost:3000';
export const DOWNLOAD_DIR = path.join(process.cwd(), 'Downloads');
export const SESSION_FILE = path.join(process.cwd(), 'session.json');

const cookieJar = {};

// ─── HTTP helpers ────────────────────────────────────────

export async function api(method, route, params = {}) {
  const config = { method, url: `${API_BASE}${route}`, headers: {}, timeout: 15000 };
  const cs = Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  if (cs) config.headers['Cookie'] = cs;
  config.params = params;
  if (method !== 'GET') config.data = params;
  try {
    const res = await axios(config);
    for (const c of res.headers['set-cookie'] || []) {
      const m = c.match(/^([^=]+)=([^;]+)/);
      if (m) cookieJar[m[1]] = m[2];
    }
    return res.data;
  } catch (err) {
    if (err.response) {
      for (const c of err.response.headers['set-cookie'] || []) {
        const m = c.match(/^([^=]+)=([^;]+)/);
        if (m) cookieJar[m[1]] = m[2];
      }
      return err.response.data;
    }
    return { status: 0, error: err.message };
  }
}

export function get(obj, p, fallback) {
  const ks = p.split('.');
  let c = obj;
  for (const k of ks) {
    if (c == null || typeof c !== 'object') return fallback;
    c = c[k];
  }
  return c !== undefined ? c : fallback;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Session ─────────────────────────────────────────────

export function saveSession() {
  const keys = [
    'token', 'userid', 'vip_type', 'vip_token', 'dfid',
    'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC',
  ];
  const data = { _savedAt: new Date().toISOString() };
  for (const k of keys) {
    if (cookieJar[k]) data[k] = cookieJar[k];
  }
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

export function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    for (const k of Object.keys(data)) {
      if (k !== '_savedAt' && data[k]) cookieJar[k] = String(data[k]);
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch (e) { /* ok */ }
  const keep = ['dfid', 'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC'];
  Object.keys(cookieJar).forEach((k) => {
    if (!keep.includes(k)) delete cookieJar[k];
  });
}

export function isLoggedIn() {
  return !!cookieJar['token'];
}

export async function verifySession() {
  const r = await api('GET', '/user/vip/detail');
  return get(r, 'status') === 1;
}

// ─── Download file ───────────────────────────────────────

export async function downloadFile(url, dest) {
  const parsed = new URL(url);
  const mod = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const w = fs.createWriteStream(dest);
      w.on('error', (e) => {
        w.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(e);
      });
      w.on('finish', resolve);
      res.pipe(w);
    }).on('error', (e) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(e);
    });
  });
}

// ─── Login ────────────────────────────────────────────────

export async function sendCaptcha(mobile) {
  return api('GET', '/captcha/sent', { mobile });
}

export async function loginWithCode(mobile, code) {
  const login = await api('POST', '/login/cellphone', { mobile: mobile.trim(), code: code.trim() });
  if (get(login, 'status') !== 1) {
    throw new Error(login.message || login.msg || '登录失败');
  }
  const vip = await api('POST', '/youth/vip');
  saveSession();
  return get(vip, 'status') === 1 ? 'vip_activated' : 'logged_in';
}

// ─── Playlist ─────────────────────────────────────────────

export async function resolvePlaylistId(inputUrl) {
  // Follow redirects to get real URL
  let realUrl = inputUrl.trim();
  try {
    const parsed = new URL(realUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    realUrl = await new Promise((resolve, reject) => {
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'HEAD',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }, (res) => resolve(res.headers.location || realUrl));
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  } catch (e) { /* use original URL */ }
  const qs = new URL(realUrl).searchParams;
  return qs.get('global_specialid') || null;
}

export async function fetchPlaylistTracks(pid, onProgress) {
  let allTracks = [], page = 1, total = 0;
  do {
    const td = await api('GET', '/playlist/track/all', { id: pid, page, pagesize: 200 });
    if (get(td, 'status') !== 1) throw new Error('获取歌单失败');
    const songs = get(td, 'data.songs', []);
    total = get(td, 'data.count', 0) || songs.length;
    allTracks = allTracks.concat(songs);
    if (onProgress) onProgress(page, songs.length, total);
    page++;
  } while (allTracks.length < total);
  return allTracks;
}

// ─── Search ───────────────────────────────────────────────

export async function searchSongs(keyword, page = 1, pageSize = 10) {
  const r = await api('GET', '/search', { keywords: keyword.trim(), page, pagesize: pageSize });
  const lists = get(r, 'data.lists', []);
  const total = get(r, 'data.total', lists.length);
  return { lists, total };
}

// ─── Song URL ─────────────────────────────────────────────

export async function getSongUrl(hash, albumId, quality = 'flac') {
  return api('GET', '/song/url', { hash, quality, album_id: albumId || 0 });
}

// ─── Device register ──────────────────────────────────────

export async function registerDevice() {
  return api('POST', '/register/dev');
}

// ─── Health check ─────────────────────────────────────────

export async function healthCheck() {
  return api('GET', '/');
}

// ─── Song info extractors ─────────────────────────────────

export function extractSongInfo(raw) {
  const s = raw.songinfo || raw.info || raw.song || raw.data || raw;
  let name = s.OriSongName || s.name || s.title || s.songname || s.SongName ||
    s.songName || s.song_name || s.audio_name || s.track_name || '';
  let singer = s.SingerName || s.singer || s.singername || s.singerName ||
    s.singer_name || s.author_name || s.authorname || '';
  if (!name && !singer) {
    const fn = s.FileName || s.filename || s.fileName || s.file_name || '';
    const sep = fn.indexOf(' - ');
    if (sep > 0) { singer = fn.substring(0, sep).trim(); name = fn.substring(sep + 3).trim(); }
    else name = fn;
  }
  if (!name) name = '未知';

  const hash = s.FileHash || s.hash || s.Hash || s.sqhash || s.SQHash ||
    s.hqhash || s.HQHash || s.file_hash || '';
  const albumId = s.AlbumID || s.album_id || s.albumid || s.albumId || 0;

  const sq = s.SQ || s.sq;
  const hq = s.HQ || s.hq;
  const bitrate = parseInt(s.Bitrate || s.bitrate || 0);
  const quality = (sq && String(sq).length > 10) ? 'FLAC'
    : (hq && String(hq).length > 10) ? 'HQ'
    : bitrate >= 320 ? '320k'
    : bitrate > 0 ? `${bitrate}k`
    : '';

  return { name, singer, hash, albumId, quality };
}

// ─── File existence check ─────────────────────────────────

export function findExistingFile(songName, dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const tL = songName.toLowerCase();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext !== '.flac' && ext !== '.mp3') continue;
    if (path.basename(f, ext).toLowerCase().includes(tL)) return path.join(dir, f);
  }
  return null;
}
