import type { ReactNode } from "react";
import { FileText, Folder, MessageSquare, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { DocumentExtractionView } from "../lib/types";
import { Tooltip } from "./Tooltip";

type ComposerContextCardVariant = "attachment" | "workspace" | "session";

export function ComposerContextCard({
  variant,
  tooltipLabel,
  removeLabel,
  onRemove,
  removeDisabled = false,
  removeIconSize,
  previewUrl,
  imageOnly = false,
  folder = false,
  name,
  meta,
  label,
  icon,
  document,
}: {
  variant: ComposerContextCardVariant;
  tooltipLabel: string;
  removeLabel: string;
  onRemove: () => void;
  removeDisabled?: boolean;
  removeIconSize?: number;
  previewUrl?: string;
  imageOnly?: boolean;
  folder?: boolean;
  name?: string;
  meta?: string;
  label?: ReactNode;
  icon?: ReactNode;
  document?: DocumentExtractionView;
}) {
  const { t } = useI18n();
  const variantClass = previewUrl
    ? "composer-context__item--image"
    : variant === "workspace"
      ? `composer-context__item--workspace composer-context__item--${folder ? "folder" : "file"}`
      : variant === "session"
        ? "composer-context__item--session"
        : "composer-context__item--attachment";
  const iconNode = icon ?? (variant === "session" ? <MessageSquare size={15} /> : folder ? <Folder size={15} /> : <FileText size={15} />);
  const documentMeta = document
    ? [
        document.format.toUpperCase(),
        typeof document.pages === "number" && document.pages > 0 ? t("composer.documentPages", { n: document.pages }) : "",
        t("composer.documentCharacters", { n: document.characters }),
      ].filter(Boolean).join(" · ")
    : meta;
  const documentStatus = document
    ? document.status === "failed"
      ? { label: t("composer.documentFailed"), kind: "failed" }
      : document.status === "ocr_required"
        ? { label: t("composer.documentOCRRequired"), kind: "ocr" }
        : document.truncated || document.status === "truncated"
          ? { label: t("composer.documentTruncated"), kind: "truncated" }
          : document.status === "ready"
            ? { label: t("composer.documentReady"), kind: "ready" }
            : { label: t("composer.documentFailed"), kind: "failed" }
    : null;
  return (
    <div className={`composer-context__item ${variantClass}${imageOnly ? " composer-context__item--image-only" : ""}`}>
      <Tooltip label={tooltipLabel}>
        <span className="composer-context__label">
          {previewUrl ? (
            <span className="composer-context__thumb">
              <img src={previewUrl} alt="" draggable={false} />
            </span>
          ) : variant === "attachment" ? (
            <>
              <span className="composer-context__fileicon">
                {icon ?? <FileText size={20} />}
              </span>
              <span className="composer-context__main">
                <span className="composer-context__name">{name}</span>
                {documentMeta && <span className="composer-context__meta">{documentMeta}</span>}
                {documentStatus && <span className={`composer-context__status composer-context__status--${documentStatus.kind}`} role="status">{documentStatus.label}</span>}
              </span>
            </>
          ) : (
            <>
              {iconNode}
              <span>{label}</span>
            </>
          )}
        </span>
      </Tooltip>
      <Tooltip label={removeLabel} className="composer-context__remove-trigger">
        <button className="composer-context__remove" type="button" disabled={removeDisabled} onClick={onRemove}>
          <X size={removeIconSize ?? (variant === "attachment" ? 14 : 13)} />
        </button>
      </Tooltip>
    </div>
  );
}
