import React, { useEffect, useState } from "react";
import { PayGate } from "../components/PayGate.jsx";
import { supabase, hasSupabase } from "../lib/supabase.js";
import { renderLook, shareLookNative } from "../lib/virtualWear.js";
import { Data, isProduction, isTesting } from "../lib/dataBridge.js";
import { GENDER_OPTIONS, PRICE_BANDS } from "../lib/catalog.js";
import { saveLocalLook, lookShareUrl, openLookInApp, copyText } from "../lib/lookShare.js";
import { track, trackProductSelect, trackVwRender, EV } from "../lib/analytics.js";
import { resolveGarmentImage } from "../lib/garmentArt.js";
import { uploadSelfie, moderateSelfie } from "../lib/selfieUpload.js";
import { loadMemberSettings } from "../lib/memberSettings.js";
import { useAuth } from "../hooks.js";
import {
  VW_EVENT_SCENES,
  VW_VIBE_OPTIONS,
  VW_AGE_GROUPS,
  curateVwLooks,
  markOutfitWorn,
  paidVwBrandIds,
} from "../lib/vwPool.js";

const naira = (n) => "₦" + Number(n || 0).toLocaleString();

const PART_LABEL = {
  main_outfit: "Outfit",
  shoes: "Shoes",
  bag: "Bag",
  head_piece: "Head piece",
  jewellery: "Jewellery",
};

function IconSparkles() {
  return (
    <svg className="vw-lov-icon vw-lov-sparkles" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 3l1.2 4.2L17.5 8.5l-4.3 1.3L12 14l-1.2-4.2L6.5 8.5l4.3-1.3L12 3z" />
      <path d="M5 16l.8 2.8L8.5 19.5l-2.7.8L5 23l-.8-2.7L1.5 19.5l2.7-.8L5 16z" />
      <path d="M19 14l.6 2.1L21.5 16.5l-2.1.6L19 19l-.6-2.1L16.5 16.5l2.1-.6L19 14z" />
    </svg>
  );
}

function IconLoader() {
  return (
    <svg className="vw-lov-icon vw-lov-loader" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function VwLoading({ title, subtitle }) {
  return (
    <div className="vw-lov-screen ankara-pattern">
      <div className="vw-lov-loading">
        <div className="vw-lov-loading-icons">
          <IconSparkles />
          <IconLoader />
        </div>
        <h2 className="serif vw-lov-loading-title">{title}</h2>
        <p className="vw-lov-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function VirtualWearInner({ go }) {
  const { profile } = useAuth();
  const [stage, setStage] = useState("landing");
  const [photo, setPhoto] = useState(null);
  const [selfiePath, setSelfiePath] = useState(null);
  const [gender, setGender] = useState("");
  const [scene, setScene] = useState("wedding");
  const [vibes, setVibes] = useState([]);
  const [budgetBand, setBudgetBand] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [modesty, setModesty] = useState(5);
  const [creators, setCreators] = useState([]);
  const [allGarments, setAllGarments] = useState([]);
  const [curatedLooks, setCuratedLooks] = useState([]);
  const [poolMeta, setPoolMeta] = useState({ size: 0, recycled: false });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [render, setRender] = useState(null);
  const [tryBusy, setTryBusy] = useState(false);
  const [shareCode, setShareCode] = useState(null);
  const [renderMode, setRenderMode] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Data.creators().then(setCreators);
    Data.garments().then((rows) => setAllGarments(rows || []));
  }, []);

  /** Testing QA: ?vwqa=1 auto-loads a portrait selfie so capture scripts can run headless. */
  useEffect(() => {
    if (!isTesting() || photo) return;
    try {
      if (new URLSearchParams(window.location.search).get("vwqa") !== "1") return;
      const c = document.createElement("canvas");
      c.width = 480;
      c.height = 640;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#c4a882";
      ctx.fillRect(0, 0, 480, 640);
      ctx.fillStyle = "#2a1810";
      ctx.beginPath();
      ctx.ellipse(240, 140, 85, 110, 0, 0, Math.PI * 2);
      ctx.fill();
      setPhoto(c.toDataURL("image/jpeg", 0.92));
    } catch {
      /* optional QA helper */
    }
  }, [photo]);

  useEffect(() => {
    const local = loadMemberSettings();
    if (local.fashion_preference) setGender(local.fashion_preference);
    if (!profile?.id || !hasSupabase || !isProduction()) return;
    supabase
      .from("profiles")
      .select("gender, age_group, default_modesty, fashion_preference")
      .eq("id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (data.gender || data.fashion_preference) setGender(data.gender || data.fashion_preference);
        if (data.age_group) setAgeGroup(data.age_group);
        if (data.default_modesty != null) setModesty(Number(data.default_modesty) || 5);
      })
      .catch(() => {});
  }, [profile?.id]);

  const poolBrandCount = paidVwBrandIds(creators).size;
  const activeLook = curatedLooks[selectedIdx] || null;
  const selectedItems = activeLook?.items || [];
  const total = selectedItems.reduce((s, g) => s + (g.price_ngn || 0), 0);
  const shareUrl = shareCode ? lookShareUrl(shareCode) : null;

  const toggleVibe = (id) => {
    setVibes((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const onPhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      const dataUrl = ev.target.result;
      const mod = await moderateSelfie(dataUrl);
      if (!mod.ok) {
        window.__toast?.(mod.reason || "Selfie rejected");
        return;
      }
      setPhoto(dataUrl);
      setSelfiePath(null);
      if (profile?.id && hasSupabase && isProduction()) {
        try {
          const { path } = await uploadSelfie(profile.id, dataUrl);
          setSelfiePath(path);
        } catch {
          /* inline data URL still works for try-on */
        }
      }
    };
    r.readAsDataURL(f);
  };

  const persistLook = async (image, items, mode, brandName) => {
    const code = `LK${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      title: items[0]?.name || "MyYanga look",
      scene,
      garment_ids: items.map((g) => g.id).filter(Boolean),
      total_ngn: items.reduce((s, g) => s + (g.price_ngn || 0), 0),
      image,
      share_code: code,
      is_public: true,
      designer_name: brandName || null,
      render_mode: mode,
    };
    saveLocalLook(payload);
    if (hasSupabase && isProduction()) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session) {
          await supabase.from("looks").insert({
            user_id: sess.session.user.id,
            title: payload.title,
            scene: payload.scene,
            garment_ids: payload.garment_ids,
            total_ngn: payload.total_ngn,
            image: payload.image,
            share_code: code,
            is_public: true,
          });
        }
      } catch {
        /* local share still works */
      }
    }
    setShareCode(code);
    return code;
  };

  const handleQuestionnaireSubmit = async () => {
    if (!photo) return window.__toast?.("Upload a selfie first");
    if (!gender) return window.__toast?.("Pick His or Hers");
    if (!scene) return window.__toast?.("Pick an event type");
    if (!budgetBand) return window.__toast?.("Pick a budget band");

    setStage("loading");
    setErr("");
    await new Promise((r) => setTimeout(r, 900));

    const curated = curateVwLooks({
      garments: allGarments,
      creators,
      gender,
      scene,
      vibes,
      budgetBand,
      modesty,
      limit: 4,
    });

    if (!curated.looks.length) {
      setErr(
        `No paid-pool outfits match your brief for ${scene}. Promoted brands need garments tagged for this event, vibe, and budget.`,
      );
      window.__toast?.("No matching looks in the paid pool");
      setStage("questionnaire");
      return;
    }

    setCuratedLooks(curated.looks);
    setPoolMeta({ size: curated.poolSize, recycled: curated.recycled, relaxed: curated.relaxed });
    setSelectedIdx(0);
    setRender(null);
    setShareCode(null);
    track(EV.VW_RENDER, {
      pool: "paid_promoted",
      stage: "curate",
      recycled: curated.recycled,
      pool_size: curated.poolSize,
      count: curated.looks.length,
    });
    if (curated.recycled) window.__toast?.("You've seen this pool — showing fresh rotations");
    if (curated.relaxed) window.__toast?.("Expanded style match — your vibe had no exact fits in the paid pool");
    setStage("results");
    // Lovable-style: auto try-on first curated look (use fresh list — setState is async)
    setTimeout(() => tryOnLook(0, curated.looks), 150);
  };

  const tryOnLook = async (idx = selectedIdx, looksOverride = null) => {
    const list = looksOverride || curatedLooks;
    const picked = list[idx];
    if (!picked || !photo) return;
    setSelectedIdx(idx);
    setTryBusy(true);
    setErr("");
    try {
      trackProductSelect(picked.outfit, { context: "vw_pool_curate", scene, vibes });
      const out = await renderLook({
        photoDataUrl: photo,
        garments: picked.items,
        scene,
        selfiePath,
      });
      setRender(out.image);
      setRenderMode(out.mode);
      markOutfitWorn(picked.outfit.id);
      trackVwRender({
        scene,
        gender,
        designerId: picked.outfit.creator_id,
        garments: picked.items,
        mode: out.mode,
      });
      await persistLook(out.image, picked.items, out.mode, picked.brand?.name);
      if (out.mode === "ai") window.__toast?.("AI try-on from the paid brand pool");
      else
        window.__toast?.(
          isProduction()
            ? "On-device preview — set REPLICATE_API_TOKEN or GOOGLE_API_KEY on virtual-tryon for AI"
            : "Testing preview from the paid brand pool (canvas compositing)",
        );
    } catch (e) {
      setErr(e.message || "Could not generate look");
      window.__toast?.(e.message || "Could not generate look");
    } finally {
      setTryBusy(false);
    }
  };

  const share = async () => {
    if (!render) return;
    track(EV.VW_SHARE, {
      designer_id: activeLook?.outfit?.creator_id,
      scene,
      mode: renderMode,
    });
    const ok = await shareLookNative(render, activeLook?.outfit?.name || "My MyYanga look");
    if (!ok) {
      const a = document.createElement("a");
      a.href = render;
      a.download = "myyanga-look.jpg";
      a.click();
      window.__toast?.("Image downloaded");
    }
  };

  const restart = () => {
    setStage("landing");
    setCuratedLooks([]);
    setRender(null);
    setShareCode(null);
    setErr("");
  };

  if (stage === "loading") {
    return (
      <VwLoading
        title="Curating looks from our paying brands…"
        subtitle="Matching event, vibe, and budget to promoted African creatives."
      />
    );
  }

  if (stage === "landing") {
    return (
      <div className="vw-lov-screen ankara-pattern">
        <div className="wrap vw-lov-landing">
          <p className="eyebrow">Virtual Wear</p>
          <h1 className="serif vw-lov-hero-title">See yourself in African luxe</h1>
          <p className="vw-lov-lead">
            Tell us about your event, style, and budget — we'll present curated looks from brands that paid into the
            MyYanga Virtual Wear pool. Upload a selfie, try on, and patronize directly.
          </p>
          <p className="vw-lov-muted" style={{ fontSize: 12 }}>
            Paid brands in pool: <b>{poolBrandCount}</b>
          </p>
          <div className="vw-actions">
            <button type="button" className="btn btn-gold" onClick={() => setStage("questionnaire")}>
              Start styling
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => go?.("discover")}>
              Browse promoted brands
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "questionnaire") {
    return (
      <div className="vw-lov-screen ankara-pattern">
        <div className="wrap vw-lov-questionnaire">
          <button type="button" className="vw-lov-back" onClick={() => setStage("landing")}>
            ← Back
          </button>
          <h2 className="serif vw-lov-section-title">Your styling brief</h2>
          <p className="vw-lov-muted">Event, vibe, budget — then looks from paying brands only.</p>

          <div className="vw-lov-block">
            <div className="tick-label">Selfie</div>
            <label className="drop vw-lov-drop">
              {photo ? <img src={photo} alt="" className="vw-lov-selfie-preview" /> : "Tap to upload your selfie"}
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "none" }} />
            </label>
            {!profile?.id && (
              <p className="vw-lov-hint">Sign in for cloud selfie storage and AI try-on in Production.</p>
            )}
          </div>

          <div className="vw-lov-block">
            <div className="tick-label">His or Hers</div>
            <div className="gender-row">
              {GENDER_OPTIONS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={"gender-btn" + (gender === g.id ? " on" : "")}
                  onClick={() => setGender(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="vw-lov-block">
            <div className="tick-label">Event type</div>
            <div className="designer-row">
              {VW_EVENT_SCENES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={"designer-card" + (scene === s.id ? " on" : "")}
                  onClick={() => setScene(s.id)}
                >
                  <strong>{s.label}</strong>
                  <span>{s.event}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="vw-lov-block">
            <div className="tick-label">Dress vibe / theme</div>
            <div className="vw-lov-chips">
              {VW_VIBE_OPTIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={"vw-lov-chip" + (vibes.includes(v.id) ? " on" : "")}
                  onClick={() => toggleVibe(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="vw-lov-block">
            <div className="tick-label">Budget</div>
            <div className="designer-row">
              {PRICE_BANDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={"designer-card" + (budgetBand === b.id ? " on" : "")}
                  onClick={() => setBudgetBand(b.id)}
                >
                  <strong>{b.label}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="vw-lov-block vw-lov-grid-2">
            <div>
              <div className="tick-label">Age group</div>
              <div className="vw-lov-chips">
                {VW_AGE_GROUPS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={"vw-lov-chip" + (ageGroup === a.id ? " on" : "")}
                    onClick={() => setAgeGroup(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="tick-label">Modesty ({modesty}/10)</div>
              <input
                type="range"
                min={1}
                max={10}
                value={modesty}
                onChange={(e) => setModesty(Number(e.target.value))}
                className="vw-lov-range"
              />
              <p className="vw-lov-hint">Higher = more covered silhouettes (Agbada, Kaftan).</p>
            </div>
          </div>

          {err && <p className="vw-lov-error">{err}</p>}

          <div className="vw-actions">
            <button type="button" className="btn btn-gold" onClick={handleQuestionnaireSubmit}>
              Curate my looks
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vw-lov-screen ankara-pattern">
      <div className="wrap vw-lov-results">
        <div className="vw-lov-results-head">
          <div>
            <p className="eyebrow">Your curated looks</p>
            <h2 className="serif vw-lov-section-title">From the paid brand pool</h2>
            <p className="vw-lov-muted">
              {curatedLooks.length} option{curatedLooks.length !== 1 ? "s" : ""} · {scene}
              {poolMeta.recycled ? " · pool recycled" : ""}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
            Start over
          </button>
        </div>

        <div className="vw-lov-results-grid">
          <div className="vw-lov-options">
            {curatedLooks.map((look, i) => {
              const thumb = resolveGarmentImage(look.outfit);
              const lookTotal = look.items.reduce((s, g) => s + (g.price_ngn || 0), 0);
              return (
                <button
                  key={look.outfit.id}
                  type="button"
                  className={"vw-lov-option" + (selectedIdx === i ? " on" : "")}
                  onClick={() => setSelectedIdx(i)}
                >
                  {thumb ? <img src={thumb} alt="" /> : <div className="vw-lov-option-ph" />}
                  <div className="vw-lov-option-meta">
                    <strong>{look.outfit.name}</strong>
                    <span>{look.brand?.name || "Brand"}</span>
                    <em>{naira(lookTotal)}</em>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="vw-lov-tryon">
            {activeLook && (
              <>
                <div className="look">
                  <div className="head">
                    <span style={{ fontWeight: 800 }}>{activeLook.outfit?.name || "Your look"}</span>
                    <span style={{ fontSize: 11 }}>
                      {activeLook.brand?.name || "Brand"}
                      {renderMode === "ai" ? " · AI" : render ? " · preview" : ""} · {scene}
                    </span>
                  </div>
                  {render ? (
                    <img src={render} alt="" style={{ width: "100%", display: "block" }} />
                  ) : (
                    <div className="vw-lov-tryon-placeholder">
                      <IconSparkles />
                      <p>Select a look and tap Try on me</p>
                    </div>
                  )}
                  <div className="items">
                    {selectedItems.map((it) => (
                      <div className="it" key={it.id}>
                        <span>
                          {it.name} <span className="muted">({PART_LABEL[it.part] || it.part})</span>
                        </span>
                        <span>{naira(it.price_ngn)}</span>
                      </div>
                    ))}
                    <div className="tot">
                      <span>Total look</span>
                      <span>{naira(total)}</span>
                    </div>
                  </div>
                </div>

                {err && <p className="vw-lov-error">{err}</p>}

                <div className="vw-actions">
                  <button
                    type="button"
                    className="btn btn-gold"
                    disabled={tryBusy}
                    onClick={() => tryOnLook(selectedIdx)}
                  >
                    {tryBusy ? "Dressing you…" : render ? "Try again" : "Try on me"}
                  </button>
                  {render && (
                    <button type="button" className="btn" onClick={share}>
                      Share
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={() => setStage("questionnaire")}>
                    Edit brief
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => go?.("shop")}>
                    Shop look
                  </button>
                </div>

                {shareUrl && (
                  <div style={{ marginTop: 12 }}>
                    <div className="tick-label">Comment link</div>
                    <button type="button" className="vw-share-url" onClick={() => openLookInApp(shareCode)}>
                      {shareUrl}
                    </button>
                    <div className="vw-actions" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          const ok = await copyText(shareUrl);
                          window.__toast?.(ok ? "Copied" : shareUrl);
                        }}
                      >
                        Copy link
                      </button>
                      {activeLook.brand?.whatsapp && (
                        <a
                          className="btn btn-ghost btn-sm"
                          href={`https://wa.me/${String(activeLook.brand.whatsapp).replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${activeLook.brand.name}, I tried your look on MyYanga Virtual Wear.`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Message brand
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VirtualWearPage({ go }) {
  return (
    <PayGate feature="virtual_wear">
      <VirtualWearInner go={go} />
    </PayGate>
  );
}
