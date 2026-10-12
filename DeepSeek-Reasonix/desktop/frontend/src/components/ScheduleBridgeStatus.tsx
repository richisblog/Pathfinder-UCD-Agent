import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ExternalLink, Link2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

import { app, type ScheduleBridgePairingView, type ScheduleBridgeStatusView } from "../lib/bridge";
import { useT } from "../lib/i18n";
import { scheduleBridgeBannerMode } from "../lib/scheduleBridge";
import { AnchoredPopover } from "./AnchoredPopover";

export function ScheduleBridgeStatus({ sessionId, collapsed = false }: { sessionId: string; collapsed?: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<ScheduleBridgeStatusView | null>(null);
  const [pairing, setPairing] = useState<ScheduleBridgePairingView | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [calendarSaved, setCalendarSaved] = useState("");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextConsent] = await Promise.all([
        app.ScheduleBridgeStatus(),
        sessionId ? app.ScheduleBridgePersonalConsent(sessionId) : Promise.resolve(false),
      ]);
      setStatus(nextStatus);
      setConsent(nextConsent);
      setError("");
      if (nextStatus.connected) setPairing(null);
    } catch (value) {
      setError(String(value));
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const issuePairingCode = async () => {
    setBusy(true);
    try {
      setPairing(await app.ScheduleBridgeIssuePairingCode());
      setError("");
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  const updateConsent = async (allowed: boolean) => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await app.ScheduleBridgeSetPersonalConsent(sessionId, allowed);
      setConsent(allowed);
      setError("");
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  const saveCalendar = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const path = await app.SaveScheduleCalendar(sessionId);
      setCalendarSaved(path ? path.split(/[\\/]/).filter(Boolean).pop() ?? path : "");
      setError("");
    } catch (value) {
      setCalendarSaved("");
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  const mode = scheduleBridgeBannerMode(status, consent);
  const connected = mode === "connected-private" || mode === "connected-consented";
  const title = connected ? t("scheduleBridge.connected") : mode === "starting" ? t("scheduleBridge.starting") : t("scheduleBridge.connect");

  return (
    <div className={`schedule-bridge-status schedule-bridge-status--${mode}${collapsed ? " schedule-bridge-status--collapsed" : ""}`}>
      <button
        ref={anchorRef}
        type="button"
        className="schedule-bridge-status__summary"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="schedule-bridge-status__icon" aria-hidden="true">
          {connected ? <CheckCircle2 size={16} /> : mode === "extension" ? <Unplug size={16} /> : <Link2 size={16} />}
        </span>
        {!collapsed && <span className="schedule-bridge-status__label">{title}</span>}
        {!collapsed && <span className={`schedule-bridge-status__dot schedule-bridge-status__dot--${connected ? "ready" : "idle"}`} />}
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="schedule-bridge-status__popover"
        align="start"
        placement="auto"
      >
        <div className="schedule-bridge-status__heading">{title}</div>
        <p className="schedule-bridge-status__detail">
          {mode === "starting" && t("scheduleBridge.startingDetail")}
          {mode === "extension" && !pairing && t("scheduleBridge.installDetail")}
          {mode === "extension" && pairing && <>{t("scheduleBridge.pairingCode")} <strong>{pairing.code}</strong></>}
          {mode === "connected-private" && t("scheduleBridge.connectedPrivate")}
          {mode === "connected-consented" && t("scheduleBridge.connectedConsented")}
          {error && <span className="schedule-bridge-status__error"> {error}</span>}
        </p>
        <div className="schedule-bridge-status__actions">
          {mode === "extension" && (
            <>
              <button type="button" disabled={busy} onClick={() => void issuePairingCode()}>
                <Link2 size={14} /> {t("scheduleBridge.pair")}
              </button>
              <button type="button" disabled={busy} onClick={() => void app.ScheduleBridgeOpenBrowser()}>
                <ExternalLink size={14} /> {t("scheduleBridge.openBuilder")}
              </button>
            </>
          )}
          {mode === "connected-private" && sessionId && (
            <button type="button" disabled={busy} onClick={() => void updateConsent(true)}>
              <ShieldCheck size={14} /> {t("scheduleBridge.allowPersonal")}
            </button>
          )}
          {mode === "connected-consented" && (
            <>
              <button type="button" disabled={busy || !sessionId} onClick={() => void saveCalendar()}>
                <CalendarDays size={14} /> {t("scheduleBridge.saveCalendar")}
              </button>
              <button type="button" disabled={busy} onClick={() => void updateConsent(false)}>{t("scheduleBridge.revokePersonal")}</button>
            </>
          )}
          <button type="button" className="schedule-bridge-status__refresh" aria-label={t("scheduleBridge.refresh")} disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={14} />
          </button>
        </div>
        {calendarSaved && <p className="schedule-bridge-status__saved">{t("scheduleBridge.calendarSaved", { file: calendarSaved })}</p>}
      </AnchoredPopover>
    </div>
  );
}
