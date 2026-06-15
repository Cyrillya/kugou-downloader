const readline = require('readline');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const API_BASE = 'http://localhost:3000';
const DOWNLOAD_DIR = path.join(__dirname, 'Downloads');
const SESSION_FILE = path.join(__dirname, 'session.json');

const cookieJar = {};

// ─── helpers ─────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function api(method, route, params = {}) {
  const config = { method, url: `${API_BASE}${route}`, headers: {}, timeout: 15000 };
  const cs = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cs) config.headers['Cookie'] = cs;
  config.params = params;
  if (method !== 'GET') config.data = params;
  try {
    const res = await axios(config);
    for (const c of (res.headers['set-cookie'] || [])) {
      const m = c.match(/^([^=]+)=([^;]+)/);
      if (m) cookieJar[m[1]] = m[2];
    }
    return res.data;
  } catch (err) {
    if (err.response) {
      for (const c of (err.response.headers['set-cookie'] || [])) {
        const m = c.match(/^([^=]+)=([^;]+)/);
        if (m) cookieJar[m[1]] = m[2];
      }
      return err.response.data;
    }
    return { status: 0, error: err.message };
  }
}

function get(obj, p, f) {
  const ks = p.split('.');
  let c = obj;
  for (const k of ks) { if (c == null || typeof c !== 'object') return f; c = c[k]; }
  return c !== undefined ? c : f;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function log(msg, color) {
  const codes = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
  console.log((codes[color] || '') + msg + codes.reset);
}

// ─── session ─────────────────────────────────────────────

function saveSession() {
  const keys = ['token', 'userid', 'vip_type', 'vip_token', 'dfid',
    'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC'];
  const data = { _savedAt: new Date().toISOString() };
  for (const k of keys) { if (cookieJar[k]) data[k] = cookieJar[k]; }
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    for (const k of Object.keys(data)) { if (k !== '_savedAt' && data[k]) cookieJar[k] = String(data[k]); }
    return true;
  } catch (e) { return false; }
}

function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch (e) { }
  const keep = ['dfid', 'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC'];
  Object.keys(cookieJar).forEach(k => { if (!keep.includes(k)) delete cookieJar[k]; });
}

async function verifySession() {
  const r = await api('GET', '/user/vip/detail');
  return get(r, 'status') === 1;
}

// ─── download file ───────────────────────────────────────

async function downloadFile(url, dest) {
  const parsed = new URL(url);
  const mod = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy(); return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.destroy(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const w = fs.createWriteStream(dest);
      w.on('error', e => { w.close(); if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(e); });
      w.on('finish', resolve);
      res.pipe(w);
    }).on('error', e => { if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(e); });
  });
}

// ─── login ───────────────────────────────────────────────

async function doLogin() {
  clearScreen();
  console.log('=== 登录 ===');

  const phone = await ask('手机号: ');
  if (!phone.trim()) return false;

  console.log('正在发送验证码...');
  const c = await api('GET', '/captcha/sent', { mobile: phone.trim() });
  if (get(c, 'status') !== 1) {
    log('验证码发送失败: ' + (c.message || c.msg || ''), 'red');
    return false;
  }
  log('验证码已发送, 请查收短信', 'green');

  const code = await ask('验证码: ');
  if (!code.trim()) return false;

  console.log('正在登录...');
  const login = await api('POST', '/login/cellphone', { mobile: phone.trim(), code: code.trim() });
  if (get(login, 'status') !== 1) {
    log('登录失败: ' + (login.message || login.msg || '未知错误'), 'red');
    return false;
  }

  const vip = await api('POST', '/youth/vip');
  if (get(vip, 'status') === 1) log('✓ 登录成功 + VIP 已激活', 'green');
  else log('✓ 登录成功 (VIP可能已领取)', 'green');

  saveSession();
  return true;
}

// ─── download playlist ───────────────────────────────────

async function downloadPlaylist() {
  clearScreen();
  console.log('=== 下载歌单 ===');
  if (!cookieJar['token']) {
    log('请先登录!', 'yellow');
    return;
  }

  const url = await ask('歌单链接 (回车返回): ');
  if (!url.trim()) return;

  // Resolve short link
  console.log('解析链接...');
  let realUrl = url.trim();
  try {
    const parsed = new URL(realUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    realUrl = await new Promise((resolve, reject) => {
      const req = mod.request({
        hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''), method: 'HEAD', timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }, (res) => resolve(res.headers.location || realUrl));
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  } catch (e) { log('链接解析失败: ' + e.message, 'yellow'); }

  let pid;
  try { const qs = new URL(realUrl).searchParams; pid = qs.get('global_specialid'); } catch (e) { }
  if (!pid) { log('无法提取歌单ID', 'red'); return; }
  console.log('歌单 ID: ' + pid);

  // Fetch tracks
  console.log('获取歌曲列表...');
  let allTracks = [], page = 1, total = 0;
  do {
    const td = await api('GET', '/playlist/track/all', { id: pid, page, pagesize: 200 });
    if (get(td, 'status') !== 1) { log('获取歌单失败', 'red'); return; }
    const songs = get(td, 'data.songs', []);
    total = get(td, 'data.count', 0) || songs.length;
    allTracks = allTracks.concat(songs);
    console.log(`  第 ${page} 页: ${songs.length} 首 (共${total}首)`);
    page++;
  } while (allTracks.length < total);
  console.log(`共 ${allTracks.length} 首歌曲\n`);

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  let flacC = 0, fallbackC = 0, failC = 0;
  const fallbackList = [];

  function hasLive(str) { return /\(?\s*[Ll][Ii][Vv][Ee]\s*\)?/.test(str); }
  function findEx(songName, dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    const tL = songName.toLowerCase();
    const tLive = hasLive(tL);
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (ext !== '.flac' && ext !== '.mp3') continue;
      if (hasLive(f) !== tLive) continue;
      if (path.basename(f, ext).toLowerCase().includes(tL)) return path.join(dir, f);
    }
    return null;
  }

  for (let i = 0; i < allTracks.length; i++) {
    const track = allTracks[i];
    const hash = track.hash;
    const albumId = track.album_id || 0;
    const name = track.name || '';
    const sep = name.indexOf(' - ');
    const singer = sep > 0 ? name.substring(0, sep).trim() : name;
    const song = sep > 0 ? name.substring(sep + 3).trim() : name;
    const safe = `${singer} - ${song}`.replace(/[<>:"/\\|?*]/g, '_');
    const label = `[${i + 1}/${allTracks.length}] ${singer} - ${song}`;

    const ex = findEx(`${singer} - ${song}`, DOWNLOAD_DIR);
    if (ex) {
      const e = path.extname(ex).toLowerCase();
      console.log(`${label}  ✓ 已存在 (${e === '.flac' ? 'FLAC' : 'MP3'})`);
      if (e === '.flac') flacC++; else fallbackC++;
      continue;
    }

    let ok = false;
    const r1 = await api('GET', '/song/url', { hash, quality: 'flac', album_id: albumId });
    const u1 = get(r1, 'url', []);
    if (r1.status === 1 && u1.length > 0) {
      try {
        await downloadFile(u1[0], path.join(DOWNLOAD_DIR, `${safe}.flac`));
        const sz = (fs.statSync(path.join(DOWNLOAD_DIR, `${safe}.flac`)).size / 1024 / 1024).toFixed(1);
        console.log(`${label}  ✓ FLAC (${sz} MB)`);
        flacC++; ok = true;
      } catch (e) { /* fallback */ }
    }

    if (!ok) {
      const r2 = await api('GET', '/song/url', { hash, quality: '320', album_id: albumId });
      const u2 = get(r2, 'url', []);
      if (r2.status === 1 && u2.length > 0) {
        try {
          await downloadFile(u2[0], path.join(DOWNLOAD_DIR, `${safe}.mp3`));
          const sz = (fs.statSync(path.join(DOWNLOAD_DIR, `${safe}.mp3`)).size / 1024 / 1024).toFixed(1);
          log(`${label}  ⚠ MP3 320k (${sz} MB)`, 'yellow');
          fallbackC++; fallbackList.push(`${singer} - ${song}`);
        } catch (e) { log(`${label}  ✗ 下载失败`, 'red'); failC++; }
      } else {
        log(`${label}  ✗ 无可用链接`, 'red');
        failC++;
      }
    }

    await sleep(300);
  }

  console.log(`\n=== 下载完成 ===`);
  console.log(`总: ${allTracks.length}  FLAC: ${flacC}  降级: ${fallbackC}  失败: ${failC}`);
  if (fallbackList.length > 0) {
    console.log(`\n降级为 MP3 的歌曲 (${fallbackList.length}首):`);
    fallbackList.forEach(n => console.log('  ' + n));
  }
}

// ─── search ──────────────────────────────────────────────

async function doSearch() {
  clearScreen();
  console.log('=== 搜索歌曲 ===');
  if (!cookieJar['token']) {
    log('请先登录!', 'yellow');
    return;
  }

  const keyword = await ask('歌名: ');
  if (!keyword.trim()) return;

  let page = 1;
  const pageSize = 10;
  let totalR = 0;
  let results = [];
  const totalPages = () => Math.ceil(totalR / pageSize) || 1;

  while (true) {
    clearScreen();
    console.log(`=== 搜索歌曲: "${keyword}" ===`);
    console.log('搜索中...');
    const r = await api('GET', '/search', { keywords: keyword.trim(), page, pagesize: pageSize });
    results = get(r, 'data.lists', []);
    totalR = get(r, 'data.total', results.length);

    if (results.length === 0 && page === 1) {
      log('未找到结果', 'yellow');
      return;
    }

    displayResults(results, page, totalR, pageSize);

    const prompt = page > 1
      ? '\n序号下载 | + 下一页 | - 上一页 | 回车返回: '
      : '\n序号下载 | + 下一页 | 回车返回: ';
    const choice = await ask(prompt);

    if (choice === '') return;
    if (choice === '+' && page < totalPages()) { page++; continue; }
    if (choice === '-' && page > 1) { page--; continue; }
    const idx = parseInt(choice) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < results.length) {
      await downloadSingle(results[idx]);
    }
  }
}

function displayResults(results, page, totalR, pageSize) {
  const totalPages = Math.ceil(totalR / pageSize) || 1;
  console.log(`\n找到 ${totalR} 条结果, 第 ${page}/${totalPages} 页:\n`);
  results.forEach((raw, idx) => {
    const s = raw.songinfo || raw.info || raw.song || raw.data || raw;
    let name = s.OriSongName || s.name || s.title || s.songname || s.SongName || s.songName
      || s.song_name || s.audio_name || s.track_name || '';
    let singer = s.SingerName || s.singer || s.singername || s.singerName
      || s.singer_name || s.author_name || s.authorname || '';
    if (!name && !singer) {
      const fn = s.FileName || s.filename || s.fileName || s.file_name || '';
      const sep = fn.indexOf(' - ');
      if (sep > 0) { singer = fn.substring(0, sep).trim(); name = fn.substring(sep + 3).trim(); }
      else name = fn;
    }
    if (!name) name = '未知';
    // Quality indicator from SQ/HQ availability, not FileSize/ExtName (those are for 128k preview)
    const sq = s.SQ || s.sq;
    const hq = s.HQ || s.hq;
    const bitrate = parseInt(s.Bitrate || s.bitrate || 0);
    const q = (sq && String(sq).length > 10) ? '[FLAC]'
      : (hq && String(hq).length > 10) ? '[HQ]'
      : bitrate >= 320 ? '[320k]'
      : bitrate > 0 ? `[${bitrate}k]`
      : '';
    console.log(`  ${idx + 1}. ${name}${singer ? ' - ' + singer : ''}  ${q}`);
  });
}

async function downloadSingle(song) {
  const s = song.songinfo || song.info || song.song || song.data || song;

  const hash = s.FileHash || s.hash || s.Hash || s.sqhash || s.SQHash
    || s.hqhash || s.HQHash || s.file_hash || '';
  const albumId = s.AlbumID || s.album_id || s.albumid || s.albumId || 0;
  let songName = s.OriSongName || s.name || s.title || s.songname || s.SongName
    || s.songName || s.song_name || s.audio_name || s.track_name || '';
  let singer = s.SingerName || s.singer || s.singername || s.singerName
    || s.singer_name || s.author_name || s.authorname || '';
  if (!songName && !singer) {
    const fn = s.FileName || s.filename || s.fileName || s.file_name || '';
    const sep = fn.indexOf(' - ');
    if (sep > 0) { singer = fn.substring(0, sep).trim(); songName = fn.substring(sep + 3).trim(); }
    else songName = fn;
  }
  if (!songName) songName = '未知';
  const safe = `${singer} - ${songName}`.replace(/[<>:"/\\|?*]/g, '_');
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const fp = path.join(DOWNLOAD_DIR, `${safe}.flac`);
  const mp = path.join(DOWNLOAD_DIR, `${safe}.mp3`);
  if (fs.existsSync(fp)) { log('✓ FLAC 已存在', 'green'); return; }
  if (fs.existsSync(mp)) { log('✓ MP3 已存在', 'green'); return; }

  console.log('下载中...');
  try {
    const r1 = await api('GET', '/song/url', { hash, quality: 'flac', album_id: albumId });
    const u1 = get(r1, 'url', []);
    if (r1.status === 1 && u1.length > 0) {
      await downloadFile(u1[0], fp);
      const sz = (fs.statSync(fp).size / 1024 / 1024).toFixed(1);
      log(`✓ FLAC (${sz} MB)`, 'green');
      return;
    }
    const r2 = await api('GET', '/song/url', { hash, quality: '320', album_id: albumId });
    const u2 = get(r2, 'url', []);
    if (r2.status === 1 && u2.length > 0) {
      await downloadFile(u2[0], mp);
      const sz = (fs.statSync(mp).size / 1024 / 1024).toFixed(1);
      log(`⚠ MP3 320k (${sz} MB)`, 'yellow');
      return;
    }
    log('✗ 无可用下载链接', 'red');
  } catch (e) {
    log('✗ ' + e.message, 'red');
  }
}

// ─── main menu ───────────────────────────────────────────

async function mainMenu() {
  while (true) {
    const loggedIn = !!cookieJar['token'];
    clearScreen();
    console.log('='.repeat(40));
    console.log('  酷狗音乐下载器');
    console.log('  ' + (loggedIn ? '状态: 已登录' : '状态: 未登录'));
    console.log('='.repeat(40));

    if (loggedIn) {
      console.log('  1. 下载歌单');
      console.log('  2. 搜索歌曲');
      console.log('  3. 退出登录');
      console.log('  4. 退出程序');
    } else {
      console.log('  1. 登录');
      console.log('  2. 退出程序');
    }

    const choice = await ask('请选择: ');

    if (loggedIn) {
      if (choice === '1') await downloadPlaylist();
      else if (choice === '2') await doSearch();
      else if (choice === '3') { clearSession(); log('已退出登录', 'cyan'); }
      else if (choice === '4') break;
    } else {
      if (choice === '1') await doLogin();
      else if (choice === '2') break;
    }
  }
}

// ─── bootstrap ───────────────────────────────────────────

async function bootstrap() {
  console.log('正在连接 API 服务...');
  let apiOk = false;
  let lastErr = '';
  for (let attempt = 0; attempt < 15; attempt++) {
    const r = await api('GET', '/');
    if (typeof r === 'string' || (r && r.status !== 0)) { apiOk = true; break; }
    lastErr = (r && r.error) || '';
    if (attempt < 3) console.log(`  等待中... (${attempt + 1}/15)`);
    await sleep(2000);
  }
  if (!apiOk) {
    if (lastErr) log('连接失败: ' + lastErr, 'red');
    log('API 服务未启动, 请先运行 run.bat', 'red');
    process.exit(1);
  }

  const dev = await api('POST', '/register/dev');
  if (get(dev, 'status') !== 1) { log('设备注册失败', 'red'); process.exit(1); }

  if (loadSession()) {
    const ok = await verifySession();
    if (!ok) clearSession();
  }

  await mainMenu();
  rl.close();
  process.exit(0);
}

bootstrap().catch(e => {
  console.error('启动失败:', e.message || e);
  process.exit(1);
});
