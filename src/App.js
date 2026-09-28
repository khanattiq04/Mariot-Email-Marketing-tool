import { useEffect, useState, useRef } from "react";
import toast, { Toaster } from "react-hot-toast";
import RichTextEditor from "./RichTextEditor";
import Login from "./Login";
import { fetchSession, logout } from "./auth";
import "./App.css";
import mariotIcon from "./mariot-icon.webp";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cloudinary (unsigned browser upload).
// Set REACT_APP_CLOUDINARY_CLOUD_NAME / REACT_APP_CLOUDINARY_UPLOAD_PRESET in .env
// (and in the Vercel project dashboard) to point at a different Cloudinary account.
const CLOUDINARY_CLOUD_NAME =
  process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || "sgzvnrzn";
const CLOUDINARY_UPLOAD_PRESET =
  process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || "email-marketing";
const CLOUDINARY_UPLOAD_URL =
  `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// Where the sending API lives. Empty means this host, which is right for both
// setups: Vercel serves api/send-email.js and PHP hosting serves
// public/api/send-email.php on the same origin. Set REACT_APP_API_BASE at build
// time to post campaigns to a different origin instead.
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/+$/, "");

// Email clients do not render AVIF or HEIC, and Cloudinary hands those files
// back untouched, so they arrive in the inbox looking broken. Convert them to
// JPEG in the browser before upload; every other format is uploaded unchanged.
const EMAIL_UNSUPPORTED_TYPES = ["image/avif", "image/heic", "image/heif"];
const EMAIL_UNSUPPORTED_EXTENSION = /\.(avif|heic|heif)$/i;

function isEmailUnsupported(file) {
  const type = (file.type || "").toLowerCase();
  if (type) return EMAIL_UNSUPPORTED_TYPES.includes(type);
  return EMAIL_UNSUPPORTED_EXTENSION.test(file.name || "");
}

function convertToJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      // JPEG has no transparency, so paint white first to avoid black edges.
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Could not convert this image to JPEG."));
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.92
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. Please use a JPG or PNG."));
    };

    image.src = url;
  });
}

function prepareForUpload(file) {
  return isEmailUnsupported(file) ? convertToJpeg(file) : Promise.resolve(file);
}

// Provider daily limits (free tier)
const PROVIDER_LIMITS = {
  brevo:      300,
  resend:     100,
  mailersend: 83,    // ~2500/month trial ÷ 30 days
  emailoctopus: 2500, // free-plan list cap; EmailOctopus delivers via automations
  auto:       483,
};

const PROVIDER_ICONS = {
  brevo:      "🔵",
  resend:     "🟠",
  mailersend: "🟢",
  emailoctopus: "🟣",
};

// The sender name is fixed for the whole tool, so the field below is read-only.
const SENDER_NAME = "Mariot Store";

export default function App() {
  const [emails,        setEmails]        = useState("");
  const [subject,       setSubject]       = useState("");
  const [message,       setMessage]       = useState("");
  const [delaySeconds,  setDelaySeconds]  = useState(5);
  const [isSending,     setIsSending]     = useState(false);
  const [logs,          setLogs]          = useState([]);
  const [progress,      setProgress]      = useState({ done: 0, total: 0 });
  const [provider,      setProvider]      = useState("auto"); // "brevo" | "resend" | "mailersend" | "emailoctopus" | "auto"
  const [providerStats, setProviderStats] = useState({ brevo: 0, resend: 0, mailersend: 0, emailoctopus: 0 });

  // "checking" until the session cookie has been verified server-side.
  const [session, setSession] = useState("checking"); // "checking" | "authed" | "anon"
  const [sessionEmail, setSessionEmail] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetchSession().then((result) => {
      if (!active) return;
      setSession(result.authed ? "authed" : "anon");
      setSessionEmail(result.email || "");
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSignedIn = (email) => {
    setSessionEmail(email || "");
    setSession("authed");
  };

  const handleSignOut = async () => {
    await logout();
    setSessionEmail("");
    setSession("anon");
  };
  
  const [heroImage, setHeroImage] = useState("");
  const [image1, setImage1] = useState("");
  const [image2, setImage2] = useState("");
  const [image3, setImage3] = useState("");
  const [message2, setMessage2] = useState("");

  const uploadImage = async (file, setter) => {

  if (!file) return;

  try {

    const formData = new FormData();

    const prepared = await prepareForUpload(file);
    if (prepared !== file) toast("Converted to JPEG so it displays in email.");
    formData.append("file", prepared);

    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const response = await fetch(CLOUDINARY_UPLOAD_URL, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    console.log(data);

    if (data.secure_url) {
      setter(data.secure_url);
      toast.success("Image uploaded successfully");
    } else {
      throw new Error(data.error?.message || "Upload failed");
    }

  } catch (err) {

    console.error(err);

    toast.error(err.message);
  }
};

  const addLog = (text, type = "info") =>
    setLogs((prev) => [{ text, type, time: new Date().toLocaleTimeString() }, ...prev]);

  const parseEmails = () =>
    emails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));

  const handleSend = async () => {
    const list = parseEmails();
    if (!list.length)               return toast.error("Add at least one valid email.");
    if (!subject || !message) return toast.error("Fill in all fields.");

    const limit = PROVIDER_LIMITS[provider];
    if (list.length > limit) {
      toast(`⚠️ ${list.length} emails exceeds free limit of ${limit} for selected provider.`, { icon: "⚠️" });
    }

    stopRef.current = false;
    setIsSending(true);
    setLogs([]);
    setProgress({ done: 0, total: list.length });
    setProviderStats({ brevo: 0, resend: 0, mailersend: 0, emailoctopus: 0 });
    toast.success(`Starting campaign for ${list.length} email(s) via ${provider.toUpperCase()}...`);

    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) {
        addLog("⛔ Campaign stopped by user.", "warn");
        break;
      }

      const email = list[i];

      try {
        const response = await fetch(API_BASE + "/api/send-email", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          emails: [email],
          subject,
          message,
          message2,
          heroImage,
          image1,
          image2,
          image3,
          fromName: SENDER_NAME,
          provider
        }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to send");

        // A 200 only means the request was handled: the API reports per-address
        // failures inside `results`, so surface those instead of logging a send
        // that never happened.
        const result = data.results && data.results[0];
        if (result && result.status !== "sent") {
          throw new Error(result.error || "Failed to send");
        }

        // Track which provider was actually used
        const usedProvider = data.results?.[0]?.provider || provider;
        setProviderStats((prev) => ({
          ...prev,
          [usedProvider]: (prev[usedProvider] || 0) + 1,
        }));

        const icon = PROVIDER_ICONS[usedProvider] || "✉️";
        addLog(`✅ Sent to ${email}  [${icon} ${usedProvider}]`, "success");
        setProgress({ done: i + 1, total: list.length });

      } catch (err) {
        addLog(`❌ Failed: ${email} — ${err.message}`, "error");
      }

      if (i < list.length - 1) {
        addLog(`⏳ Waiting ${delaySeconds}s before next email...`, "info");
        await sleep(delaySeconds * 1000);
      }
    }

    setIsSending(false);
    if (!stopRef.current) {
      toast.success("Campaign complete!");
      addLog("🎉 Campaign finished.", "success");
    }
  };

  const handleStop = () => {
    stopRef.current = true;
    toast("Stopping after current email...", { icon: "⛔" });
  };

  if (session === "checking") {
    return <div className="login-screen" />;
  }

  if (session === "anon") {
    return <Login onSuccess={handleSignedIn} />;
  }

  const emailCount = parseEmails().length;
  const pct        = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const totalSent  = providerStats.brevo + providerStats.resend + providerStats.mailersend + providerStats.emailoctopus;

  return (
    <div className="app">
      <Toaster position="top-right" />
      <header className="header">
        <div className="logo">
          <img className="logo-icon" src={mariotIcon} alt="" />
          Mariot Store
        </div>
        <div className="tagline">Email Marketing Tool</div>
        <div className="header-actions">
          {sessionEmail ? <span className="header-user">{sessionEmail}</span> : null}
          <button type="button" className="btn-logout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">

        {/* ── Sender Info ── */}
        <div className="card">
          <h2>📋 Sender Info</h2>
          <label>Sender Name</label>
          <input
            type="text"
            value={SENDER_NAME}
            readOnly
          />
          <p className="field-hint">Sender name is fixed to Mariot Store.</p>
        </div>

        {/* ── Provider Selection ── */}
        <div className="card">
          <h2>⚡ Email Provider</h2>
          <div className="provider-grid">

            <label className={`provider-card ${provider === "auto" ? "active" : ""}`}>
              <input type="radio" name="provider" value="auto"
                checked={provider === "auto"}
                onChange={() => setProvider("auto")} />
              <div className="provider-info">
                <span className="provider-name">🔀 Auto (Recommended)</span>
                <span className="provider-limit">~483 emails/day</span>
                <span className="provider-desc">Brevo → Resend → MailerSend</span>
              </div>
            </label>

            <label className={`provider-card ${provider === "brevo" ? "active" : ""}`}>
              <input type="radio" name="provider" value="brevo"
                checked={provider === "brevo"}
                onChange={() => setProvider("brevo")} />
              <div className="provider-info">
                <span className="provider-name">🔵 Brevo only</span>
                <span className="provider-limit">300 emails/day</span>
                <span className="provider-desc">Free tier</span>
              </div>
            </label>

            <label className={`provider-card ${provider === "resend" ? "active" : ""}`}>
              <input type="radio" name="provider" value="resend"
                checked={provider === "resend"}
                onChange={() => setProvider("resend")} />
              <div className="provider-info">
                <span className="provider-name">🟠 Resend only</span>
                <span className="provider-limit">100 emails/day</span>
                <span className="provider-desc">Free tier</span>
              </div>
            </label>

            <label className={`provider-card ${provider === "mailersend" ? "active" : ""}`}>
              <input type="radio" name="provider" value="mailersend"
                checked={provider === "mailersend"}
                onChange={() => setProvider("mailersend")} />
              <div className="provider-info">
                <span className="provider-name">🟢 MailerSend only</span>
                <span className="provider-limit">~83 emails/day</span>
                
              </div>
            </label>

            <label className={`provider-card ${provider === "emailoctopus" ? "active" : ""}`}>
              <input type="radio" name="provider" value="emailoctopus"
                checked={provider === "emailoctopus"}
                onChange={() => setProvider("emailoctopus")} />
              <div className="provider-info">
                <span className="provider-name">🟣 EmailOctopus</span>
                <span className="provider-limit">list + automation</span>
                <span className="provider-desc">Sends your EmailOctopus automation</span>
              </div>
            </label>

          </div>

          {emailCount > 0 && (
            <div className={`provider-warning ${emailCount > PROVIDER_LIMITS[provider] ? "over" : "ok"}`}>
              {emailCount > PROVIDER_LIMITS[provider]
                ? `⚠️ ${emailCount} emails exceeds the ${PROVIDER_LIMITS[provider]}/day free limit for this provider`
                : `✅ ${emailCount} emails within the ${PROVIDER_LIMITS[provider]}/day free limit`}
            </div>
          )}
        </div>

        {/* ── Recipient Emails ── */}
        <div className="card">
          <h2>📧 Recipient Emails</h2>
          <label>Paste emails (one per line, or separated by commas/semicolons)</label>
          <textarea
            rows={6}
            placeholder={"john@example.com\njane@example.com\nboss@company.com"}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
          <div className="email-count">
            {emailCount > 0 ? `✅ ${emailCount} valid email(s) detected` : "No emails yet"}
          </div>
        </div>

        {/* ── Email Template ── */}
        {/* ── Email Template ── */}
<div className="card">
  <h2>✍️ Email Template</h2>

  <label>Subject Line</label>
  <input
    type="text"
    placeholder="e.g. Mariot Store Kitchen Equipment"
    value={subject}
    onChange={(e) => setSubject(e.target.value)}
  />

  <label>Hero Image</label>

<input
  type="text"
  placeholder="Cloudinary URL"
  value={heroImage}
  readOnly
/>

<input
  type="file"
  accept="image/*"
  onChange={(e) =>
    uploadImage(
      e.target.files[0],
      setHeroImage
    )
  }
/>

{heroImage && (
  <img
    src={heroImage}
    alt=""
    style={{
      width: "100%",
      marginTop: "10px",
      borderRadius: "10px"
    }}
  />
)}

  <label>Text Content 1</label>
  <RichTextEditor
    value={message}
    onChange={setMessage}
    placeholder="Write your message... select text to style it"
    rows={6}
  />

  <label>Image 1</label>

<input
  type="text"
  value={image1}
  readOnly
/>

<input
  type="file"
  accept="image/*"
  onChange={(e) =>
    uploadImage(
      e.target.files[0],
      setImage1
    )
  }
/>

{image1 && (
  <img
    src={image1}
    alt=""
    style={{
      width: "150px",
      marginTop: "10px"
    }}
  />
)}

  <label>Image 2</label>

<input
  type="text"
  value={image2}
  readOnly
/>

<input
  type="file"
  accept="image/*"
  onChange={(e) =>
    uploadImage(
      e.target.files[0],
      setImage2
    )
  }
/>

{image2 && (
  <img
    src={image2}
    alt=""
    style={{
      width: "150px",
      marginTop: "10px"
    }}
  />
)}

  <label>Image 3</label>

<input
  type="text"
  value={image3}
  readOnly
/>

<input
  type="file"
  accept="image/*"
  onChange={(e) =>
    uploadImage(
      e.target.files[0],
      setImage3
    )
  }
/>

{image3 && (
  <img
    src={image3}
    alt=""
    style={{
      width: "150px",
      marginTop: "10px"
    }}
  />
)}

  <label>Text Content 2</label>
  <RichTextEditor
    value={message2}
    onChange={setMessage2}
    placeholder="Write your second message... select text to style it"
    rows={6}
  />
</div>

        {/* ── Send Settings ── */}
        <div className="card">
          <h2>⚙️ Send Settings</h2>
          <label>
            Delay between emails:{" "}
            <strong>{delaySeconds} second{delaySeconds !== 1 ? "s" : ""}</strong>
          </label>
          <input
            type="range" min={3} max={60} step={1}
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(Number(e.target.value))}
          />
          <div className="delay-hint">
            ℹ️ A delay of 5–15 seconds helps avoid spam filters.
          </div>
        </div>

        {/* ── Progress ── */}
        {isSending && progress.total > 0 && (
          <div className="card progress-card">
            <h2>📤 Sending Progress</h2>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-text">
              {progress.done} / {progress.total} sent ({pct}%)
            </div>
            {/* Live provider usage */}
            <div className="provider-usage">
              {providerStats.brevo        > 0 && <span>🔵 Brevo: {providerStats.brevo}</span>}
              {providerStats.resend       > 0 && <span>🟠 Resend: {providerStats.resend}</span>}
              {providerStats.mailersend   > 0 && <span>🟢 MailerSend: {providerStats.mailersend}</span>}
              {providerStats.emailoctopus > 0 && <span>🟣 EmailOctopus: {providerStats.emailoctopus}</span>}
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="actions">
          {!isSending ? (
            <button className="btn-send" onClick={handleSend}>
              🚀 Send Campaign
            </button>
          ) : (
            <button className="btn-stop" onClick={handleStop}>
              ⛔ Stop Campaign
            </button>
          )}
        </div>

        {/* ── Summary after send ── */}
        {!isSending && totalSent > 0 && (
          <div className="card summary-card">
            <h2>📊 Campaign Summary</h2>
            <div className="summary-row">
              <span>🔵 Sent via Brevo</span>
              <strong>{providerStats.brevo}</strong>
            </div>
            <div className="summary-row">
              <span>🟠 Sent via Resend</span>
              <strong>{providerStats.resend}</strong>
            </div>
            <div className="summary-row">
              <span>🟢 Sent via MailerSend</span>
              <strong>{providerStats.mailersend}</strong>
            </div>
            <div className="summary-row">
              <span>🟣 Queued via EmailOctopus</span>
              <strong>{providerStats.emailoctopus}</strong>
            </div>
            <div className="summary-row total">
              <span>Total Sent</span>
              <strong>{totalSent}</strong>
            </div>
          </div>
        )}

        {/* ── Activity Log ── */}
        {logs.length > 0 && (
          <div className="card log-card">
            <h2>📜 Activity Log</h2>
            <div className="log-list">
              {logs.map((log, i) => (
                <div key={i} className={`log-item log-${log.type}`}>
                  <span className="log-time">{log.time}</span>
                  <span>{log.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
