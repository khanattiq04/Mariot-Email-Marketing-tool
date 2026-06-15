import { useState, useRef } from "react";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Provider daily limits (free tier)
const PROVIDER_LIMITS = {
  brevo:      300,
  resend:     100,
  mailersend: 83,    // ~2500/month trial ÷ 30 days
  auto:       483,
};

const PROVIDER_ICONS = {
  brevo:      "🔵",
  resend:     "🟠",
  mailersend: "🟢",
};

export default function App() {
  const [emails,        setEmails]        = useState("");
  const [subject,       setSubject]       = useState("");
  const [fromName,      setFromName]      = useState("");
  const [message,       setMessage]       = useState("");
  const [delaySeconds,  setDelaySeconds]  = useState(5);
  const [isSending,     setIsSending]     = useState(false);
  const [logs,          setLogs]          = useState([]);
  const [progress,      setProgress]      = useState({ done: 0, total: 0 });
  const [provider,      setProvider]      = useState("auto"); // "brevo" | "resend" | "mailersend" | "auto"
  const [providerStats, setProviderStats] = useState({ brevo: 0, resend: 0, mailersend: 0 });
  const stopRef = useRef(false);
  
  const [heroImage, setHeroImage] = useState("");
  const [image1, setImage1] = useState("");
  const [image2, setImage2] = useState("");
  const [image3, setImage3] = useState("");
  const [message2, setMessage2] = useState("");

  const uploadImage = async (file, setter) => {

  if (!file) return;

  try {

    const formData = new FormData();

    formData.append("file", file);

    formData.append(
      "upload_preset",
      "email-marketing"
    );

    const response = await fetch(
      "https://api.cloudinary.com/v1_1/dfbrl3o1f/image/upload",
      {
        method: "POST",
        body: formData,
      }
    );

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
    if (!subject || !message || !fromName) return toast.error("Fill in all fields.");

    const limit = PROVIDER_LIMITS[provider];
    if (list.length > limit) {
      toast(`⚠️ ${list.length} emails exceeds free limit of ${limit} for selected provider.`, { icon: "⚠️" });
    }

    stopRef.current = false;
    setIsSending(true);
    setLogs([]);
    setProgress({ done: 0, total: list.length });
    setProviderStats({ brevo: 0, resend: 0, mailersend: 0 });
    toast.success(`Starting campaign for ${list.length} email(s) via ${provider.toUpperCase()}...`);

    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) {
        addLog("⛔ Campaign stopped by user.", "warn");
        break;
      }

      const email = list[i];

      try {
        const response = await fetch("/api/send-email", {
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
          fromName,
          provider
        }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to send");

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

  const emailCount = parseEmails().length;
  const pct        = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const totalSent  = providerStats.brevo + providerStats.resend + providerStats.mailersend;

  return (
    <div className="app">
      <Toaster position="top-right" />
      <header className="header">
        <div className="logo">✉️ Model Pros</div>
        <div className="tagline">Email Marketing Tool</div>
      </header>

      <main className="main">

        {/* ── Sender Info ── */}
        <div className="card">
          <h2>📋 Sender Info</h2>
          <label>Your Name</label>
          <input
            type="text"
            placeholder="e.g. Ali from Model Pros"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
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
                <span className="provider-desc">Trial (2500/month)</span>
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
    placeholder="e.g. Model Pros Casting Opportunity"
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
  <textarea
    rows={6}
    value={message}
    onChange={(e) => setMessage(e.target.value)}
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
  <textarea
    rows={6}
    value={message2}
    onChange={(e) => setMessage2(e.target.value)}
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
              {providerStats.brevo      > 0 && <span>🔵 Brevo: {providerStats.brevo}</span>}
              {providerStats.resend     > 0 && <span>🟠 Resend: {providerStats.resend}</span>}
              {providerStats.mailersend > 0 && <span>🟢 MailerSend: {providerStats.mailersend}</span>}
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