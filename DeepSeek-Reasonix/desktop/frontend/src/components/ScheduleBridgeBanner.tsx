import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Link2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

import {
  app,
  type ScheduleBridgePairingView,
  type ScheduleBridgeStatusView,
} from "../lib/bridge";
import { scheduleBridgeBannerMode } from "../lib/scheduleBridge";
import "./ScheduleBridgeBanner.css";

export function ScheduleBridgeBanner({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<ScheduleBridgeStatusView | null>(null);
  const [pairing, setPairing] = useState<ScheduleBridgePairingView | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const mode = scheduleBridgeBannerMode(status, consent);
  return (
    <section className={`schedule-bridge schedule-bridge--${mode}`} aria-label="实时课程数据">
      <div className="schedule-bridge__icon" aria-hidden="true">
        {mode.startsWith("connected") ? <CheckCircle2 size={17} /> : mode === "extension" ? <Unplug size={17} /> : <Link2 size={17} />}
      </div>
      <div className="schedule-bridge__body">
        <div className="schedule-bridge__title">
          {mode === "starting" && "实时课程桥正在启动"}
          {mode === "extension" && "连接 Chrome，启用 UC Davis 实时课程"}
          {mode === "connected-private" && "实时课程已连接 · 个人数据默认关闭"}
          {mode === "connected-consented" && "实时课程已连接 · 已允许本会话个人数据"}
        </div>
        <div className="schedule-bridge__detail">
          {mode === "starting" && "本地只读服务暂不可用，请稍后检查。"}
          {mode === "extension" && !pairing && "安装扩展后点击配对；需要查询时再登录 Schedule Builder。"}
          {mode === "extension" && pairing && (
            <>在扩展弹窗输入配对码 <strong className="schedule-bridge__code">{pairing.code}</strong>（5 分钟内有效）</>
          )}
          {mode === "connected-private" && "课程与 Sections 可实时查询；已注册和候补课程尚未授权。"}
          {mode === "connected-consented" && "授权仅对当前 Pathfinder 对话有效，可随时撤销。"}
          {error && <span className="schedule-bridge__error"> {error}</span>}
        </div>
      </div>
      <div className="schedule-bridge__actions">
        {mode === "extension" && (
          <>
            <button className="schedule-bridge__button schedule-bridge__button--primary" disabled={busy} onClick={() => void issuePairingCode()}>
              <Link2 size={14} /> 配对扩展
            </button>
            <button className="schedule-bridge__button" onClick={() => void app.ScheduleBridgeOpenBrowser()}>
              <ExternalLink size={14} /> 打开 Schedule Builder
            </button>
          </>
        )}
        {mode === "connected-private" && sessionId && (
          <button className="schedule-bridge__button schedule-bridge__button--primary" disabled={busy} onClick={() => void updateConsent(true)}>
            <ShieldCheck size={14} /> 本会话允许
          </button>
        )}
        {mode === "connected-consented" && (
          <button className="schedule-bridge__button" disabled={busy} onClick={() => void updateConsent(false)}>
            撤销个人数据权限
          </button>
        )}
        <button className="schedule-bridge__icon-button" aria-label="重新检查连接" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={14} />
        </button>
      </div>
    </section>
  );
}
