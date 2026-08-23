/* ============================================================
   Simple Mail Client
   ------------------------------------------------------------
   Static page (index.html + styles.css + script.js), hostable
   directly on GitHub Pages. Three account modes:

   1. GMAIL OAUTH (real, live mail) - connect via "Connect with
      Google" in the Accounts panel. Uses OAuth 2.0 Authorization
      Code + PKCE, then calls the Gmail REST API
      (gmail.googleapis.com) directly from this page with
      fetch(). No backend involved; your Google password is
      entered on accounts.google.com, never seen by this app.

   2. BACKEND MODE - for other providers, if you run your own
      IMAP/SMTP proxy and set its URL on the account, this page
      will call:
        GET  {backend}/messages?folder=inbox
        POST {backend}/action   { id, action }
        POST {backend}/send     { to, subject, body }

   3. DEMO MODE - default for non-Gmail accounts with no backend
      set. A sample inbox is generated and stored locally so the
      UI can be tried end-to-end offline.

   Raw IMAP/SMTP cannot be spoken from browser JS at all (no TCP
   socket API, and mail servers don't send CORS headers), which
   is why mode 1/2 exist instead.
   ============================================================ */

const PROVIDER_PRESETS = {
  gmail:   { imapHost: "imap.gmail.com",        imapPort: 993, smtpHost: "smtp.gmail.com",         smtpPort: 465 },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com",      smtpPort: 587 },
  yahoo:   { imapHost: "imap.mail.yahoo.com",   imapPort: 993, smtpHost: "smtp.mail.yahoo.com",     smtpPort: 465 },
  icloud:  { imapHost: "imap.mail.me.com",      imapPort: 993, smtpHost: "smtp.mail.me.com",        smtpPort: 587 },
  custom:  { imapHost: "", imapPort: "", smtpHost: "", smtpPort: "" }
};

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email"
].join(" ");

const GMAIL_FOLDER_LABEL = {
  inbox: "INBOX",
  starred: "STARRED",
  sent: "SENT",
  spam: "SPAM",
  trash: "TRASH"
};

const FOLDERS = ["inbox", "starred", "sent", "drafts", "all", "spam", "trash"];

let accounts = [];
let currentAccountId = null;
let currentFolder = "inbox";
let mail = [];              // currently displayed folder's messages
let selectedIds = new Set();
let searchTerm = "";

/* ---------------- storage helpers ---------------- */

function loadAccounts() {
  try {
    accounts = JSON.parse(localStorage.getItem("mailAccounts") || "[]");
  } catch (e) {
    accounts = [];
  }
  currentAccountId = localStorage.getItem("mailCurrentAccountId") || null;
}

function saveAccounts() {
  localStorage.setItem("mailAccounts", JSON.stringify(accounts));
  if (currentAccountId) localStorage.setItem("mailCurrentAccountId", currentAccountId);
}

function mailStorageKey(accId) {
  return "mailData_" + accId;
}

function loadMailForAccount(acc) {
  const raw = localStorage.getItem(mailStorageKey(acc.id));
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  const demo = generateDemoMail(acc);
  localStorage.setItem(mailStorageKey(acc.id), JSON.stringify(demo));
  return demo;
}

function saveMailForAccount(accId, data) {
  localStorage.setItem(mailStorageKey(accId), JSON.stringify(data));
}

/* ---------------- demo data (non-Gmail accounts) ---------------- */

function generateDemoMail(acc) {
  const samples = [
    { from: "Team Updates", subject: "Weekly digest is ready", body: "Here is your weekly summary of activity across your projects. Nothing urgent, just a recap.", folder: "inbox", unread: true },
    { from: "Billing", subject: "Your receipt for last month", body: "Thanks for your payment. Your receipt is attached to this message for your records.", folder: "inbox", unread: true },
    { from: "Newsletter", subject: "5 things worth reading this week", body: "A short roundup of articles our editors picked out for you this week.", folder: "inbox", unread: false },
    { from: "Support", subject: "Re: question about your account", body: "Thanks for reaching out. We looked into this and everything on our end looks normal.", folder: "inbox", unread: false },
    { from: "A Friend", subject: "Lunch next week?", body: "Are you free Tuesday or Wednesday for lunch? Would be great to catch up.", folder: "inbox", unread: true },
    { from: "Notifications", subject: "New comment on your post", body: "Someone replied to a post you follow. Click through to see the discussion.", folder: "inbox", unread: false },
    { from: "Travel Alerts", subject: "Check-in now open for your flight", body: "Online check-in is now open. Save time at the airport by checking in early.", folder: "inbox", unread: false },
    { from: "You", subject: "Draft: notes for the meeting", body: "Agenda items to cover: budget, timeline, next steps.", folder: "drafts", unread: false },
    { from: "You", subject: "Sent: thanks for your help", body: "Really appreciate you taking the time to walk me through that.", folder: "sent", unread: false },
    { from: "Promotions", subject: "Sale ends tonight", body: "Last chance to save before this offer expires at midnight.", folder: "spam", unread: true }
  ];

  const now = Date.now();
  return samples.map((s, i) => ({
    id: "m" + i + "_" + acc.id,
    from: s.from,
    to: acc.email,
    subject: s.subject,
    snippet: s.body.slice(0, 80),
    body: s.body,
    date: new Date(now - i * 3 * 60 * 60 * 1000).toISOString(),
    folder: s.folder,
    unread: s.unread,
    starred: false
  }));
}

/* ================================================================
   GMAIL OAUTH + API
   ================================================================ */

function randomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => ("0" + b.toString(16)).slice(-2)).join("").slice(0, len);
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let str = "";
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function gmailRedirectUri() {
  return window.location.origin + window.location.pathname;
}

async function startGmailOAuth(clientId, clientSecret) {
  if (!clientId) { alert("Please enter your Google OAuth Client ID first."); return; }
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(24);

  sessionStorage.setItem("gmailPkceVerifier", verifier);
  sessionStorage.setItem("gmailOAuthState", state);
  sessionStorage.setItem("gmailClientId", clientId);
  sessionStorage.setItem("gmailClientSecret", clientSecret || "");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: state
  });

  window.location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

async function handleGmailOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code) return;

  // Always clean the URL so refreshing doesn't replay the code.
  window.history.replaceState({}, document.title, window.location.pathname);

  const expectedState = sessionStorage.getItem("gmailOAuthState");
  const verifier = sessionStorage.getItem("gmailPkceVerifier");
  const clientId = sessionStorage.getItem("gmailClientId");
  const clientSecret = sessionStorage.getItem("gmailClientSecret") || "";

  if (params.get("error")) {
    alert("Google sign-in was not completed: " + params.get("error"));
    return;
  }
  if (!verifier || !clientId || state !== expectedState) {
    alert("Google sign-in could not be verified. Please try Connect with Google again.");
    return;
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      code: code,
      code_verifier: verifier,
      redirect_uri: gmailRedirectUri(),
      grant_type: "authorization_code"
    });
    if (clientSecret) body.set("client_secret", clientSecret);

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const tok = await resp.json();
    if (!resp.ok) throw new Error(tok.error_description || tok.error || "Token exchange failed.");

    const profResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: "Bearer " + tok.access_token }
    });
    const prof = await profResp.json();
    if (!profResp.ok) throw new Error((prof.error && prof.error.message) || "Could not read Gmail profile.");
    const email = prof.emailAddress;

    let acc = accounts.find(a => a.type === "gmail" && a.email === email);
    if (!acc) {
      acc = { id: "gmail_" + Date.now(), type: "gmail", email: email };
      accounts.push(acc);
    }
    acc.clientId = clientId;
    acc.clientSecret = clientSecret;
    acc.accessToken = tok.access_token;
    if (tok.refresh_token) acc.refreshToken = tok.refresh_token;
    acc.tokenExpiresAt = Date.now() + (tok.expires_in || 3600) * 1000;

    currentAccountId = acc.id;
    saveAccounts();
  } catch (err) {
    alert("Google sign-in failed: " + err.message);
  } finally {
    sessionStorage.removeItem("gmailPkceVerifier");
    sessionStorage.removeItem("gmailOAuthState");
    sessionStorage.removeItem("gmailClientId");
    sessionStorage.removeItem("gmailClientSecret");
  }
}

async function ensureFreshGmailToken(acc) {
  if (acc.tokenExpiresAt && Date.now() < acc.tokenExpiresAt - 60000) return;
  if (!acc.refreshToken) {
    throw new Error("Your Gmail session expired. Reconnect it from the Accounts panel.");
  }
  const body = new URLSearchParams({
    client_id: acc.clientId,
    refresh_token: acc.refreshToken,
    grant_type: "refresh_token"
  });
  if (acc.clientSecret) body.set("client_secret", acc.clientSecret);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const tok = await resp.json();
  if (!resp.ok) throw new Error(tok.error_description || "Could not refresh Google session. Reconnect this account.");
  acc.accessToken = tok.access_token;
  acc.tokenExpiresAt = Date.now() + (tok.expires_in || 3600) * 1000;
  saveAccounts();
}

async function gmailFetch(acc, url, options) {
  await ensureFreshGmailToken(acc);
  options = options || {};
  options.headers = Object.assign({}, options.headers, { Authorization: "Bearer " + acc.accessToken });
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || ("Gmail API error " + resp.status));
  }
  return resp;
}

function b64urlDecode(data) {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try { return decodeURIComponent(escape(atob(b64))); } catch (e) { return atob(b64); }
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractPlainText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body && payload.body.data) {
    return b64urlDecode(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      const found = extractPlainText(p);
      if (found) return found;
    }
  }
  if (payload.body && payload.body.data) return b64urlDecode(payload.body.data);
  return "";
}

async function fetchGmailMessageMeta(acc, id, folderHint) {
  const r = await gmailFetch(acc, "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id +
    "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date");
  const m = await r.json();
  const headers = {};
  ((m.payload && m.payload.headers) || []).forEach(h => headers[h.name] = h.value);
  const labelIds = m.labelIds || [];
  return {
    id: m.id,
    from: headers.From || "(unknown sender)",
    subject: headers.Subject || "(no subject)",
    snippet: m.snippet || "",
    body: null, // loaded lazily when opened
    date: headers.Date ? new Date(headers.Date).toISOString() : new Date(Number(m.internalDate || Date.now())).toISOString(),
    folder: folderHint,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED")
  };
}

async function fetchGmailFolder(acc, folder) {
  if (folder === "drafts") {
    const r = await gmailFetch(acc, "https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=15");
    const data = await r.json();
    const drafts = data.drafts || [];
    const items = await Promise.all(drafts.map(d => fetchGmailMessageMeta(acc, d.message.id, "drafts")));
    return items;
  }
  let url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20";
  if (folder !== "all") url += "&labelIds=" + GMAIL_FOLDER_LABEL[folder];
  const r = await gmailFetch(acc, url);
  const data = await r.json();
  const msgs = data.messages || [];
  const items = await Promise.all(msgs.map(m => fetchGmailMessageMeta(acc, m.id, folder)));
  return items;
}

async function fetchGmailBody(acc, id) {
  const r = await gmailFetch(acc, "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "?format=full");
  const m = await r.json();
  return extractPlainText(m.payload) || m.snippet || "(no readable body)";
}

async function gmailModify(acc, id, addLabels, removeLabels) {
  await gmailFetch(acc, "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "/modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: addLabels || [], removeLabelIds: removeLabels || [] })
  });
}

async function gmailTrash(acc, id) {
  await gmailFetch(acc, "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "/trash", { method: "POST" });
}

function buildRfc822(from, to, subject, body) {
  const encodedSubject = "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(subject))) + "?=";
  return "To: " + to + "\r\nFrom: " + from + "\r\nSubject: " + encodedSubject +
    "\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body;
}

async function gmailSend(acc, to, subject, body) {
  const raw = b64urlEncode(buildRfc822(acc.email, to, subject, body));
  await gmailFetch(acc, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: raw })
  });
}

/* ---------------- rendering: account bar ---------------- */

function currentAccount() {
  return accounts.find(a => a.id === currentAccountId) || null;
}

function renderAccountBar() {
  const acc = currentAccount();
  document.getElementById("current-account").textContent =
    acc ? acc.email + (acc.type === "gmail" ? " (Gmail, live)" : "") : "Not signed in";
}

/* ---------------- rendering: folders / counts ---------------- */

function renderFolderCounts() {
  const acc = currentAccount();
  if (acc && acc.type === "gmail") {
    // Live counts would need extra API calls; keep this simple and skip badges for Gmail.
    document.getElementById("count-inbox").textContent = "";
    document.getElementById("count-drafts").textContent = "";
    document.getElementById("count-spam").textContent = "";
    return;
  }
  const counts = { inbox: 0, drafts: 0, spam: 0 };
  mail.forEach(m => {
    if (m.folder === "inbox" && m.unread) counts.inbox++;
    if (m.folder === "drafts") counts.drafts++;
    if (m.folder === "spam") counts.spam++;
  });
  document.getElementById("count-inbox").textContent = counts.inbox ? "(" + counts.inbox + ")" : "";
  document.getElementById("count-drafts").textContent = counts.drafts ? "(" + counts.drafts + ")" : "";
  document.getElementById("count-spam").textContent = counts.spam ? "(" + counts.spam + ")" : "";
}

function selectFolder(folder) {
  currentFolder = folder;
  selectedIds.clear();
  document.querySelectorAll("#folder-list li").forEach(li => {
    li.classList.toggle("selected", li.dataset.folder === folder);
  });
  loadFolderContent();
}

/* ---------------- loading folder content (Gmail live vs local) ---------------- */

async function loadFolderContent() {
  const acc = currentAccount();
  if (!acc) { mail = []; renderEmailList(); return; }

  if (acc.type === "gmail") {
    document.getElementById("email-list").innerHTML =
      '<tr><td colspan="5" style="padding:12px;color:#888;">Loading messages from Gmail...</td></tr>';
    try {
      mail = await fetchGmailFolder(acc, currentFolder);
    } catch (err) {
      document.getElementById("email-list").innerHTML =
        '<tr><td colspan="5" style="padding:12px;color:#a00;">' + escapeHtml(err.message) + '</td></tr>';
      return;
    }
  }
  renderEmailList();
}

/* ---------------- rendering: email list ---------------- */

function visibleMail() {
  const acc = currentAccount();
  let list;

  if (acc && acc.type === "gmail") {
    list = mail.slice(); // already scoped to current folder by the API call
  } else if (currentFolder === "starred") {
    list = mail.filter(m => m.starred);
  } else if (currentFolder === "all") {
    list = mail.filter(m => m.folder !== "trash");
  } else {
    list = mail.filter(m => m.folder === currentFolder);
  }

  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    list = list.filter(m =>
      m.subject.toLowerCase().includes(t) ||
      m.from.toLowerCase().includes(t) ||
      (m.snippet || "").toLowerCase().includes(t)
    );
  }
  return list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderEmailList() {
  const list = visibleMail();
  const tbody = document.getElementById("email-list");
  tbody.innerHTML = "";

  list.forEach(m => {
    const tr = document.createElement("tr");
    tr.className = (m.unread ? "unread" : "read") + (selectedIds.has(m.id) ? " selected" : "");
    tr.dataset.id = m.id;

    tr.innerHTML =
      '<td class="col-check"><input type="checkbox" class="row-check" ' + (selectedIds.has(m.id) ? "checked" : "") + '></td>' +
      '<td class="col-star"><span class="star ' + (m.starred ? "on" : "") + '">&#9733;</span></td>' +
      '<td class="col-sender">' + escapeHtml(m.from) + '</td>' +
      '<td class="col-subject">' + escapeHtml(m.subject) + ' &ndash; <span class="snippet">' + escapeHtml(m.snippet || "") + '</span></td>' +
      '<td class="col-date">' + formatDate(m.date) + '</td>';

    tr.querySelector(".row-check").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(m.id);
    });
    tr.querySelector(".star").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStar(m.id);
    });
    tr.addEventListener("click", () => openReader(m.id));

    tbody.appendChild(tr);
  });

  const rangeText = list.length ? ("1-" + list.length + " of " + list.length) : "No messages";
  document.getElementById("pagination-top").textContent = rangeText;
  document.getElementById("pagination-bottom").textContent = rangeText;

  renderFolderCounts();
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/* ---------------- selection & actions ---------------- */

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderEmailList();
}

function toggleStar(id) {
  const m = mail.find(x => x.id === id);
  if (!m) return;
  m.starred = !m.starred;
  renderEmailList();

  const acc = currentAccount();
  if (acc && acc.type === "gmail") {
    gmailModify(acc, id, m.starred ? ["STARRED"] : [], m.starred ? [] : ["STARRED"]).catch(err => alert(err.message));
  } else {
    persist();
  }
}

function setSelectAll(checked) {
  selectedIds.clear();
  if (checked) visibleMail().forEach(m => selectedIds.add(m.id));
  renderEmailList();
  document.getElementById("select-all-top").checked = checked;
  document.getElementById("select-all-bottom").checked = checked;
}

function applyToSelectedLocal(fn) {
  mail.forEach(m => { if (selectedIds.has(m.id)) fn(m); });
  selectedIds.clear();
  persist();
  renderEmailList();
}

async function runAction(action) {
  const acc = currentAccount();
  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  if (acc && acc.type === "gmail") {
    selectedIds.clear();
    try {
      await Promise.all(ids.map(id => {
        switch (action) {
          case "archive":    return gmailModify(acc, id, [], ["INBOX"]);
          case "spam":       return gmailModify(acc, id, ["SPAM"], ["INBOX"]);
          case "delete":     return gmailTrash(acc, id);
          case "markread":   return gmailModify(acc, id, [], ["UNREAD"]);
          case "markunread": return gmailModify(acc, id, ["UNREAD"], []);
          case "star":       return gmailModify(acc, id, ["STARRED"], []);
          case "unstar":     return gmailModify(acc, id, [], ["STARRED"]);
          default: return Promise.resolve();
        }
      }));
    } catch (err) {
      alert(err.message);
    }
    loadFolderContent();
    return;
  }

  if (acc && acc.backend) {
    ids.forEach(id => sendBackendAction(acc.backend, id, action));
  }
  switch (action) {
    case "archive":    applyToSelectedLocal(m => { m.folder = "all"; }); break;
    case "spam":       applyToSelectedLocal(m => { m.folder = "spam"; }); break;
    case "delete":     applyToSelectedLocal(m => { m.folder = "trash"; }); break;
    case "markread":   applyToSelectedLocal(m => { m.unread = false; }); break;
    case "markunread": applyToSelectedLocal(m => { m.unread = true; }); break;
    case "star":       applyToSelectedLocal(m => { m.starred = true; }); break;
    case "unstar":     applyToSelectedLocal(m => { m.starred = false; }); break;
  }
}

function persist() {
  const acc = currentAccount();
  if (acc && acc.type !== "gmail") saveMailForAccount(acc.id, mail);
}

/* ---------------- reader modal ---------------- */

async function openReader(id) {
  const m = mail.find(x => x.id === id);
  if (!m) return;

  document.getElementById("reader-subject").textContent = m.subject;
  document.getElementById("reader-meta").textContent = "From: " + m.from + "   |   " + new Date(m.date).toLocaleString();
  document.getElementById("reader-body").textContent = "Loading...";
  document.getElementById("reader-modal").dataset.id = id;
  showModal("reader-modal");

  const acc = currentAccount();
  if (acc && acc.type === "gmail") {
    try {
      const body = await fetchGmailBody(acc, id);
      document.getElementById("reader-body").textContent = body;
    } catch (err) {
      document.getElementById("reader-body").textContent = "Could not load message: " + err.message;
    }
    if (m.unread) {
      m.unread = false;
      renderEmailList();
      gmailModify(acc, id, [], ["UNREAD"]).catch(() => {});
    }
    return;
  }

  document.getElementById("reader-body").textContent = m.body || m.snippet || "";
  if (m.unread) {
    m.unread = false;
    persist();
    renderEmailList();
  }
}

/* ---------------- compose ---------------- */

function openCompose(prefill) {
  document.getElementById("compose-to").value = (prefill && prefill.to) || "";
  document.getElementById("compose-subject").value = (prefill && prefill.subject) || "";
  document.getElementById("compose-body").value = (prefill && prefill.body) || "";
  const acc = currentAccount();
  document.getElementById("compose-hint").textContent =
    acc && acc.type === "gmail" ? "Sending live through your connected Gmail account." :
    (acc && acc.backend) ? "Sending through your configured backend proxy." :
    "No backend configured for this account: Send will open your default mail app.";
  showModal("compose-modal");
}

async function sendCompose() {
  const to = document.getElementById("compose-to").value.trim();
  const subject = document.getElementById("compose-subject").value.trim();
  const body = document.getElementById("compose-body").value;
  const acc = currentAccount();

  if (acc && acc.type === "gmail") {
    try {
      await gmailSend(acc, to, subject, body);
    } catch (err) {
      alert("Could not send: " + err.message);
      return;
    }
    hideModal("compose-modal");
    if (currentFolder === "sent") loadFolderContent();
    return;
  }

  if (acc && acc.backend) {
    fetch(acc.backend.replace(/\/$/, "") + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: acc.id, to, subject, body })
    }).catch(() => { /* backend unreachable - local sent copy still added below */ });
  } else {
    const mailto = "mailto:" + encodeURIComponent(to) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
    window.location.href = mailto;
  }

  if (currentAccountId) {
    mail.unshift({
      id: "sent_" + Date.now(),
      from: acc ? acc.email : "You",
      to: to,
      subject: subject || "(no subject)",
      snippet: body.slice(0, 80),
      body: body,
      date: new Date().toISOString(),
      folder: "sent",
      unread: false,
      starred: false
    });
    persist();
  }

  hideModal("compose-modal");
  if (currentFolder === "sent") renderEmailList();
}

/* ---------------- backend calls (optional, non-Gmail) ---------------- */

function sendBackendAction(backend, id, action) {
  fetch(backend.replace(/\/$/, "") + "/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action })
  }).catch(() => { /* ignore - local copy already applied */ });
}

function refreshFromBackend() {
  const acc = currentAccount();
  if (!acc) { renderEmailList(); return; }

  if (acc.type === "gmail") { loadFolderContent(); return; }

  if (!acc.backend) { renderEmailList(); return; }
  fetch(acc.backend.replace(/\/$/, "") + "/messages?folder=" + encodeURIComponent(currentFolder))
    .then(r => r.json())
    .then(data => {
      if (Array.isArray(data)) {
        mail = data;
        persist();
        renderEmailList();
      }
    })
    .catch(() => { renderEmailList(); });
}

/* ---------------- account management ---------------- */

function applyPreset(presetKey) {
  const p = PROVIDER_PRESETS[presetKey] || PROVIDER_PRESETS.custom;
  document.getElementById("acc-imap-host").value = p.imapHost;
  document.getElementById("acc-imap-port").value = p.imapPort;
  document.getElementById("acc-smtp-host").value = p.smtpHost;
  document.getElementById("acc-smtp-port").value = p.smtpPort;
}

function renderSavedAccounts() {
  const box = document.getElementById("saved-accounts");
  box.innerHTML = "";
  if (!accounts.length) {
    box.innerHTML = '<p class="hint">No accounts added yet.</p>';
    return;
  }
  accounts.forEach(acc => {
    const row = document.createElement("div");
    row.className = "account-entry";
    const label = acc.email + (acc.type === "gmail" ? " (Gmail, live)" : "") + (acc.id === currentAccountId ? " (active)" : "");
    row.innerHTML =
      '<span>' + escapeHtml(label) + '</span>' +
      '<span><a href="#" data-id="' + acc.id + '" class="use-account">Use</a>' +
      '<a href="#" data-id="' + acc.id + '" class="remove-account">Remove</a></span>';
    row.querySelector(".use-account").addEventListener("click", (e) => {
      e.preventDefault();
      switchAccount(acc.id);
      hideModal("account-modal");
    });
    row.querySelector(".remove-account").addEventListener("click", (e) => {
      e.preventDefault();
      removeAccount(acc.id);
    });
    box.appendChild(row);
  });
}

function addAccount() {
  const email = document.getElementById("acc-email").value.trim();
  if (!email) { alert("Please enter an email address."); return; }

  const acc = {
    id: "acc_" + Date.now(),
    type: "manual",
    name: document.getElementById("acc-name").value.trim(),
    email: email,
    password: document.getElementById("acc-password").value,
    imapHost: document.getElementById("acc-imap-host").value.trim(),
    imapPort: document.getElementById("acc-imap-port").value.trim(),
    smtpHost: document.getElementById("acc-smtp-host").value.trim(),
    smtpPort: document.getElementById("acc-smtp-port").value.trim(),
    backend: document.getElementById("acc-backend").value.trim()
  };

  accounts.push(acc);
  saveAccounts();
  renderSavedAccounts();
  switchAccount(acc.id);

  ["acc-name","acc-email","acc-password","acc-imap-host","acc-imap-port","acc-smtp-host","acc-smtp-port","acc-backend"]
    .forEach(id => document.getElementById(id).value = "");
}

function removeAccount(id) {
  accounts = accounts.filter(a => a.id !== id);
  saveAccounts();
  localStorage.removeItem(mailStorageKey(id));
  if (currentAccountId === id) {
    currentAccountId = accounts.length ? accounts[0].id : null;
    saveAccounts();
    loadCurrentAccountMail();
  }
  renderSavedAccounts();
  renderAccountBar();
}

function switchAccount(id) {
  currentAccountId = id;
  saveAccounts();
  loadCurrentAccountMail();
  renderAccountBar();
}

function loadCurrentAccountMail() {
  const acc = currentAccount();
  selectedIds.clear();
  currentFolder = "inbox";
  document.querySelectorAll("#folder-list li").forEach(li => {
    li.classList.toggle("selected", li.dataset.folder === "inbox");
  });
  if (!acc) { mail = []; renderEmailList(); return; }
  if (acc.type === "gmail") {
    mail = [];
    loadFolderContent();
  } else {
    mail = loadMailForAccount(acc);
    renderEmailList();
  }
}

/* ---------------- modal helpers ---------------- */

function showModal(id) { document.getElementById(id).classList.remove("hidden"); }
function hideModal(id) { document.getElementById(id).classList.add("hidden"); }

/* ---------------- wire up UI ---------------- */

async function init() {
  loadAccounts();
  await handleGmailOAuthRedirect();

  if (!currentAccountId && accounts.length) currentAccountId = accounts[0].id;
  renderAccountBar();
  loadCurrentAccountMail();

  document.getElementById("gmail-redirect-uri").textContent = gmailRedirectUri();

  document.querySelectorAll("#folder-list li").forEach(li => {
    li.addEventListener("click", () => selectFolder(li.dataset.folder));
  });

  document.querySelectorAll(".action-btn").forEach(btn => {
    btn.addEventListener("click", () => runAction(btn.dataset.action));
  });
  document.getElementById("more-actions-top").addEventListener("change", (e) => {
    if (e.target.value) { runAction(e.target.value); e.target.value = ""; }
  });
  document.getElementById("more-actions-bottom").addEventListener("change", (e) => {
    if (e.target.value) { runAction(e.target.value); e.target.value = ""; }
  });

  document.getElementById("select-all-top").addEventListener("change", (e) => setSelectAll(e.target.checked));
  document.getElementById("select-all-bottom").addEventListener("change", (e) => setSelectAll(e.target.checked));

  document.getElementById("refresh-btn-top").addEventListener("click", refreshFromBackend);
  document.getElementById("refresh-btn-bottom").addEventListener("click", refreshFromBackend);

  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    searchTerm = document.getElementById("search-input").value.trim();
    renderEmailList();
  });

  document.getElementById("compose-btn").addEventListener("click", () => openCompose());
  document.getElementById("compose-send").addEventListener("click", sendCompose);
  document.getElementById("compose-discard").addEventListener("click", () => hideModal("compose-modal"));

  document.getElementById("reader-close").addEventListener("click", (e) => { e.preventDefault(); hideModal("reader-modal"); });
  document.getElementById("reader-delete").addEventListener("click", async () => {
    const id = document.getElementById("reader-modal").dataset.id;
    const acc = currentAccount();
    hideModal("reader-modal");
    if (acc && acc.type === "gmail") {
      try { await gmailTrash(acc, id); } catch (err) { alert(err.message); }
      loadFolderContent();
    } else {
      const m = mail.find(x => x.id === id);
      if (m) m.folder = "trash";
      persist();
      renderEmailList();
    }
  });
  document.getElementById("reader-reply").addEventListener("click", () => {
    const id = document.getElementById("reader-modal").dataset.id;
    const m = mail.find(x => x.id === id);
    hideModal("reader-modal");
    if (m) openCompose({ to: m.from, subject: "Re: " + m.subject, body: "\n\n---\n" + (m.body || m.snippet || "") });
  });

  document.getElementById("add-account-link").addEventListener("click", (e) => {
    e.preventDefault();
    renderSavedAccounts();
    showModal("account-modal");
  });
  document.getElementById("switch-account-link").addEventListener("click", (e) => {
    e.preventDefault();
    renderSavedAccounts();
    showModal("account-modal");
  });
  document.getElementById("settings-link").addEventListener("click", (e) => {
    e.preventDefault();
    renderSavedAccounts();
    showModal("account-modal");
  });
  document.getElementById("account-modal-close").addEventListener("click", () => hideModal("account-modal"));

  document.getElementById("acc-preset").addEventListener("change", (e) => applyPreset(e.target.value));
  document.getElementById("acc-save").addEventListener("click", addAccount);
  applyPreset("custom");

  document.getElementById("gmail-connect-btn").addEventListener("click", () => {
    const clientId = document.getElementById("gmail-client-id").value.trim();
    const clientSecret = document.getElementById("gmail-client-secret").value.trim();
    startGmailOAuth(clientId, clientSecret);
  });

  document.getElementById("storage-info").textContent =
    "Gmail accounts show live mail via the Gmail API. Other accounts run offline unless a backend is configured.";
}

document.addEventListener("DOMContentLoaded", init);
