import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { recordsPost, fetchRecordStats, exportUrl } from "./recordsApi";

const MODES = [
  { value: "new",    title: "🆕 New emails only", desc: "Never emailed before - no repeats" },
  { value: "old",    title: "🔁 Old emails",      desc: "Already emailed - send again" },
  { value: "random", title: "🎲 Random",          desc: "Mix of new and old" },
];

const MAX_STEPS = 300;          // safety stop for one scrape run
const MAX_EMPTY_STEPS = 25;     // stop when searches keep finding nothing new
const MAX_ERRORS_IN_ROW = 3;
const ENGINE_LABELS = { bing: "Bing", yahoo: "Yahoo", duckduckgo: "DuckDuckGo" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kinds of business an email can be filed under (labels come from the server).
const TYPE_ORDER = ["restaurant", "hotel", "catering", "services", "school", "other"];
const TYPE_ICONS = { restaurant: "🍽️", hotel: "🏨", catering: "🥘", services: "🛠️", school: "🎓", other: "🏢" };
const DEFAULT_TYPE_LABELS = {
  restaurant: "Restaurants & cafés", hotel: "Hotels", catering: "Catering",
  services: "Services", school: "Schools & education", other: "Others",
};

/**
 * UAE email scraper + recipient source.
 *
 *  - Scrape: runs Google searches step by step on the server until `room`
 *    verified UAE addresses were added to the recipient box (room = provider
 *    daily limit minus what is already in the box).
 *  - Load: fills the box from saved records by mode (new / old / random).
 *  - Mode also decides, at send time, whether already-emailed addresses are
 *    skipped (App.js calls the "filter" action).
 */
export default function EmailScraper({ limit, currentEmails, onAppend, mode, onModeChange, disabled, refreshKey }) {
  const [stats, setStats] = useState(null);
  const [searchProvider, setSearchProvider] = useState("");
  const [engines, setEngines] = useState(null);
  const [pausedFor, setPausedFor] = useState(0);
  const [statsError, setStatsError] = useState("");
  const [keywords, setKeywords] = useState("");
  const [source, setSource] = useState("sites"); // "sites" (website list) | "search" (search engines)
  const [sites, setSites] = useState(null);
  const [typeLabels, setTypeLabels] = useState(DEFAULT_TYPE_LABELS);
  const [types, setTypes] = useState(TYPE_ORDER);          // selected business types (all = no filter)
  const [sorting, setSorting] = useState(false);
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ found: 0, target: 0, steps: 0 });
  const [log, setLog] = useState([]);
  const stopRef = useRef(false);

  const room = Math.max(0, limit - currentEmails.length);
  const effectiveTarget = Math.min(room, Math.max(0, parseInt(target, 10) || room));

  const refresh = useCallback(() => {
    fetchRecordStats()
      .then((data) => {
        setStats(data.stats);
        setSearchProvider(data.searchProvider || "");
        setEngines(data.engines || null);
        setSites(data.sites || null);
        if (data.businessTypes) setTypeLabels({ ...DEFAULT_TYPE_LABELS, ...data.businessTypes });
        setStatsError("");
      })
      .catch((err) => setStatsError(err.message));
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const addLog = (text, type = "info") =>
    setLog((prev) => [{ text, type, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 200));

  const handleScrape = async () => {
    if (effectiveTarget <= 0) {
      return toast.error(`The recipient box is full (${limit} for this provider). Send or clear it first.`);
    }
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    setProgress({ found: 0, target: effectiveTarget, steps: 0 });
    addLog(`Looking for ${effectiveTarget} verified UAE emails...`);

    let found = 0;
    let steps = 0;
    let emptySteps = 0;
    let errors = 0;
    const seen = new Set(currentEmails.map((e) => e.toLowerCase()));
    const action = source === "sites" ? "crawl" : "scrape";
    // With a business-type filter many batches hold none of the chosen types: allow more of them.
    const emptyLimit = source === "sites" ? (types.length === TYPE_ORDER.length ? 60 : 150) : MAX_EMPTY_STEPS;

    while (found < effectiveTarget && steps < MAX_STEPS && !stopRef.current) {
      try {
        const data = await recordsPost(action, { need: effectiveTarget - found, keywords, types });
        errors = 0;
        if (data.sites) setSites(data.sites);

        // Website-list mode: download the UAE website list first (one time, then monthly).
        if (data.needsPrepare) {
          addLog("📥 Preparing the UAE website list (one-time download, about a minute)...");
          let ready = false;
          while (!ready && !stopRef.current) {
            const prep = await recordsPost("prepare-sites");
            (prep.log || []).forEach((line) => addLog(line));
            if (prep.sites) setSites(prep.sites);
            ready = prep.ready;
          }
          continue;
        }

        // Anti-block pacing: the server says how long until an engine may search again.
        if (data.wait) {
          (data.log || []).forEach((line) => addLog("⚠️ " + line, "warn"));
          addLog(`⏸ Pausing ${data.wait}s between searches so the search engines do not block us...`);
          for (let left = data.wait; left > 0 && !stopRef.current; left--) {
            setPausedFor(left);
            await sleep(1000);
          }
          setPausedFor(0);
          continue;
        }
        steps++;
        refresh(); // keeps the per-engine counters current
        (data.log || []).forEach((line) => addLog(line));
        if (data.stats) setStats(data.stats);

        const fresh = (data.emails || []).filter((e) => !seen.has(e.toLowerCase()));
        fresh.forEach((e) => seen.add(e.toLowerCase()));
        if (fresh.length) {
          onAppend(fresh);
          found += fresh.length;
          emptySteps = 0;
          addLog(`➕ Added ${fresh.length} to recipients: ${fresh.join(", ")}`, "success");
        } else {
          emptySteps++;
        }
        setProgress({ found, target: effectiveTarget, steps });

        if (data.exhausted) {
          (data.log || []).forEach((line) => addLog(line, "warn"));
          if (source === "search") addLog("All searches for these keywords are used up. Try different keywords.", "warn");
          break;
        }
        if (emptySteps >= emptyLimit) {
          addLog(`No new emails in the last ${emptyLimit} steps - stopping.`, "warn");
          break;
        }
      } catch (err) {
        errors++;
        steps++;
        addLog("❌ " + err.message, "error");
        if (errors >= MAX_ERRORS_IN_ROW || /all search engines are resting|busy/i.test(err.message)) break;
        await sleep(3000);
      }
    }

    if (stopRef.current) addLog("⛔ Scraping stopped.", "warn");
    setRunning(false);
    refresh();
    toast.success(`Scraping finished: ${found} new UAE email(s) added.`);
  };

  const handleLoad = async () => {
    if (room <= 0) return toast.error(`The recipient box is full (${limit} for this provider).`);
    try {
      const data = await recordsPost("load", { mode, count: room, exclude: currentEmails, types });
      const emails = data.emails || [];
      if (data.stats) setStats(data.stats);
      if (!emails.length) {
        return toast.error(
          mode === "old"
            ? `No previously emailed ${typeSummary} on record yet.`
            : `No unused ${typeSummary} emails on record - find new ones first.`
        );
      }
      onAppend(emails);
      toast.success(`Loaded ${emails.length} ${mode} email(s) from records.`);
      if (emails.length < room && mode === "new") {
        toast(`Only ${emails.length} unused emails were on record. Scrape to fill the rest.`, { icon: "ℹ️" });
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const allTypes = types.length === TYPE_ORDER.length;
  const typeSummary = allTypes ? "" : types.map((t) => typeLabels[t].toLowerCase()).join(", ");

  const toggleType = (type) =>
    setTypes((prev) => {
      const next = prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type];
      return next.length ? TYPE_ORDER.filter((t) => next.includes(t)) : prev;   // keep at least one
    });

  // Emails saved before business types existed: visit their websites once to sort them.
  const handleSort = async () => {
    setSorting(true);
    try {
      for (let i = 0; i < 200; i++) {
        const data = await recordsPost("classify");
        if (data.stats) setStats(data.stats);
        (data.log || []).forEach((line) => addLog(line));
        if (data.done) break;
      }
      toast.success("Saved emails are sorted by business type.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSorting(false);
    }
  };

  const pct = progress.target ? Math.round((progress.found / progress.target) * 100) : 0;

  return (
    <div className="card scraper-card">
      <h2>🌐 UAE Email Finder &amp; Records</h2>

      {statsError ? (
        <div className="provider-warning over">⚠️ Email records are unavailable: {statsError}</div>
      ) : stats ? (
        <div className="record-stats">
          <span>Total <strong>{stats.total}</strong></span>
          <span>🆕 Unused <strong>{stats.new}</strong></span>
          <span>✅ Emailed <strong>{stats.sent}</strong></span>
          <span>❌ Failed <strong>{stats.failed}</strong></span>
          <span>🚫 Unsubscribed <strong>{stats.unsubscribed}</strong></span>
          <a className="btn-export" href={exportUrl()} download>
            ⬇️ Download Excel (CSV)
          </a>
        </div>
      ) : null}

      <label>Send campaign to</label>
      <div className="provider-grid mode-grid">
        {MODES.map((m) => (
          <label key={m.value} className={`provider-card ${mode === m.value ? "active" : ""}`}>
            <input
              type="radio"
              name="recipient-mode"
              value={m.value}
              checked={mode === m.value}
              disabled={disabled}
              onChange={() => onModeChange(m.value)}
            />
            <div className="provider-info">
              <span className="provider-name">{m.title}</span>
              <span className="provider-desc">{m.desc}</span>
            </div>
          </label>
        ))}
      </div>
      <p className="field-hint">
        With "New emails only", addresses that were already emailed are skipped automatically when you send.
        Unsubscribed addresses are always skipped.
      </p>

      <label>Business type</label>
      <div className="type-grid" role="group" aria-label="Business types">
        <button
          type="button"
          className={`type-chip all ${allTypes ? "active" : ""}`}
          disabled={running}
          onClick={() => setTypes(TYPE_ORDER)}
        >
          All types
        </button>
        {TYPE_ORDER.map((type) => {
          const count = stats && stats.types && stats.types[type];
          const on = types.includes(type) && !allTypes;
          return (
            <label key={type} className={`type-chip ${on ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={running}
                onChange={() => (allTypes ? setTypes([type]) : toggleType(type))}
              />
              <span>{TYPE_ICONS[type]} {typeLabels[type]}</span>
              {count ? <span className="type-count live-value">{count.new}</span> : null}
            </label>
          );
        })}
      </div>
      <p className="field-hint">
        {allTypes
          ? "Every kind of business. Pick one or more types to find and load only those."
          : `Only ${typeSummary} will be found and loaded. Emails of other types found on the way are still saved for later.`}
        {" "}Numbers show unused emails of each type.
        {stats && stats.unsorted > 0 && (
          <>
            {" "}
            <button type="button" className="link-btn" onClick={handleSort} disabled={sorting || running}>
              {sorting ? "Sorting saved emails..." : `Sort ${stats.unsorted} older saved emails by type`}
            </button>
          </>
        )}
      </p>

      <div className="scraper-row">
        <button type="button" className="btn-secondary" onClick={handleLoad} disabled={disabled || running || room <= 0}>
          📂 Load {mode} {allTypes ? "" : typeSummary + " "}emails from records ({room})
        </button>
      </div>

      <label>Where to find emails</label>
      <div className="provider-grid">
        {[
          { value: "sites", title: "⚡ UAE website list", desc: "Fast - visits UAE (.ae) business websites directly. No waiting, no blocks." },
          { value: "search", title: "🔎 Search engines", desc: "Slower - searches by business type, with pauses between searches." },
        ].map((option) => (
          <label key={option.value} className={`provider-card ${source === option.value ? "active" : ""}`}>
            <input
              type="radio"
              name="finder-source"
              value={option.value}
              checked={source === option.value}
              disabled={running}
              onChange={() => setSource(option.value)}
            />
            <div className="provider-info">
              <span className="provider-name">{option.title}</span>
              <span className="provider-desc">{option.desc}</span>
            </div>
          </label>
        ))}
      </div>

      {source === "sites" && (
        <p className="field-hint">
          Uses the public Tranco and Cisco Umbrella lists of the world's most visited websites, keeps every UAE
          (.ae) business site, and visits 40 at a time - home page and contact page. Government sites are skipped.
          {sites && sites.ready
            ? ` List: ${sites.total} websites, ${sites.left} not visited yet (refreshes monthly).`
            : " The list is downloaded on the first run (about a minute)."}
        </p>
      )}

      {source === "search" && (
        <>
          <label htmlFor="scrape-keywords">Business types to search (optional)</label>
          <textarea
            id="scrape-keywords"
            rows={2}
            placeholder={allTypes
              ? "Leave empty to search all UAE markets, or e.g. restaurants, hotels, catering companies"
              : `Leave empty to search for the selected types (${typeSummary})`}
            value={keywords}
            disabled={running}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </>
      )}

      <label htmlFor="scrape-target">
        How many to find (space left for this provider: <span className="live-value">{room}</span> of{" "}
        <span className="live-value">{limit}</span>)
      </label>
      <input
        id="scrape-target"
        type="number"
        min={1}
        max={room}
        placeholder={String(room)}
        value={target}
        disabled={running}
        onChange={(e) => setTarget(e.target.value)}
      />

      {source === "search" && searchProvider === "free" && (
        <p className="field-hint">
          Searches Bing, Yahoo and DuckDuckGo directly - no API key needed. To avoid blocks it waits 25-50 s
          between searches on each engine, stops at a daily limit, and rests any engine that asks for a captcha
          (30 min, then longer). Directory sites are mined for many companies per search.
          {engines && (
            <span className="engine-status">
              {Object.entries(engines).map(([name, e]) => (
                <span key={name}>
                  {ENGINE_LABELS[name] || name}: <span className="live-value">{e.today} / {e.limit}</span> today
                  {e.restingFor > 0 ? ` · resting ${Math.ceil(e.restingFor / 60)} min` : ""}
                </span>
              ))}
            </span>
          )}
        </p>
      )}

      <div className="scraper-row">
        {!running ? (
          <button
            type="button"
            className="btn-secondary primary"
            onClick={handleScrape}
            disabled={disabled || room <= 0}
          >
            🔎 Find {effectiveTarget} new {allTypes ? "UAE" : typeSummary} emails
          </button>
        ) : (
          <button type="button" className="btn-stop small" onClick={() => { stopRef.current = true; }}>
            ⛔ Stop finding
          </button>
        )}
      </div>

      {(running || progress.steps > 0) && (
        <>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-text">
            <span className="live-value">{progress.found} / {progress.target}</span> found ·{" "}
            <span className="live-value">{progress.steps}</span> {source === "sites" ? "batch" : "search"}{progress.steps !== 1 ? "es" : ""}
            {pausedFor > 0 && <> · next search in <span className="live-value">{pausedFor}s</span></>}
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="log-list scraper-log">
          {log.map((item, i) => (
            <div key={i} className={`log-item log-${item.type}`}>
              <span className="log-time">{item.time}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}

      <p className="field-hint">
        Only addresses on .ae domains, or printed next to a UAE phone number or emirate, are kept. Each one is
        checked for valid format and a working mail server. Every address found is saved to the records file,
        even ones beyond today's limit - use "Load new emails" next time to send to them.
      </p>
    </div>
  );
}
