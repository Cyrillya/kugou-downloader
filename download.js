import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createElement as h, Fragment } from 'react';
import htm from 'htm';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';

import {
  healthCheck, registerDevice, loadSession, clearSession,
  verifySession, sendCaptcha, loginWithCode,
  loginWithPassword,
  loginQrKey, loginQrCreate, loginQrCheck, finalizeLogin,
  resolvePlaylistId, fetchPlaylistTracks, searchSongs,
  getSongUrl, downloadFile, extractSongInfo, findExistingFile,
  sleep, DOWNLOAD_DIR, get,
} from './lib/api.js';

const html = htm.bind(h);

// ─── Constants ────────────────────────────────────────────

const C = {
  brand: '#1DB954',
  accent: '#00D4FF',
  dim: '#666',
  green: '#00FF88',
  yellow: '#FFD700',
  red: '#FF4444',
  white: '#FFFFFF',
};

// ─── Helpers ──────────────────────────────────────────────

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '? MB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ─── StatusBar ────────────────────────────────────────────

function StatusBar({ loggedIn, screen }) {
  const labels = { loading: '连接中...', login: '登录', menu: '主菜单', playlist: '下载歌单', search: '搜索歌曲' };
  return html`
    <${Box} width="100%" paddingLeft=${1} paddingRight=${1}>
      <${Text} color=${C.brand} bold>酷狗音乐下载器<//>
      <${Text} dimColor> · ${labels[screen] || screen}<//>
      <${Box} flexGrow=${1} />
      <${Text} color=${loggedIn ? C.green : C.dim}>
        ${loggedIn ? '● 已登录' : '○ 未登录'}
      <//>
    <//>
  `;
}

// ─── Divider ──────────────────────────────────────────────

function Divider() {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout.columns || 80);
  useEffect(() => {
    const onResize = () => setCols(stdout.columns || 80);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);
  return html`<${Text} dimColor>${'─'.repeat(cols)}<//>`;
}

// ─── LoadingScreen ────────────────────────────────────────

function LoadingScreen({ msg }) {
  return html`
    <${Box} flexDirection="column" padding=${1}>
      <${Box}>
        <${Text} color=${C.accent}><${Spinner} type="dots" /> ${msg || '正在连接 API 服务...'}<//>
      <//>
    <//>
  `;
}

// ─── LoginScreen ──────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('choose');
  const [selected, setSelected] = useState(0);
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [qrPhase, setQrPhase] = useState('idle');
  const [qrText, setQrText] = useState('');
  const [qrHint, setQrHint] = useState('');
  const phoneReqRef = useRef(0);
  const pwdReqRef = useRef(0);
  const qrReqRef = useRef(0);

  const resetPhoneFlow = useCallback(() => {
    phoneReqRef.current += 1;
    setMode('choose');
    setSelected(0);
    setStep('phone');
    setPhone('');
    setCode('');
    setMsg('');
  }, []);

  const resetPasswordFlow = useCallback(() => {
    pwdReqRef.current += 1;
    setMode('choose');
    setSelected(0);
    setStep('phone');
    setUsername('');
    setPassword('');
    setMsg('');
  }, []);

  const resetQrFlow = useCallback(() => {
    qrReqRef.current += 1;
    setQrPhase('idle');
    setQrText('');
    setQrHint('');
  }, []);

  const enterPhoneLogin = useCallback(() => {
    resetQrFlow();
    resetPasswordFlow();
    setError('');
    setMsg('');
    setStep('phone');
    setMode('phone');
  }, [resetQrFlow, resetPasswordFlow]);

  const enterPasswordLogin = useCallback(() => {
    phoneReqRef.current += 1;
    qrReqRef.current += 1;
    setError('');
    setMsg('');
    setPhone('');
    setCode('');
    setStep('username');
    setMode('password');
  }, []);

  const enterQrLogin = useCallback(() => {
    phoneReqRef.current += 1;
    pwdReqRef.current += 1;
    setError('');
    setMsg('');
    setCode('');
    setStep('phone');
    setMode('qr');
  }, []);

  const sendCode = useCallback(async () => {
    const p = phone.trim();
    if (!p || p.length !== 11) { setError('请输入有效的11位手机号'); return; }
    setError('');
    setMsg('正在发送验证码...');
    const reqId = ++phoneReqRef.current;
    const r = await sendCaptcha(p);
    if (reqId !== phoneReqRef.current || mode !== 'phone') return;
    if (get(r, 'status') === 1) {
      setMsg('验证码已发送，请查收短信');
      setStep('captcha');
    } else {
      setError('验证码发送失败: ' + (r.message || r.msg || get(r, 'data') || ''));
    }
  }, [phone, mode]);

  const doLogin = useCallback(async () => {
    const c = code.trim();
    if (!c) return;
    setError('');
    setMsg('正在登录...');
    setStep('logging');
    const reqId = ++phoneReqRef.current;
    try {
      await loginWithCode(phone.trim(), c);
      if (reqId !== phoneReqRef.current || mode !== 'phone') return;
      onLogin();
    } catch (e) {
      if (reqId !== phoneReqRef.current || mode !== 'phone') return;
      setError(e.message);
      setStep('captcha');
    }
  }, [phone, code, mode, onLogin]);

  const doPasswordLogin = useCallback(async () => {
    const u = username.trim();
    const p = password;
    if (!u || !p) return;
    setError('');
    setMsg('正在登录...');
    setStep('logging');
    const reqId = ++pwdReqRef.current;
    try {
      await loginWithPassword(u, p);
      if (reqId !== pwdReqRef.current || mode !== 'password') return;
      onLogin();
    } catch (e) {
      if (reqId !== pwdReqRef.current || mode !== 'password') return;
      setError(e.message);
      setStep('password');
    }
  }, [username, password, mode, onLogin]);

  useEffect(() => {
    if (mode !== 'qr') return undefined;

    let cancelled = false;
    const reqId = ++qrReqRef.current;

    (async () => {
      try {
        setQrPhase('loading');
        setQrHint('正在获取二维码...');
        const { key } = await loginQrKey();
        if (cancelled || reqId !== qrReqRef.current) return;

        const created = await loginQrCreate(key);
        if (cancelled || reqId !== qrReqRef.current) return;

        let qr = created.qrText;
        try {
          qr = await qrcode.toString(created.qrText, { type: 'terminal', small: true });
        } catch (_e) {
          qr = created.qrText;
        }
        if (cancelled || reqId !== qrReqRef.current) return;

        setQrText(qr);
        setQrPhase('scan');
        setQrHint('请使用手机扫码');

        while (!cancelled && reqId === qrReqRef.current) {
          const r = await loginQrCheck(key);
          if (cancelled || reqId !== qrReqRef.current) return;

          const status =
            get(r, 'data.status') ??
            get(r, 'body.data.status') ??
            get(r, 'body.status') ??
            get(r, 'status');
          if (status === 1 || status === '1') {
            setQrPhase('scan');
            setQrHint('请使用手机扫码');
          } else if (status === 2 || status === '2') {
            setQrPhase('confirm');
            setQrHint('已扫码，请在手机上确认登录');
          } else if (status === 4 || status === '4') {
            setQrHint('登录成功，正在进入主界面...');
            await finalizeLogin();
            if (!cancelled && reqId === qrReqRef.current) onLogin();
            return;
          } else if (status === 0 || status === '0') {
            setError('二维码已过期，请重新选择二维码登录');
            resetQrFlow();
            setMode('choose');
            return;
          } else {
            setError('二维码登录失败，请重试');
            resetQrFlow();
            setMode('choose');
            return;
          }

          await sleep(1500);
        }
      } catch (e) {
        if (cancelled || reqId !== qrReqRef.current) return;
        setError('二维码登录失败: ' + e.message);
        resetQrFlow();
        setMode('choose');
      }
    })();

    return () => { cancelled = true; };
  }, [mode, onLogin, resetQrFlow]);

  useInput((_input, key) => {
    if (mode === 'choose') {
      if (key.upArrow || key.downArrow) {
        setSelected((s) => (s + (key.upArrow ? -1 : 1) + 3) % 3);
      }
      if (key.return) {
        if (selected === 0) enterPhoneLogin();
        if (selected === 1) enterQrLogin();
        if (selected === 2) enterPasswordLogin();
      }
      return;
    }

    if (mode === 'phone' && step === 'phone' && key.return) sendCode();

    if (mode === 'phone' && step === 'phone' && key.escape) {
      resetPhoneFlow();
      setError('');
      setMsg('');
      return;
    }

    if (mode === 'phone' && (step === 'captcha' || step === 'logging') && key.escape) {
      phoneReqRef.current += 1;
      setStep('phone');
      setError('');
      setMsg('');
      setCode('');
    }

    if (mode === 'password' && step === 'username' && key.return && username.trim()) {
      setStep('password');
      return;
    }

    if (mode === 'password' && step === 'username' && key.return && !username.trim()) {
      setError('请输入用户名');
      return;
    }

    if (mode === 'password' && step === 'password' && key.return) {
      doPasswordLogin();
      return;
    }

    if (mode === 'password' && key.escape) {
      if (step === 'password') {
        setStep('username');
        setPassword('');
        setError('');
        setMsg('');
      } else {
        resetPasswordFlow();
        setError('');
      }
      return;
    }

    if (mode === 'qr' && key.escape) {
      resetQrFlow();
      setError('');
      setMode('choose');
      setSelected(0);
    }
  });

  return html`
    <${Box} flexDirection="column" padding=${1}>
      <${Text} bold color=${C.accent}>=== 登录 ===<//>
      <${Box} height=${1} />

      ${mode === 'choose' && html`
        <${Box} flexDirection="column">
          <${Text}>请选择登录方式:<//>
          <${Box} height=${1} />
        ${['手机号登录', '二维码登录', '账号密码登录'].map((label, idx) => html`
            <${Box} key=${label}>
              <${Text} color=${idx === selected ? C.brand : undefined}>
                ${idx === selected ? '▸ ' : '  '}${label}
              <//>
            <//>
          `)}
          <${Box} height=${1} />
          <${Text} dimColor>↑↓ 选择  Enter 确认<//>
          ${error ? html`<${Box}><${Text} color=${C.red}>✗ ${error}<//><//>` : null}
        <//>
      `}

      ${mode === 'phone' && step === 'phone' && html`
        <${Box} flexDirection="column">
          <${Text}>请输入手机号:<//>
          <${Box}>
            <${Text} color=${C.accent}>▸ <//>
            <${TextInput} value=${phone} onChange=${setPhone} placeholder="手机号" />
          <//>
          <${Box} height=${1} />
          <${Text} dimColor>Enter 发送验证码  Esc 返回选择<//>
        <//>
      `}

      ${mode === 'password' && step === 'username' && html`
        <${Box} flexDirection="column">
          <${Text}>请输入账号/用户名:<//>
          <${Box}>
            <${Text} color=${C.accent}>▸ <//>
            <${TextInput} value=${username} onChange=${setUsername} placeholder="用户名" />
          <//>
          <${Box} height=${1} />
          <${Text} dimColor>Enter 继续  Esc 返回选择<//>
        <//>
      `}

      ${mode === 'password' && step === 'password' && html`
        <${Box} flexDirection="column">
          <${Text}>账号: <${Text} color=${C.accent}>${username}<//><//>
          <${Box} height=${1} />
          <${Text}>请输入密码:<//>
          <${Box}>
            <${Text} color=${C.accent}>▸ <//>
            <${TextInput} value=${password} onChange=${setPassword} placeholder="密码" />
          <//>
          <${Box} height=${1} />
          <${Text} dimColor>Enter 登录  Esc 返回修改账号<//>
        <//>
      `}

      ${mode === 'password' && step === 'logging' && html`
        <${Box}>
          <${Text} color=${C.accent}><${Spinner} type="dots" /> 登录中，请稍候...<//>
        <//>
      `}

      ${mode === 'phone' && step === 'captcha' && html`
        <${Box} flexDirection="column">
          <${Text}>手机号: <${Text} color=${C.accent}>${phone}<//><//>
          ${msg ? html`<${Text} color=${C.green}>${msg}<//>` : null}
          <${Box} height=${1} />
          <${Text}>请输入验证码:<//>
          <${Box}>
            <${Text} color=${C.accent}>▸ <//>
            <${TextInput} value=${code} onChange=${setCode} placeholder="验证码" onSubmit=${doLogin} />
          <//>
          <${Box} height=${1} />
          <${Text} dimColor>Enter 提交  Esc 返回修改手机号<//>
        <//>
      `}

      ${mode === 'phone' && step === 'logging' && html`
        <${Box}>
          <${Text} color=${C.accent}><${Spinner} type="dots" /> 登录中，请稍候...<//>
        <//>
      `}

      ${mode === 'qr' && html`
        <${Box} flexDirection="column">
          <${Text}>二维码登录<//>
          <${Box} height=${1} />
          ${qrPhase === 'loading' && html`
            <${Box}><${Text} color=${C.accent}><${Spinner} type="dots" /> ${qrHint || '正在生成二维码...'}<//><//>
          `}
          ${qrPhase === 'scan' && html`
            <${Box} flexDirection="column">
              <${Text} dimColor>${qrHint}<//>
              <${Box} height=${1} />
              <${Text}>${qrText}<//>
            <//>
          `}
          ${qrPhase === 'confirm' && html`
            <${Text} color=${C.yellow}>${qrHint}<//>
          `}
          <${Box} height=${1} />
          <${Text} dimColor>Esc 返回选择<//>
        <//>
      `}

      ${error ? html`<${Box}><${Text} color=${C.red}>✗ ${error}<//><//>` : null}
    <//>
  `;
}

// ─── MainMenu ─────────────────────────────────────────────

function MainMenu({ onNavigate, onLogout }) {
  const [selected, setSelected] = useState(0);
  const items = ['下载歌单', '搜索歌曲', '退出登录', '退出程序'];

  useInput((_input, key) => {
    if (key.upArrow) setSelected((s) => (s - 1 + items.length) % items.length);
    if (key.downArrow) setSelected((s) => (s + 1) % items.length);
    if (key.return) {
      if (selected === 0) onNavigate('playlist');
      if (selected === 1) onNavigate('search');
      if (selected === 2) onLogout();
      if (selected === 3) process.exit(0);
    }
  });

  return html`
    <${Box} flexDirection="column" padding=${1}>
      <${Text} bold color=${C.accent}>=== 主菜单 ===<//>
      <${Box} height=${1} />
      ${items.map((label, idx) => html`
        <${Box} key=${idx}>
          <${Text} color=${idx === selected ? C.brand : undefined}>
            ${idx === selected ? '▸ ' : '  '}${label}
          <//>
        <//>
      `)}
      <${Box} height=${1} />
      <${Text} dimColor>↑↓ 导航  Enter 确认<//>
    <//>
  `;
}

// ─── ProgressBar ──────────────────────────────────────────

function ProgressBar({ value, max }) {
  const width = 40;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.round(width * pct);
  const empty = width - filled;
  return html`
    <${Box}>
      <${Text} color=${C.brand}>${'█'.repeat(filled)}${'░'.repeat(empty)}<//>
      <${Text}> ${(pct * 100).toFixed(0)}%<//>
    <//>
  `;
}

// ─── PlaylistDownloadScreen ───────────────────────────────

function PlaylistDownloadScreen({ onBack }) {
  const [phase, setPhase] = useState('input');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [results, setResults] = useState({ flac: 0, fallback: 0, fail: 0, total: 0 });
  const [currentFile, setCurrentFile] = useState('');
  const abortRef = useRef(false);

  const startDownload = useCallback(async () => {
    if (!url.trim()) return;
    setError('');
    setPhase('resolving');
    setStatus('解析歌单链接...');

    let pid;
    try {
      pid = await resolvePlaylistId(url.trim());
    } catch (e) {
      setError('链接解析失败: ' + e.message);
      setPhase('input');
      return;
    }
    if (!pid) { setError('无法提取歌单ID，请检查链接格式'); setPhase('input'); return; }

    setPhase('fetching');
    setStatus(`获取歌曲列表 (ID: ${pid})...`);
    let allTracks;
    try {
      allTracks = await fetchPlaylistTracks(pid, (_page, count, total) => {
        setStatus(`获取歌曲列表: ${count}/${total} 首`);
      });
    } catch (e) {
      setError('获取歌单失败: ' + e.message);
      setPhase('input');
      return;
    }
    setPhase('downloading');
    setResults({ flac: 0, fallback: 0, fail: 0, total: allTracks.length });

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    for (let i = 0; i < allTracks.length; i++) {
      if (abortRef.current) break;
      setCurrentIdx(i);
      const track = allTracks[i];
      const name = track.name || '';
      const sep = name.indexOf(' - ');
      const singer = sep > 0 ? name.substring(0, sep).trim() : name;
      const song = sep > 0 ? name.substring(sep + 3).trim() : name;
      const safe = `${singer} - ${song}`.replace(/[<>:"/\\|?*]/g, '_');
      const hash = track.hash;
      const albumId = track.album_id || 0;
      setCurrentFile(`${singer} - ${song}`);

      const ex = findExistingFile(`${singer} - ${song}`, DOWNLOAD_DIR);
      if (ex) {
        const ext = path.extname(ex).toLowerCase();
        if (ext === '.flac') setResults((r) => ({ ...r, flac: r.flac + 1 }));
        else setResults((r) => ({ ...r, fallback: r.fallback + 1 }));
        await sleep(100);
        continue;
      }

      let ok = false;
      const r1 = await getSongUrl(hash, albumId, 'flac');
      const u1 = get(r1, 'url', []);
      if (r1.status === 1 && u1.length > 0) {
        try {
          await downloadFile(u1[0], path.join(DOWNLOAD_DIR, `${safe}.flac`));
          setResults((r) => ({ ...r, flac: r.flac + 1 }));
          ok = true;
        } catch (_e) { /* fallback */ }
      }

      if (!ok) {
        const r2 = await getSongUrl(hash, albumId, '320');
        const u2 = get(r2, 'url', []);
        if (r2.status === 1 && u2.length > 0) {
          try {
            await downloadFile(u2[0], path.join(DOWNLOAD_DIR, `${safe}.mp3`));
            setResults((r) => ({ ...r, fallback: r.fallback + 1 }));
          } catch (_e) {
            setResults((r) => ({ ...r, fail: r.fail + 1 }));
          }
        } else {
          setResults((r) => ({ ...r, fail: r.fail + 1 }));
        }
      }
      await sleep(300);
    }
    setPhase('done');
  }, [url]);

  useInput((_input, key) => {
    if (key.escape && (phase === 'input' || phase === 'done')) {
      abortRef.current = true;
      onBack();
    }
  });

  const r = results;
  const done = r.flac + r.fallback + r.fail;

  return html`
    <${Box} flexDirection="column" padding=${1}>
      <${Text} bold color=${C.accent}>=== 下载歌单 ===<//>
      <${Box} height=${1} />

      ${phase === 'input' && html`
        <${Box} flexDirection="column">
          <${Text}>请输入歌单链接或短链接:<//>
          <${Box}>
            <${Text} color=${C.accent}>▸ <//>
            <${TextInput} value=${url} onChange=${setUrl} placeholder="https://..." onSubmit=${startDownload} />
          <//>
          ${error ? html`<${Text} color=${C.red}>✗ ${error}<//>` : null}
          <${Box} height=${1} />
          <${Text} dimColor>Enter 开始下载  Esc 返回<//>
        <//>
      `}

      ${(phase === 'resolving' || phase === 'fetching') && html`
        <${Box}>
          <${Text} color=${C.accent}><${Spinner} type="dots" /> ${status}<//>
        <//>
      `}

      ${phase === 'downloading' && html`
        <${Box} flexDirection="column">
          <${Box}>
            <${Text} color=${C.accent}><${Spinner} type="dots" /> 下载中<//>
            <${Text}> [${currentIdx + 1}/${r.total}]<//>
          <//>
          <${Text} dimColor>${currentFile}<//>
          <${Box} height=${1} />
          <${ProgressBar} value=${done} max=${r.total} />
          <${Box}>
            <${Text} color=${C.green}>FLAC: ${r.flac}<//>
            <${Text}>  <//>
            <${Text} color=${C.yellow}>降级: ${r.fallback}<//>
            <${Text}>  <//>
            <${Text} color=${C.red}>失败: ${r.fail}<//>
          <//>
        <//>
      `}

      ${phase === 'done' && html`
        <${Box} flexDirection="column">
          <${Text} color=${C.green} bold>✓ 下载完成!<//>
          <${Box} height=${1} />
          <${Text}>总计: ${r.total} 首<//>
          <${Text} color=${C.green}>  FLAC: ${r.flac}<//>
          <${Text} color=${C.yellow}>  降级为 MP3: ${r.fallback}<//>
          ${r.fail > 0 && html`<${Text} color=${C.red}>  失败: ${r.fail}<//>`}
          <${Box} height=${1} />
          <${Text} dimColor>按 Esc 返回<//>
        <//>
      `}
    <//>
  `;
}

// ─── SearchScreen ─────────────────────────────────────────

function SearchScreen({ onBack }) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState('input'); // input | searching | results | downloading
  const [downloading, setDownloading] = useState(null);
  const [dlResult, setDlResult] = useState('');

  const doSearch = useCallback(async (kw, pg) => {
    setPhase('searching');
    setDlResult('');
    try {
      const { lists, total: t } = await searchSongs(kw, pg, pageSize);
      setResults(lists);
      setTotal(t);
      setSelected(0);
      setPhase('results');
    } catch (_e) {
      setPhase('input');
    }
  }, [pageSize]);

  const totalPages = Math.ceil(total / pageSize) || 1;

  const downloadOne = useCallback(async (songRaw) => {
    const info = extractSongInfo(songRaw);
    if (!info.hash) { setDlResult('✗ 无可用哈希'); return; }
    setPhase('downloading');
    setDownloading(`${info.singer} - ${info.name}`);
    setDlResult('');

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    const safe = `${info.singer} - ${info.name}`.replace(/[<>:"/\\|?*]/g, '_');
    const fp = path.join(DOWNLOAD_DIR, `${safe}.flac`);
    const mp = path.join(DOWNLOAD_DIR, `${safe}.mp3`);

    if (fs.existsSync(fp)) { setDlResult('✓ FLAC 已存在'); setPhase('results'); return; }
    if (fs.existsSync(mp)) { setDlResult('✓ MP3 已存在'); setPhase('results'); return; }

    try {
      const r1 = await getSongUrl(info.hash, info.albumId, 'flac');
      const u1 = get(r1, 'url', []);
      if (r1.status === 1 && u1.length > 0) {
        await downloadFile(u1[0], fp);
        setDlResult(`✓ FLAC (${formatSize(fs.statSync(fp).size)})`);
        setPhase('results');
        return;
      }
      const r2 = await getSongUrl(info.hash, info.albumId, '320');
      const u2 = get(r2, 'url', []);
      if (r2.status === 1 && u2.length > 0) {
        await downloadFile(u2[0], mp);
        setDlResult(`⚠ MP3 320k (${formatSize(fs.statSync(mp).size)})`);
        setPhase('results');
        return;
      }
      setDlResult('✗ 无可用下载链接');
    } catch (e) {
      setDlResult('✗ ' + e.message);
    }
    setPhase('results');
  }, []);

  // Keyboard: only active when TextInput is NOT rendered
  useInput((input, key) => {
    // Input phase: Enter triggers search (TextInput handles actual typing)
    if (phase === 'input' && key.return && keyword.trim()) {
      setPage(1);
      doSearch(keyword, 1);
      return;
    }
    if (phase === 'input' && key.escape) {
      onBack();
      return;
    }

    // Results phase: list navigation (TextInput is hidden)
    if (phase === 'results') {
      if (key.upArrow) {
        setSelected((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setSelected((s) => Math.min(results.length - 1, s + 1));
        return;
      }
      if (key.return && results[selected]) {
        downloadOne(results[selected]);
        return;
      }
      if (key.leftArrow && page > 1) {
        setPage((p) => p - 1);
        doSearch(keyword, page - 1);
        return;
      }
      if (key.rightArrow && page < totalPages) {
        setPage((p) => p + 1);
        doSearch(keyword, page + 1);
        return;
      }
      if (key.escape) {
        // Go back to input mode, keep keyword for editing
        setPhase('input');
        setResults([]);
        setTotal(0);
        return;
      }
    }
  });

  return html`
    <${Box} flexDirection="column" padding=${1}>
      <${Text} bold color=${C.accent}>=== 搜索歌曲 ===<//>
      <${Box} height=${1} />

      ${/* Input mode: show TextInput */''}
      ${(phase === 'input' || phase === 'searching') && html`
        <${Box}>
          <${Text} color=${C.accent}>▸ <//>
          <${TextInput} value=${keyword} onChange=${setKeyword} placeholder="输入歌名..."
            onSubmit=${() => { if (keyword.trim()) { setPage(1); doSearch(keyword, 1); } }} />
        <//>
      `}

      ${/* Results mode: show keyword as read-only, no TextInput */''}
      ${phase === 'results' && html`
        <${Box}>
          <${Text} dimColor>搜索: "${keyword}"  </${Text}>
          <${Text} color=${C.accent}>(Esc 修改)<//>
        <//>
      `}

      <${Box} height=${1} />

      ${phase === 'searching' && html`
        <${Box}><${Text} color=${C.accent}><${Spinner} type="dots" /> 搜索中...<//><//>
      `}

      ${phase === 'results' && results.length > 0 && html`
        <${Box} flexDirection="column">
          <${Text} dimColor>共 ${total} 条结果，第 ${page}/${totalPages} 页<//>
          ${page > 1 && page < totalPages ? html`<${Text} dimColor>  (← 上一页  → 下一页)<//>` : null}
          ${page === 1 ? html`<${Text} dimColor>  (→ 下一页)<//>` : null}
          ${page === totalPages ? html`<${Text} dimColor>  (← 上一页)<//>` : null}
          <${Box} height=${1} />
          ${results.map((raw, idx) => {
            const info = extractSongInfo(raw);
            const q = info.quality ? `[${info.quality}]` : '';
            return html`
              <${Box} key=${idx}>
                <${Text} color=${idx === selected ? C.brand : undefined}>
                  ${idx === selected ? '▸ ' : '  '}
                  ${idx + 1}. ${info.name}${info.singer ? ' - ' + info.singer : ''}  ${q}
                <//>
              <//>
            `;
          })}
          <${Box} height=${1} />
          <${Text} dimColor>↑↓ 选择  Enter 下载  →← 翻页  Esc 修改搜索词<//>
          ${dlResult ? html`
            <${Text} color=${dlResult.startsWith('✓') ? C.green : C.red}>${dlResult}<//>
          ` : null}
        <//>
      `}

      ${phase === 'results' && results.length === 0 && html`
        <${Text} color=${C.yellow}>未找到结果，按 Esc 返回<//>
      `}

      ${phase === 'downloading' && html`
        <${Box} flexDirection="column">
          <${Text}><${Spinner} type="dots" /> 下载中: ${downloading}<//>
        <//>
      `}

      ${phase === 'input' && html`
        <${Box} flexDirection="column">
          <${Box} height=${1} />
          <${Text} dimColor>Enter 搜索  Esc 返回菜单<//>
        <//>
      `}
    <//>
  `;
}

// ─── App ──────────────────────────────────────────────────

function App() {
  const [screen, setScreen] = useState('loading');
  const [loggedIn, setLoggedIn] = useState(false);
  const [loadMsg, setLoadMsg] = useState('正在连接 API 服务...');
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  // Clear screen on resize to prevent old content ghosting
  useEffect(() => {
    const onResize = () => { stdout.write('\x1b[2J\x1b[H'); };
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  useEffect(() => {
    (async () => {
      let apiOk = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        const r = await healthCheck();
        if (typeof r === 'string' || (r && r.status !== 0)) { apiOk = true; break; }
        setLoadMsg(`等待 API 启动... (${attempt + 1}/15)`);
        await sleep(2000);
      }
      if (!apiOk) {
        setLoadMsg('API 服务未启动 — 请先运行 run.bat');
        return;
      }

      const dev = await registerDevice();
      if (get(dev, 'status') !== 1) {
        setLoadMsg('设备注册失败');
        return;
      }

      let isLoggedIn = false;
      if (loadSession()) {
        const ok = await verifySession();
        if (ok) {
          isLoggedIn = true;
          setLoggedIn(true);
        } else {
          clearSession();
        }
      }

      setScreen(isLoggedIn ? 'menu' : 'login');
    })();
  }, []);

  const handleLogin = useCallback(() => {
    setLoggedIn(true);
    setScreen('menu');
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    setLoggedIn(false);
    setScreen('login');
  }, []);

  const handleNavigate = useCallback((s) => setScreen(s), []);
  const handleBack = useCallback(() => setScreen('menu'), []);

  return html`
    <${Box} flexDirection="column" minHeight=${rows}>
      <${StatusBar} loggedIn=${loggedIn} screen=${screen} />
      <${Divider} />

      ${screen === 'loading' && html`<${LoadingScreen} msg=${loadMsg} />`}
      ${screen === 'login' && html`<${LoginScreen} onLogin=${handleLogin} />`}
      ${screen === 'menu' && html`
        <${MainMenu} onNavigate=${handleNavigate} onLogout=${handleLogout} />
      `}
      ${screen === 'playlist' && html`<${PlaylistDownloadScreen} onBack=${handleBack} />`}
      ${screen === 'search' && html`<${SearchScreen} onBack=${handleBack} />`}

      <${Divider} />
      <${Box} paddingLeft=${1}>
        <${Text} dimColor>Esc 返回/退出 | Ctrl+C 强制退出<//>
      <//>
    <//>
  `;
}

// ─── Entry ────────────────────────────────────────────────

async function bootstrap() {
    if (typeof require !== 'undefined') {
      try {
        const { spawn } = require('child_process');
        const { resolve } = require('path');
        const http = require('http');

        // Try api.exe alongside download.exe
        const apiExe = resolve(__dirname, 'api.exe');

        await new Promise((res, rej) => {
          const child = spawn(apiExe, [], {
            stdio: ['ignore', process.stderr, process.stderr],
            env: { ...process.env, PORT: '3000', platform: 'lite' },
          });
          child.on('error', () => {
            // api.exe not found — API should already be running externally
            res();
          });
          child.on('exit', (c) => { if (c !== 0 && c !== null) console.error('[API] exit', c); });
          let n = 0;
          (function check() {
            n++;
            http.get('http://localhost:3000/', (r) => {
              if (r.statusCode === 200) {
                process.on('exit', () => child.kill());
                process.on('SIGINT', () => { child.kill(); process.exit(); });
                process.on('SIGTERM', () => { child.kill(); process.exit(); });
                res();
              } else if (n < 30) setTimeout(check, 500);
              else rej(new Error('API start failed'));
            }).on('error', () => {
              if (n < 30) setTimeout(check, 500);
              else rej(new Error('API timeout'));
            }).end();
          })();
        });
      } catch (e) {
        // Not in SEA — API should already be running
      }
    }
    const { waitUntilExit } = render(h(App, null), { exitOnCtrlC: true });
  }

  bootstrap();
