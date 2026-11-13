import React, { useEffect, useRef, useState } from 'react';
import { EyeOff, ImageOff, ImagePlus, Settings2, X } from 'lucide-react';
import {
  doesProviderSupportVision,
  type AgentImageAttachmentRef,
  type AgentImageAttachmentRole,
  type LlmProviderConfig,
} from '../../../packages/workspace-store/index.js';
import type { BootstrapPayload } from '../../api.js';
import { usePreferences } from '../../i18n.js';
import {
  extractClipboardImageFiles,
  loadLocalImage,
  peekLocalImageSync,
  storeUploadedOrPastedImage,
  toLocalImageDataUrl,
  type ClipboardLikeData,
  type LocalImageSyncSnapshot,
} from '../../lib/localImageStore.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';

export function resolveActiveVisionCapability(
  data: Pick<BootstrapPayload, 'llmProviders'> | null | undefined,
  providerId?: string,
  modelOverride?: string,
): {
  visionSupported: boolean;
  provider?: LlmProviderConfig;
  providerLabel?: string;
} {
  const providers = data?.llmProviders ?? [];
  const activeProvider = providerId
    ? providers.find((p) => p.id === providerId && p.enabled) ??
      providers.find((p) => p.id === providerId)
    : providers.find((p) => p.enabled) ?? providers[0];

  if (!activeProvider) {
    return { visionSupported: true };
  }
  return {
    visionSupported: doesProviderSupportVision(activeProvider, modelOverride),
    provider: activeProvider,
    providerLabel: activeProvider.name,
  };
}

export interface VisionCapabilityBannerProps {
  visionSupported: boolean;
  providerLabel?: string;
  onOpenLlmCenter?: () => void;
  className?: string;
}

/**
 * Prominent non-silent notice shown whenever the active LLM provider has `supportsVision === false`.
 * Provides a direct link to LLM Center so the user can switch or enable a vision-capable gateway.
 */
export function VisionCapabilityBanner({
  visionSupported,
  providerLabel,
  onOpenLlmCenter,
  className,
}: VisionCapabilityBannerProps) {
  const { t } = usePreferences();
  if (visionSupported) return null;

  return (
    <div
      className={cn('vision-capability-banner', className)}
      role="status"
      data-testid="vision-fallback-banner"
    >
      <div className="vision-capability-banner-main">
        <EyeOff size={14} className="vision-capability-banner-icon" aria-hidden="true" />
        <div className="vision-capability-banner-copy">
          <span className="vision-capability-banner-text">
            {t(
              '当前模型看不了图，将只使用文字设计说明',
              'Current model cannot view images; only text design notes will be used',
            )}
          </span>
          {providerLabel && (
            <span className="vision-capability-banner-meta">({providerLabel})</span>
          )}
        </div>
      </div>
      {onOpenLlmCenter && (
        <Button
          type="button"
          variant="secondary"
          size="xs"
          data-testid="vision-open-llm-center-btn"
          onClick={onOpenLlmCenter}
        >
          <Settings2 size={12} aria-hidden="true" />
          {t('前往 LLM 中心', 'Open LLM Center')}
        </Button>
      )}
    </div>
  );
}

export interface LocalImageThumbnailProps {
  attachment: AgentImageAttachmentRef;
  onRemove?: (id: string) => void;
  compact?: boolean;
  className?: string;
}

function formatAttachmentRoleBadge(
  role: AgentImageAttachmentRole | undefined,
  t: (zh: string, en: string) => string,
): string | null {
  switch (role) {
    case 'primary_ref':
      return t('主参考', 'Primary Ref');
    case 'borrowed_ref':
      return t('借用局部', 'Borrowed');
    case 'selection_crop':
      return t('框选区域', 'Crop');
    case 'user_upload':
      return t('本地参考图', 'Local Upload');
    default:
      return null;
  }
}

/**
 * Renders either a remote reference screenshot or a browser-local IndexedDB image.
 * When a local image is missing (cleared storage or opened on another device), renders an explicit
 * `"图片已不在本机"` / `"Image no longer on this device"` card in place without breaking surrounding content.
 */
export function LocalImageThumbnail({
  attachment,
  onRemove,
  compact = false,
  className,
}: LocalImageThumbnailProps) {
  const { t } = usePreferences();
  const [localSnap, setLocalSnap] = useState<LocalImageSyncSnapshot>(() =>
    attachment.source === 'local' ? peekLocalImageSync(attachment.id) : { status: 'missing' },
  );
  const [remoteLoadFailed, setRemoteLoadFailed] = useState(false);

  useEffect(() => {
    setRemoteLoadFailed(false);
    if (attachment.source !== 'local') return;
    const sync = peekLocalImageSync(attachment.id);
    setLocalSnap(sync);
    if (sync.status !== 'pending') return;

    let cancelled = false;
    void loadLocalImage(attachment.id).then((record) => {
      if (cancelled) return;
      setLocalSnap(record ? { status: 'loaded', record } : { status: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.source]);

  const roleBadge = formatAttachmentRoleBadge(attachment.role, t);

  const renderRemoveButton = () =>
    onRemove ? (
      <button
        type="button"
        className="local-image-thumb-remove"
        data-testid={`vision-remove-image-${attachment.id}`}
        aria-label={t(`移除图片 ${attachment.name}`, `Remove image ${attachment.name}`)}
        title={t('移除图片', 'Remove image')}
        onClick={() => onRemove(attachment.id)}
      >
        <X size={12} aria-hidden="true" />
      </button>
    ) : null;

  if (attachment.source === 'remote' && attachment.remoteUrl && !remoteLoadFailed) {
    return (
      <figure
        className={cn('local-image-thumb', compact && 'is-compact', className)}
        data-testid="local-image-thumbnail"
        data-image-id={attachment.id}
        data-image-source="remote"
      >
        <img
          src={attachment.remoteUrl}
          alt={attachment.name}
          className="local-image-thumb-img"
          loading="lazy"
          onError={() => setRemoteLoadFailed(true)}
        />
        <figcaption className="local-image-thumb-caption">
          {roleBadge && <span className="local-image-thumb-role">{roleBadge}</span>}
          <span className="local-image-thumb-name" title={attachment.name}>
            {attachment.name}
          </span>
        </figcaption>
        {renderRemoveButton()}
      </figure>
    );
  }

  if (attachment.source === 'local' && localSnap.status === 'loaded') {
    return (
      <figure
        className={cn('local-image-thumb', compact && 'is-compact', className)}
        data-testid="local-image-thumbnail"
        data-image-id={attachment.id}
        data-image-source="local"
      >
        <img
          src={toLocalImageDataUrl(localSnap.record)}
          alt={attachment.name}
          className="local-image-thumb-img"
        />
        <figcaption className="local-image-thumb-caption">
          {roleBadge && <span className="local-image-thumb-role">{roleBadge}</span>}
          <span className="local-image-thumb-name" title={attachment.name}>
            {attachment.name}
          </span>
        </figcaption>
        {renderRemoveButton()}
      </figure>
    );
  }

  if (attachment.source === 'local' && localSnap.status === 'pending') {
    return (
      <div
        className={cn('local-image-missing is-loading', compact && 'is-compact', className)}
        data-testid="local-image-loading"
        data-image-id={attachment.id}
      >
        <span className="local-image-missing-title">
          {t('正在加载本机图片…', 'Loading local image…')}
        </span>
        <span className="local-image-missing-name">{attachment.name}</span>
      </div>
    );
  }

  return (
    <div
      className={cn('local-image-missing', compact && 'is-compact', className)}
      data-testid="local-image-missing-placeholder"
      data-image-id={attachment.id}
    >
      <ImageOff size={14} className="local-image-missing-icon" aria-hidden="true" />
      <div className="local-image-missing-copy">
        <span className="local-image-missing-title">
          {t('图片已不在本机', 'Image no longer on this device')}
        </span>
        <span className="local-image-missing-name" title={attachment.name}>
          {attachment.name}
        </span>
      </div>
      {renderRemoveButton()}
    </div>
  );
}

export async function ingestClipboardOrSelectedImages(
  files: readonly (File | Blob)[],
  defaultRole: AgentImageAttachmentRole = 'user_upload',
): Promise<AgentImageAttachmentRef[]> {
  const created: AgentImageAttachmentRef[] = [];
  for (const file of files) {
    const { ref } = await storeUploadedOrPastedImage(file, { role: defaultRole });
    created.push(ref);
  }
  return created;
}

export interface VisionAttachmentControlsProps {
  attachments: AgentImageAttachmentRef[];
  onAttachmentsChange: (next: AgentImageAttachmentRef[]) => void;
  visionSupported?: boolean;
  providerLabel?: string;
  onOpenLlmCenter?: () => void;
  defaultRole?: AgentImageAttachmentRole;
  disabled?: boolean;
  className?: string;
}

/**
 * Reusable Upload + Clipboard Paste control and thumbnail strip for browser-local reference images.
 * Stores image bytes exclusively in browser IndexedDB (`onto_local_images_v1`).
 */
export function VisionAttachmentControls({
  attachments,
  onAttachmentsChange,
  visionSupported = true,
  providerLabel,
  onOpenLlmCenter,
  defaultRole = 'user_upload',
  disabled = false,
  className,
}: VisionAttachmentControlsProps) {
  const { t } = usePreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handleIngestFiles = async (files: readonly File[]) => {
    if (files.length === 0 || disabled) return;
    setBusy(true);
    setInlineError(null);
    try {
      const added = await ingestClipboardOrSelectedImages(files, defaultRole);
      if (added.length > 0) {
        onAttachmentsChange([...attachments, ...added]);
      }
    } catch (err) {
      setInlineError(
        err instanceof Error
          ? err.message
          : t('本地图片保存失败', 'Failed to store image locally'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    void handleIngestFiles(selected);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLElement>) => {
    const files = extractClipboardImageFiles(e.clipboardData as unknown as ClipboardLikeData);
    if (files.length === 0) return;
    e.preventDefault();
    void handleIngestFiles(files);
  };

  const handleRemove = (id: string) => {
    onAttachmentsChange(attachments.filter((item) => item.id !== id));
  };

  return (
    <div
      className={cn('vision-attachment-controls', className)}
      data-testid="vision-attachment-controls"
      onPaste={onPaste}
    >
      <VisionCapabilityBanner
        visionSupported={visionSupported}
        {...(providerLabel ? { providerLabel } : {})}
        {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
      />

      <div className="vision-attachment-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          disabled={disabled || busy}
          data-testid="vision-file-input"
          onChange={onFileInputChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={disabled || busy}
          data-testid="vision-upload-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={13} aria-hidden="true" />
          {busy
            ? t('正在压缩存入本机…', 'Compressing locally…')
            : t('上传参考图', 'Upload Image')}
        </Button>
        <span className="vision-attachment-hint">
          {t(
            '支持直接粘贴截图 (Ctrl/⌘+V)，图片仅保存在当前浏览器',
            'Paste screenshots (Ctrl/⌘+V); images stay in this browser only',
          )}
        </span>
      </div>

      {inlineError && (
        <p className="vision-attachment-error" role="alert">
          {inlineError}
        </p>
      )}

      {attachments.length > 0 && (
        <div className="vision-attachment-strip" data-testid="vision-attachment-strip">
          {attachments.map((att) => (
            <LocalImageThumbnail
              key={att.id}
              attachment={att}
              {...(!disabled ? { onRemove: handleRemove } : {})}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}
