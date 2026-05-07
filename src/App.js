import { useState, useRef } from "react";
import emailjs from "@emailjs/browser";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";

const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [emails, setEmails] = useState("");
  const [subject, setSubject] = useState("");
  const [fromName, setFromName] = useState("");
  const [message, setMessage] = useState("");
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [isSending, setIsSending] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);

  const addLog = (text, type = "info") =>
    setLogs((prev) => [{ text, type, time: new Date().toLocaleTimeString() }, ...prev]);

  const parseEmails = () =>
    emails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));

  const handleSend = async () => {
    const list = parseEmails();
    if (!list.length) return toast.error("Add at least one valid email.");
    if (!subject || !message || !fromName) return toast.error("Fill in all fields.");
    if (!SERVICE_ID) return toast.error("EmailJS keys missing in .env file.");

    stopRef.current = false;
    setIsSending(true);
    setLogs([]);
    setProgress({ done: 0, total: list.length });
    toast.success(`Starting campaign for ${list.length} email(s)...`);

    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) {
        addLog("⛔ Campaign stopped by user.", "warn");
        break;
      }
      const email = list[i];
      try {
        await emailjs.send(
          SERVICE_ID,
          TEMPLATE_ID,
          { to_email: email, subject, message, from_name: fromName },
          PUBLIC_KEY
        );
        addLog(`✅ Sent to ${email}`, "success");
        setProgress({ done: i + 1, total: list.length });
      } catch (err) {
        addLog(`❌ Failed: ${email} — ${err?.text || err.message}`, "error");
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
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <Toaster position="top-right" />
      <header className="header">
        <div className="logo">✉️ MailBlast</div>
        <div className="tagline">Bulk Email Marketing Tool</div>
      </header>

      <main className="main">
        <div className="card">
          <h2>📋 Sender Info</h2>
          <label>Your Name</label>
          <input
            type="text"
            placeholder="e.g. Ali from Acme Co."
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>

        <div className="card">
          <h2>📧 Recipient Emails</h2>
          <label>
            Paste emails (one per line, or separated by commas/semicolons)
          </label>
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

        <div className="card">
          <h2>✍️ Email Template</h2>
          <label>Subject Line</label>
          <input
            type="text"
            placeholder="e.g. Special offer just for you!"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <label>Message Body</label>
          <textarea
            rows={8}
            placeholder={"Hi there,\n\nWe have an exciting offer for you...\n\nBest,\nYour Team"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <div className="card">
          <h2>⚙️ Send Settings</h2>
          <label>
            Delay between emails:{" "}
            <strong>{delaySeconds} second{delaySeconds !== 1 ? "s" : ""}</strong>
          </label>
          <input
            type="range"
            min={3}
            max={60}
            step={1}
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(Number(e.target.value))}
          />
          <div className="delay-hint">
            ℹ️ A delay of 5–15 seconds helps avoid spam filters.
          </div>
        </div>

        {isSending && progress.total > 0 && (
          <div className="card progress-card">
            <h2>📤 Sending Progress</h2>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-text">
              {progress.done} / {progress.total} sent ({pct}%)
            </div>
          </div>
        )}

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